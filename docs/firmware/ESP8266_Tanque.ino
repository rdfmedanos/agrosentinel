#include <ESP8266WiFi.h>
#include <WiFiManager.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <EEPROM.h>

// ---------------- MQTT Defaults ----------------
char mqtt_server[40] = "192.168.1.66";
char mqtt_port[6] = "1883";
char mqtt_user[40] = "admin@agrosentinel.com";
char mqtt_pass[40] = "Empresa123!";

// ---------------- Pines ----------------
#define TRIG_PIN D2
#define ECHO_PIN D1
#define SENSOR_RESERVA D3
#define RELE_PIN D4

// ---------------- Variables ----------------
WiFiClient espClient;
PubSubClient client(espClient);

String device_id;
String base_topic;

bool wifi_conectado = false;
bool mqtt_conectado = false;

// ---------------- CONFIGURACIÓN ----------------
int config_nivel_min = 50;
int config_nivel_max = 95;
int config_alerta_baja = 30;
bool config_modo_auto = true;
bool config_habilitar_bomba = true;

int altura_tanque = 150;
int distancia_sensor = 20;

bool bomba = false;
bool ultimo_estado_bomba = false;

unsigned long lastSend = 0;
unsigned long lastHeartbeat = 0;
unsigned long ultimo_cambio_bomba = 0;
unsigned long lastWifiCheck = 0;
unsigned long lastMqttAttempt = 0;
unsigned long bootTime = 0;

bool alerta_baja_emitida = false;

// ---------------- EEPROM ----------------
struct DeviceConfig {
  int nivel_min;
  int nivel_max;
  int alerta_baja;
  bool modo_auto;
  bool habilitar_bomba;
  int altura_tanque;
  int distancia_sensor;
  char mqtt_server[40];
  char mqtt_user[40];
  char mqtt_pass[40];
  char mqtt_port[6];
};

void guardarConfig() {
  DeviceConfig cfg;
  cfg.nivel_min = config_nivel_min;
  cfg.nivel_max = config_nivel_max;
  cfg.alerta_baja = config_alerta_baja;
  cfg.modo_auto = config_modo_auto;
  cfg.habilitar_bomba = config_habilitar_bomba;
  cfg.altura_tanque = altura_tanque;
  cfg.distancia_sensor = distancia_sensor;
  strncpy(cfg.mqtt_server, mqtt_server, 40);
  strncpy(cfg.mqtt_user, mqtt_user, 40);
  strncpy(cfg.mqtt_pass, mqtt_pass, 40);
  strncpy(cfg.mqtt_port, mqtt_port, 6);
  
  EEPROM.begin(512);
  EEPROM.put(10, cfg);
  EEPROM.commit();
  EEPROM.end();
}

void cargarConfig() {
  DeviceConfig cfg;
  EEPROM.begin(512);
  EEPROM.get(10, cfg);
  EEPROM.end();
  
  if (cfg.nivel_min > 0 && cfg.nivel_min <= 100) config_nivel_min = cfg.nivel_min;
  if (cfg.nivel_max > 0 && cfg.nivel_max <= 100) config_nivel_max = cfg.nivel_max;
  if (cfg.alerta_baja > 0 && cfg.alerta_baja <= 100) config_alerta_baja = cfg.alerta_baja;
  if (cfg.altura_tanque > 0) altura_tanque = cfg.altura_tanque;
  if (cfg.distancia_sensor > 0) distancia_sensor = cfg.distancia_sensor;
  
  if (strlen(cfg.mqtt_server) > 0) strncpy(mqtt_server, cfg.mqtt_server, 40);
  if (strlen(cfg.mqtt_user) > 0) strncpy(mqtt_user, cfg.mqtt_user, 40);
  if (strlen(cfg.mqtt_pass) > 0) strncpy(mqtt_pass, cfg.mqtt_pass, 40);
  if (strlen(cfg.mqtt_port) > 0) strncpy(mqtt_port, cfg.mqtt_port, 6);

  config_modo_auto = cfg.modo_auto;
  config_habilitar_bomba = cfg.habilitar_bomba;
}

// ---------------- SENSOR ----------------
#define NUM_LECTURAS 3
int lecturas[NUM_LECTURAS];

int leerDistanciaJSN() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duracion = pulseIn(ECHO_PIN, HIGH, 25000);
  if (duracion == 0) return -1;
  int dist = duracion * 0.034 / 2;
  return dist;
}

int filtroMediana() {
  int suma = 0;
  int validas = 0;
  
  for (int i = 0; i < NUM_LECTURAS; i++) {
    int dist = leerDistanciaJSN();
    delay(100);
    
    // El JSN-SR04T tiene un rango mínimo de ~21cm. 
    // Si la distancia es < 21cm, el sensor suele reportar valores erráticos o el máximo.
    if (dist >= 10 && dist < 450) {
      lecturas[i] = dist;
      suma += dist;
      validas++;
    } else {
      Serial.println("Lectura fuera de rango: " + String(dist));
    }
  }

  if (validas == 0) return -1; // Indicar error
  
  return suma / validas;
}

int leerNivelTanque() {
  int distancia = filtroMediana();
  
  if (distancia == -1) {
    // Si no hay lecturas válidas, probablemente el tanque está MUY lleno (zona muerta)
    // o el sensor está desconectado. 
    // Para evitar falsos 0%, asumiremos que si fallan todas las lecturas y el sensor 
    // respondió algo (duracion != 0), es por cercanía extrema.
    Serial.println("Error de lectura: asumiendo nivel alto por zona muerta");
    return 100; 
  }

  Serial.println("Distancia: " + String(distancia) + " cm");
  
  // Ajuste de mapeo
  if (distancia < distancia_sensor) distancia = distancia_sensor;
  if (distancia > altura_tanque) distancia = altura_tanque;
  
  int nivel = map(distancia, altura_tanque, distancia_sensor, 0, 100);
  return constrain(nivel, 0, 100);
}

int leerNivelReserva() {
  return digitalRead(SENSOR_RESERVA) ? 100 : 0;
}

// ---------------- Control Bomba ----------------
void controlarBomba(int nivel, int reserva) {
  unsigned long ahora = millis();
  
  if (ahora - ultimo_cambio_bomba < 3000) {
    digitalWrite(RELE_PIN, ultimo_estado_bomba ? HIGH : LOW);
    return;
  }
  
  bool nuevo_estado = ultimo_estado_bomba;
  
  if (config_modo_auto && config_habilitar_bomba) {
    if (nivel < config_nivel_min && reserva > 10 && !ultimo_estado_bomba) {
      nuevo_estado = true;
    } else if (nivel >= config_nivel_max && ultimo_estado_bomba) {
      nuevo_estado = false;
    }
  }
  
  if (nivel < config_alerta_baja && ultimo_estado_bomba == false && !alerta_baja_emitida) {
    Serial.println("ALERTA: Nivel critico!");
    alerta_baja_emitida = true;
  }
  
  if (nuevo_estado != ultimo_estado_bomba) {
    ultimo_estado_bomba = nuevo_estado;
    ultimo_cambio_bomba = ahora;
    Serial.println(nuevo_estado ? "BOMBA ON" : "BOMBA OFF");
  }
  
  digitalWrite(RELE_PIN, ultimo_estado_bomba ? HIGH : LOW);
}

// ---------------- MQTT CALLBACK ----------------
void callback(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (int i = 0; i < length; i++) msg += (char)payload[i];

  String t = String(topic);
  Serial.println("MQTT: " + t);

  if (t.endsWith("/command")) {
    if (msg == "ON" || msg.indexOf("\"cmd\":\"pump_on\"") >= 0) {
      ultimo_estado_bomba = true;
      config_modo_auto = false;
      Serial.println("CMD: BOMBA ON");
    } else if (msg == "OFF" || msg.indexOf("\"cmd\":\"pump_off\"") >= 0) {
      ultimo_estado_bomba = false;
      config_modo_auto = false;
      Serial.println("CMD: BOMBA OFF");
    }
    return;
  }

  if (t.endsWith("/config")) {
    StaticJsonDocument<512> doc;
    deserializeJson(doc, msg);

    if (doc.containsKey("nivel_min")) config_nivel_min = doc["nivel_min"];
    if (doc.containsKey("nivel_max")) config_nivel_max = doc["nivel_max"];
    if (doc.containsKey("alerta_baja")) config_alerta_baja = doc["alerta_baja"];
    if (doc.containsKey("modo")) config_modo_auto = (String)doc["modo"] == "auto";
    if (doc.containsKey("habilitar_bomba")) config_habilitar_bomba = doc["habilitar_bomba"];
    if (doc.containsKey("altura_tanque")) altura_tanque = doc["altura_tanque"];
    if (doc.containsKey("distancia_sensor")) distancia_sensor = doc["distancia_sensor"];

    guardarConfig();
    Serial.println("Config guardada");
  }
}

// ---------------- MQTT ----------------
void reconnectMQTT() {
  if (client.connected()) {
    mqtt_conectado = true;
    return;
  }
  
  unsigned long ahora = millis();
  if (ahora - lastMqttAttempt < 5000) return;
  lastMqttAttempt = ahora;
  
  Serial.print("Intentando MQTT: ");
  Serial.println(mqtt_server);
  
  if (client.connect(device_id.c_str(), mqtt_user, mqtt_pass)) {
    Serial.println("MQTT conectado!");
    mqtt_conectado = true;
    
    client.subscribe((base_topic + "/config").c_str());
    client.subscribe((base_topic + "/command").c_str());

    StaticJsonDocument<200> doc;
    doc["device_id"] = device_id;
    doc["type"] = "nivel_tanque";
    char buffer[200];
    serializeJson(doc, buffer);
    client.publish("devices/register", buffer);
    Serial.println("Registro enviado");
  } else {
    Serial.print("MQTT falló, rc=");
    Serial.println(client.state());
    mqtt_conectado = false;
  }
}

// ---------------- SETUP ----------------
void setup() {
  Serial.begin(115200);
  Serial.println("\n=== AgroSentinel v2.1 ===");

  bootTime = millis();

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(SENSOR_RESERVA, INPUT);
  pinMode(RELE_PIN, OUTPUT);

  digitalWrite(RELE_PIN, LOW);
  digitalWrite(TRIG_PIN, LOW);

  device_id = "ESP8266_" + String(ESP.getChipId(), HEX);
  base_topic = "devices/" + device_id;

  cargarConfig();

  Serial.println("Device: " + device_id);
  
  WiFiManager wm;
  
  WiFiManagerParameter custom_mqtt_server("server", "MQTT Server", mqtt_server, 40);
  WiFiManagerParameter custom_mqtt_port("port", "MQTT Port", mqtt_port, 6);
  WiFiManagerParameter custom_mqtt_user("user", "MQTT User", mqtt_user, 40);
  WiFiManagerParameter custom_mqtt_pass("pass", "MQTT Pass", mqtt_pass, 40);
  
  wm.addParameter(&custom_mqtt_server);
  wm.addParameter(&custom_mqtt_port);
  wm.addParameter(&custom_mqtt_user);
  wm.addParameter(&custom_mqtt_pass);

  wm.setTimeout(180);
  
  if (!wm.autoConnect("AGROSENTINEL-SETUP")) {
    Serial.println("WiFi falló, reiniciando...");
    delay(3000);
    ESP.restart();
  }

  strncpy(mqtt_server, custom_mqtt_server.getValue(), 40);
  strncpy(mqtt_port, custom_mqtt_port.getValue(), 6);
  strncpy(mqtt_user, custom_mqtt_user.getValue(), 40);
  strncpy(mqtt_pass, custom_mqtt_pass.getValue(), 40);
  
  guardarConfig();

  wifi_conectado = true;
  Serial.println("WiFi OK: " + WiFi.localIP().toString());

  client.setServer(mqtt_server, atoi(mqtt_port));
  client.setCallback(callback);
  client.setKeepAlive(30);
}

// ---------------- LOOP ----------------
void loop() {
  if (!client.connected()) {
    reconnectMQTT();
  }
  client.loop();

  int nivel = leerNivelTanque();
  int reserva = leerNivelReserva();

  controlarBomba(nivel, reserva);

  if (millis() - lastSend > 15000 && client.connected()) {
    lastSend = millis();

    StaticJsonDocument<512> doc;
    doc["device_id"] = device_id;
    doc["nivel"] = nivel;
    doc["reserva"] = reserva;
    doc["bomba"] = ultimo_estado_bomba;
    doc["rssi"] = WiFi.RSSI();

    char buffer[512];
    serializeJson(doc, buffer);
    client.publish((base_topic + "/telemetry").c_str(), buffer);
    
    Serial.println("Nivel: " + String(nivel) + "% Bomba: " + String(ultimo_estado_bomba ? "ON" : "OFF"));
  }

  if (millis() - lastHeartbeat > 30000 && client.connected()) {
    lastHeartbeat = millis();
    client.publish((base_topic + "/heartbeat").c_str(), "1");
  }

  if (millis() - bootTime > 86400000) {
    ESP.restart();
  }

  delay(100);
}
