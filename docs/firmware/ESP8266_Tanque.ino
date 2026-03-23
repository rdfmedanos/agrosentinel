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

String device_id = "ESP8266_" + String(ESP.getChipId(), HEX);
String base_topic;

bool wifi_conectado = false;
bool mqtt_conectado = false;

// ---------------- CONFIGURACIÓN (default) ----------------
// Valores por defecto - se pueden cambiar desde MQTT
int config_nivel_min = 50;    // Nivel para encender bomba (default 50%)
int config_nivel_max = 95;   // Nivel para apagar bomba (default 95%)
int config_alerta_baja = 30;  // Nivel para alerta si bomba no enciende (default 30%)
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

// Contador de bombeo para alertas
unsigned long ultimo_bombeo_exitoso = 0;
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

// ---------------- WiFi ----------------
void verificarWifi() {
  if (WiFi.status() != WL_CONNECTED) {
    if (wifi_conectado) {
      Serial.println("WiFi desconectado, intentando reconnectar...");
      wifi_conectado = false;
    }
    WiFi.disconnect();
    delay(100);
    WiFi.begin();
    int intentos = 0;
    while (WiFi.status() != WL_CONNECTED && intentos < 20) {
      delay(500);
      intentos++;
    }
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\nWiFi reconnectado!");
      wifi_conectado = true;
      mqtt_conectado = false;
    }
  } else {
    if (!wifi_conectado) {
      Serial.println("WiFi conectado!");
      wifi_conectado = true;
    }
  }
}

// ---------------- SENSOR JSN-SR04T ----------------
#define NUM_LECTURAS 7
int lecturas[NUM_LECTURAS];

int leerDistanciaJSN() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(20);
  digitalWrite(TRIG_PIN, LOW);

  long duracion = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duracion == 0) return -1;
  return duracion * 0.034 / 2;
}

int filtroMediana() {
  for (int i = 0; i < NUM_LECTURAS; i++) {
    int dist = leerDistanciaJSN();
    if (dist < 0 || dist > 500) {
      dist = (i > 0) ? lecturas[i-1] : altura_tanque;
    }
    lecturas[i] = dist;
    delay(80);
  }

  int sorted[NUM_LECTURAS];
  memcpy(sorted, lecturas, sizeof(lecturas));
  
  for (int i = 0; i < NUM_LECTURAS - 1; i++) {
    for (int j = i + 1; j < NUM_LECTURAS; j++) {
      if (sorted[i] > sorted[j]) {
        int temp = sorted[i];
        sorted[i] = sorted[j];
        sorted[j] = temp;
      }
    }
  }
  
  return sorted[NUM_LECTURAS / 2];
}

int leerNivelTanque() {
  int distancia = filtroMediana();
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
  
  // Anti-rebote de 5 segundos
  if (ahora - ultimo_cambio_bomba < 5000) {
    digitalWrite(RELE_PIN, ultimo_estado_bomba ? HIGH : LOW);
    return;
  }
  
  bool nuevo_estado = ultimo_estado_bomba;
  
  if (config_modo_auto && config_habilitar_bomba) {
    // Encender bomba cuando nivel < config_nivel_min Y hay reserva
    if (nivel < config_nivel_min && reserva > 10 && !ultimo_estado_bomba) {
      nuevo_estado = true;
      ultimo_bombeo_exitoso = ahora;
      alerta_baja_emitida = false;
      Serial.println("Bomba encendida por nivel bajo");
    }
    // Apagar bomba cuando nivel >= config_nivel_max
    else if (nivel >= config_nivel_max && ultimo_estado_bomba) {
      nuevo_estado = false;
      Serial.println("Bomba apagada por nivel alto");
    }
  }
  
  // Verificar alerta: nivel muy bajo y bomba no encendida
  if (nivel < config_alerta_baja && ultimo_estado_bomba == false && !alerta_baja_emitida) {
    Serial.println("ALERTA: Nivel critico y bomba no iniciada!");
    alerta_baja_emitida = true;
  }
  
  if (nuevo_estado != ultimo_estado_bomba) {
    ultimo_estado_bomba = nuevo_estado;
    ultimo_cambio_bomba = ahora;
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
    StaticJsonDocument<256> doc;
    deserializeJson(doc, msg);
    
    if (doc.containsKey("cmd")) {
      String cmd = doc["cmd"].as<String>();
      if (cmd == "pump_on" || cmd == "ON") {
        ultimo_estado_bomba = true;
        config_modo_auto = false;
        Serial.println("CMD: Bomba ON");
      } else if (cmd == "pump_off" || cmd == "OFF") {
        ultimo_estado_bomba = false;
        config_modo_auto = false;
        Serial.println("CMD: Bomba OFF");
      }
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
    Serial.println("Config guardada en EEPROM");
  }
}

// ---------------- MQTT ----------------
void reconnectMQTT() {
  unsigned long ahora = millis();
  if (ahora - lastMqttAttempt < 5000) return;
  lastMqttAttempt = ahora;
  
  if (!client.connected()) {
    Serial.println("Conectando MQTT...");
    
    if (client.connect(device_id.c_str(), mqtt_user, mqtt_pass)) {
      Serial.println("MQTT conectado!");
      mqtt_conectado = true;
      
      client.subscribe((base_topic + "/config").c_str());
      client.subscribe((base_topic + "/command").c_str());

      StaticJsonDocument<200> doc;
      doc["device_id"] = device_id;
      doc["type"] = "nivel_tanque";
      doc["altura_tanque"] = altura_tanque;

      char buffer[200];
      serializeJson(doc, buffer);
      client.publish("devices/register", buffer);
    } else {
      mqtt_conectado = false;
    }
  }
}

// ---------------- SETUP ----------------
void setup() {
  Serial.begin(115200);
  Serial.println("\n========================================");
  Serial.println("AgroSentinel v2.0 - Control de Bomba");
  Serial.println("========================================");

  bootTime = millis();

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(SENSOR_RESERVA, INPUT);
  pinMode(RELE_PIN, OUTPUT);

  digitalWrite(RELE_PIN, LOW);
  digitalWrite(TRIG_PIN, LOW);

  cargarConfig();

  Serial.println("Device ID: " + device_id);
  Serial.println("Config - Min: " + String(config_nivel_min) + "%, Max: " + String(config_nivel_max) + "%, Alerta: " + String(config_alerta_baja) + "%");

  WiFiManager wm;
  wm.setTimeout(180);
  if (!wm.autoConnect("AGROSENTINEL-SETUP")) {
    ESP.restart();
  }

  wifi_conectado = true;
  Serial.println("WiFi OK - IP: " + WiFi.localIP().toString());

  base_topic = "devices/" + device_id;

  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setKeepAlive(30);
  client.setSocketTimeout(10);
}

// ---------------- LOOP ----------------
void loop() {
  if (millis() - lastWifiCheck > 10000) {
    lastWifiCheck = millis();
    verificarWifi();
  }

  if (wifi_conectado) {
    if (!client.connected()) reconnectMQTT();
    client.loop();
  }

  int nivel = leerNivelTanque();
  int reserva = leerNivelReserva();

  controlarBomba(nivel, reserva);

  // Telemetría
  if (millis() - lastSend > 15000 && mqtt_conectado) {
    lastSend = millis();

    StaticJsonDocument<512> doc;
    doc["device_id"] = device_id;
    doc["nivel"] = nivel;
    doc["reserva"] = reserva;
    doc["bomba"] = ultimo_estado_bomba;
    doc["rssi"] = WiFi.RSSI();
    doc["altura_tanque"] = altura_tanque;
    doc["wifi"] = wifi_conectado;
    doc["mqtt"] = mqtt_conectado;
    doc["config_nivel_min"] = config_nivel_min;
    doc["config_nivel_max"] = config_nivel_max;
    doc["config_alerta_baja"] = config_alerta_baja;
    doc["config_modo_auto"] = config_modo_auto;
    doc["config_habilitar_bomba"] = config_habilitar_bomba;

    char buffer[512];
    serializeJson(doc, buffer);
    client.publish((base_topic + "/telemetry").c_str(), buffer);
    
    Serial.println("Nivel: " + String(nivel) + "% - Bomba: " + String(ultimo_estado_bomba ? "ON" : "OFF"));
  }

  // Heartbeat
  if (millis() - lastHeartbeat > 30000 && mqtt_conectado) {
    lastHeartbeat = millis();
    client.publish((base_topic + "/heartbeat").c_str(), "1");
  }

  // Auto-reinicio cada 24h
  if (millis() - bootTime > 86400000) {
    ESP.restart();
  }

  delay(100);
}
