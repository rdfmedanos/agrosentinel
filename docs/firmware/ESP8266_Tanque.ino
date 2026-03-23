#include <ESP8266WiFi.h>
#include <WiFiManager.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <EEPROM.h>

// ---------------- MQTT ----------------
const char* mqtt_server = "192.168.100.20";
const int mqtt_port = 1883;
const char* mqtt_user = "admin@agrosentinel.com";
const char* mqtt_pass = "Empresa123!";

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
  Serial.println("Echo: " + String(duracion) + "us -> " + String(dist) + "cm");
  return dist;
}

int filtroMediana() {
  int suma = 0;
  int validas = 0;
  
  for (int i = 0; i < NUM_LECTURAS; i++) {
    int dist = leerDistanciaJSN();
    delay(100);
    
    if (dist > 20 && dist < 400) {
      lecturas[i] = dist;
      suma += dist;
      validas++;
    } else {
      Serial.println("Lectura invalida: " + String(dist));
      lecturas[i] = (i > 0) ? lecturas[i-1] : 100;
    }
  }

  if (validas == 0) return altura_tanque;
  
  return suma / validas;
}

int leerNivelTanque() {
  int distancia = filtroMediana();
  Serial.println("Distancia: " + String(distancia) + " cm");
  
  if (distancia < distancia_sensor || distancia > altura_tanque) {
    distancia = constrain(distancia, distancia_sensor, altura_tanque);
  }
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
  if (ahora - lastMqttAttempt < 3000) return;
  lastMqttAttempt = ahora;
  
  Serial.println("Intentando MQTT...");
  
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
    Serial.print("MQTT falló: ");
    Serial.println(client.state());
    mqtt_conectado = false;
  }
}

// ---------------- SETUP ----------------
void setup() {
  Serial.begin(115200);
  Serial.println("\n=== AgroSentinel v2.0 ===");

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
  Serial.println("Min: " + String(config_nivel_min) + "% Max: " + String(config_nivel_max) + "%");

  WiFiManager wm;
  wm.setTimeout(180);
  
  if (!wm.autoConnect("AGROSENTINEL-SETUP")) {
    Serial.println("WiFi falló, reiniciando...");
    delay(3000);
    ESP.restart();
  }

  wifi_conectado = true;
  Serial.println("WiFi OK: " + WiFi.localIP().toString());

  client.setServer(mqtt_server, mqtt_port);
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
