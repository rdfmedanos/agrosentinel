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

// ID ÚNICO AUTOMÁTICO
String device_id = "ESP8266_" + String(ESP.getChipId(), HEX);
String base_topic;

// Estados de conexión
bool wifi_conectado = false;
bool mqtt_conectado = false;

// Config dinámica
int nivel_min = 30;
int nivel_max = 90;
bool modo_auto = true;

bool bomba = false;
bool ultimo_estado_bomba = false;

unsigned long lastSend = 0;
unsigned long lastHeartbeat = 0;
unsigned long ultimo_cambio_bomba = 0;
unsigned long lastWifiCheck = 0;
unsigned long lastMqttAttempt = 0;

// CONFIG TANQUE
int altura_tanque = 150;
int distancia_sensor = 20;

// Contador de reinicios
int rebootCount = 0;
unsigned long bootTime = 0;

// ---------------- EEPROM ----------------
void guardarConfig() {
  EEPROM.begin(512);
  EEPROM.write(0, nivel_min);
  EEPROM.write(1, nivel_max);
  EEPROM.write(2, modo_auto ? 1 : 0);
  EEPROM.commit();
  EEPROM.end();
}

void cargarConfig() {
  EEPROM.begin(512);
  nivel_min = EEPROM.read(0);
  nivel_max = EEPROM.read(1);
  modo_auto = EEPROM.read(2) == 1;

  if (nivel_min == 0 || nivel_min > 100) nivel_min = 30;
  if (nivel_max == 0 || nivel_max > 100) nivel_max = 90;
  EEPROM.end();
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
      Serial.print(".");
    }
    
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\nWiFi reconnectado!");
      Serial.println("IP: " + WiFi.localIP().toString());
      wifi_conectado = true;
      mqtt_conectado = false;  // Forzar reconexión MQTT
    }
  } else {
    if (!wifi_conectado) {
      Serial.println("WiFi conectado!");
      Serial.println("IP: " + WiFi.localIP().toString());
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
  
  int rango = altura_tanque - distancia_sensor;
  int nivel = map(distancia, altura_tanque, distancia_sensor, 0, 100);
  
  return constrain(nivel, 0, 100);
}

int leerNivelReserva() {
  return digitalRead(SENSOR_RESERVA) ? 100 : 0;
}

// ---------------- Control Bomba ----------------
void controlarBomba(int nivel, int reserva) {
  unsigned long ahora = millis();
  
  if (ahora - ultimo_cambio_bomba < 5000) {
    digitalWrite(RELE_PIN, ultimo_estado_bomba ? HIGH : LOW);
    return;
  }
  
  bool nuevo_estado = ultimo_estado_bomba;
  
  if (modo_auto) {
    if (nivel < nivel_min && reserva > 10 && !ultimo_estado_bomba) {
      nuevo_estado = true;
    } else if (nivel >= nivel_max && ultimo_estado_bomba) {
      nuevo_estado = false;
    }
  }
  
  if (nuevo_estado != ultimo_estado_bomba) {
    ultimo_estado_bomba = nuevo_estado;
    ultimo_cambio_bomba = ahora;
    Serial.print("Bomba: ");
    Serial.println(nuevo_estado ? "ON" : "OFF");
  }
  
  digitalWrite(RELE_PIN, ultimo_estado_bomba ? HIGH : LOW);
}

// ---------------- MQTT ----------------
void reconnectMQTT() {
  unsigned long ahora = millis();
  
  // No intentar más de una vez cada 5 segundos
  if (ahora - lastMqttAttempt < 5000) return;
  lastMqttAttempt = ahora;
  
  if (!client.connected()) {
    Serial.println("Intentando conectar a MQTT...");
    
    if (client.connect(device_id.c_str(), mqtt_user, mqtt_pass)) {
      Serial.println("MQTT conectado!");
      mqtt_conectado = true;
      
      client.subscribe((base_topic + "/config").c_str());
      client.subscribe((base_topic + "/command").c_str());

      // Auto-registro
      StaticJsonDocument<200> doc;
      doc["device_id"] = device_id;
      doc["type"] = "nivel_tanque";
      doc["altura_tanque"] = altura_tanque;

      char buffer[200];
      serializeJson(doc, buffer);
      client.publish("devices/register", buffer);
      Serial.println("Registro enviado!");
    } else {
      Serial.print("MQTT falló, código: ");
      Serial.println(client.state());
      mqtt_conectado = false;
    }
  }
}

// ---------------- MQTT CALLBACK ----------------
void callback(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (int i = 0; i < length; i++) msg += (char)payload[i];

  String t = String(topic);
  Serial.println("Mensaje MQTT en: " + t);

  if (t.endsWith("/config")) {
    StaticJsonDocument<256> doc;
    deserializeJson(doc, msg);

    if (doc.containsKey("nivel_min")) nivel_min = doc["nivel_min"];
    if (doc.containsKey("nivel_max")) nivel_max = doc["nivel_max"];
    if (doc.containsKey("modo")) modo_auto = (String)doc["modo"] == "auto";
    if (doc.containsKey("altura_tanque")) altura_tanque = doc["altura_tanque"];

    guardarConfig();
    Serial.println("Configuración actualizada!");
  }

  if (t.endsWith("/command")) {
    if (msg == "ON") {
      ultimo_estado_bomba = true;
      modo_auto = false;
      Serial.println("Comando: BOMBA ON");
    }
    if (msg == "OFF") {
      ultimo_estado_bomba = false;
      modo_auto = false;
      Serial.println("Comando: BOMBA OFF");
    }
  }
}

// ---------------- SETUP ----------------
void setup() {
  Serial.begin(115200);
  Serial.println("\n========================================");
  Serial.println("Iniciando AgroSentinel JSN-SR04T...");
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
  Serial.println("Config - Min: " + String(nivel_min) + ", Max: " + String(nivel_max));

  // WiFi Manager con auto-reconnect
  WiFiManager wm;
  wm.setTimeout(180);
  wm.setAutoReconnect(true);
  
  if (!wm.autoConnect("AGROSENTINEL-SETUP")) {
    Serial.println("WiFi fallback falló, reiniciando...");
    delay(3000);
    ESP.restart();
  }

  wifi_conectado = true;
  Serial.println("WiFi conectado!");
  Serial.println("IP: " + WiFi.localIP().toString());

  base_topic = "devices/" + device_id;

  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setKeepAlive(30);
  client.setSocketTimeout(10);

  Serial.println("Setup completado!");
}

// ---------------- LOOP ----------------
void loop() {
  // Verificar WiFi cada 10 segundos
  if (millis() - lastWifiCheck > 10000) {
    lastWifiCheck = millis();
    verificarWifi();
  }

  // Solo procesar MQTT si hay WiFi
  if (wifi_conectado) {
    if (!client.connected()) {
      reconnectMQTT();
    }
    client.loop();
  }

  // Leer sensores
  int nivel = leerNivelTanque();
  int reserva = leerNivelReserva();

  // Controlar bomba
  controlarBomba(nivel, reserva);

  // Telemetría cada 15 segundos
  if (millis() - lastSend > 15000 && mqtt_conectado) {
    lastSend = millis();

    StaticJsonDocument<256> doc;
    doc["device_id"] = device_id;
    doc["nivel"] = nivel;
    doc["reserva"] = reserva;
    doc["bomba"] = ultimo_estado_bomba;
    doc["rssi"] = WiFi.RSSI();
    doc["altura_tanque"] = altura_tanque;
    doc["wifi"] = wifi_conectado;
    doc["mqtt"] = mqtt_conectado;

    char buffer[256];
    serializeJson(doc, buffer);
    client.publish((base_topic + "/telemetry").c_str(), buffer);
    
    Serial.println("Telemetría enviada - Nivel: " + String(nivel) + "%");
  }

  // Heartbeat cada 30 segundos
  if (millis() - lastHeartbeat > 30000 && mqtt_conectado) {
    lastHeartbeat = millis();
    client.publish((base_topic + "/heartbeat").c_str(), "1");
  }

  // Auto-reinicio si lleva más de 24 horas funcionando (para stability)
  if (bootTime > 0 && millis() - bootTime > 86400000) {
    Serial.println("Reinicio programado por stability...");
    ESP.restart();
  }

  delay(100);
}
