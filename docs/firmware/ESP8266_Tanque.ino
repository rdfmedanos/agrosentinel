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

// Config dinámica
int nivel_min = 30;
int nivel_max = 90;
bool modo_auto = true;

bool bomba = false;

unsigned long lastSend = 0;
unsigned long lastHeartbeat = 0;

// CONFIG TANQUE
int altura_tanque = 150;

// ---------------- EEPROM ----------------
void guardarConfig() {
  EEPROM.begin(512);

  EEPROM.write(0, nivel_min);
  EEPROM.write(1, nivel_max);
  EEPROM.write(2, modo_auto);

  EEPROM.commit();
  EEPROM.end();
}

void cargarConfig() {
  EEPROM.begin(512);

  nivel_min = EEPROM.read(0);
  nivel_max = EEPROM.read(1);
  modo_auto = EEPROM.read(2);

  // Valores por defecto si EEPROM vacía
  if (nivel_min == 0) nivel_min = 30;
  if (nivel_max == 0) nivel_max = 90;

  EEPROM.end();
}

// ---------------- SENSOR ----------------
int leerDistancia() {

  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duracion = pulseIn(ECHO_PIN, HIGH, 30000);

  return duracion * 0.034 / 2;
}

int leerNivelTanque() {

  int suma = 0;

  for (int i = 0; i < 5; i++) {
    suma += leerDistancia();
    delay(50);
  }

  int distancia = suma / 5;

  int nivel = map(distancia, altura_tanque, 20, 0, 100);
  return constrain(nivel, 0, 100);
}

int leerNivelReserva() {
  return digitalRead(SENSOR_RESERVA) ? 100 : 0;
}

// ---------------- MQTT CALLBACK ----------------
void callback(char* topic, byte* payload, unsigned int length) {

  String msg;
  for (int i = 0; i < length; i++) msg += (char)payload[i];

  String t = String(topic);

  if (t.endsWith("/config")) {

    StaticJsonDocument<256> doc;
    deserializeJson(doc, msg);

    nivel_min = doc["nivel_min"] | nivel_min;
    nivel_max = doc["nivel_max"] | nivel_max;
    modo_auto = doc["modo"] == "auto";

    guardarConfig();
  }

  if (t.endsWith("/command")) {
    if (msg == "ON") bomba = true;
    if (msg == "OFF") bomba = false;
  }
}

// ---------------- MQTT ----------------
void reconnect() {

  while (!client.connected()) {

    if (client.connect(device_id.c_str(), mqtt_user, mqtt_pass)) {

      client.subscribe((base_topic + "/config").c_str());
      client.subscribe((base_topic + "/command").c_str());

      // ANUNCIO (AUTO REGISTRO)
      StaticJsonDocument<200> doc;
      doc["device_id"] = device_id;
      doc["type"] = "nivel_tanque";

      char buffer[200];
      serializeJson(doc, buffer);

      client.publish("devices/register", buffer);

    } else {
      delay(5000);
    }
  }
}

// ---------------- SETUP ----------------
void setup() {

  Serial.begin(115200);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(SENSOR_RESERVA, INPUT);
  pinMode(RELE_PIN, OUTPUT);

  digitalWrite(RELE_PIN, LOW);

  cargarConfig();

  // WiFi portal
  WiFiManager wm;
  wm.autoConnect("AGROSENTINEL-SETUP");

  base_topic = "devices/" + device_id;

  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
}

// ---------------- LOOP ----------------
void loop() {

  if (!client.connected()) reconnect();

  client.loop();

  int nivel = leerNivelTanque();
  int reserva = leerNivelReserva();

  // Lógica
  if (modo_auto) {
    if (nivel < nivel_min && reserva > 10) bomba = true;
    if (nivel >= nivel_max) bomba = false;
  }

  digitalWrite(RELE_PIN, bomba);

  // TELEMETRÍA PRO
  if (millis() - lastSend > 15000) {
    lastSend = millis();

    StaticJsonDocument<256> doc;

    doc["device_id"] = device_id;
    doc["nivel"] = nivel;
    doc["reserva"] = reserva;
    doc["bomba"] = bomba;
    doc["rssi"] = WiFi.RSSI();

    char buffer[256];
    serializeJson(doc, buffer);

    client.publish((base_topic + "/telemetry").c_str(), buffer);
  }

  // HEARTBEAT
  if (millis() - lastHeartbeat > 30000) {
    lastHeartbeat = millis();
    client.publish((base_topic + "/heartbeat").c_str(), "1");
  }
}
