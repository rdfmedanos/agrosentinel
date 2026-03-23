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
bool ultimo_estado_bomba = false;

unsigned long lastSend = 0;
unsigned long lastHeartbeat = 0;
unsigned long ultimo_cambio_bomba = 0;

// CONFIG TANQUE (ajustar según tu tanque)
int altura_tanque = 150;  // cm desde el sensor hasta el fondo
int distancia_sensor = 20; // cm desde el sensor hasta el nivel máximo (agua)

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

// ---------------- SENSOR JSN-SR04T ----------------
// Lecturas para filtro de mediana
#define NUM_LECTURAS 7
int lecturas[NUM_LECTURAS];
int indice_lectura = 0;
bool primeraLectura = true;

int leerDistanciaJSN() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(20);
  digitalWrite(TRIG_PIN, LOW);

  long duracion = pulseIn(ECHO_PIN, HIGH, 30000);
  
  if (duracion == 0) {
    return -1;  // Sin respuesta del sensor
  }
  
  return duracion * 0.034 / 2;
}

int filtroMediana() {
  // Recolectar lecturas
  for (int i = 0; i < NUM_LECTURAS; i++) {
    int dist = leerDistanciaJSN();
    
    if (dist < 0 || dist > 500) {
      // Lectura inválida, usar la última válida
      dist = (i > 0) ? lecturas[i-1] : altura_tanque;
    }
    
    lecturas[i] = dist;
    delay(80);  // Delay entre lecturas (JSN necesita más tiempo)
  }

  // Ordenar y tomar la mediana
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
  
  // Verificar que la distancia sea razonable
  if (distancia < distancia_sensor || distancia > altura_tanque) {
    distancia = constrain(distancia, distancia_sensor, altura_tanque);
  }
  
  // Mapear distancia a porcentaje
  int rango = altura_tanque - distancia_sensor;
  int nivel = map(distancia, altura_tanque, distancia_sensor, 0, 100);
  
  return constrain(nivel, 0, 100);
}

int leerNivelReserva() {
  return digitalRead(SENSOR_RESERVA) ? 100 : 0;
}

// ---------------- Control Bomba con Anti-rebote ----------------
void controlarBomba(int nivel, int reserva) {
  unsigned long ahora = millis();
  
  // Solo cambiar estado si pasó suficiente tiempo desde el último cambio
  if (ahora - ultimo_cambio_bomba < 5000) {
    digitalWrite(RELE_PIN, ultimo_estado_bomba ? HIGH : LOW);
    return;
  }
  
  bool nuevo_estado = ultimo_estado_bomba;
  
  if (modo_auto) {
    // Lógica con histéresis
    if (nivel < nivel_min && reserva > 10 && !ultimo_estado_bomba) {
      nuevo_estado = true;
    } else if (nivel >= nivel_max && ultimo_estado_bomba) {
      nuevo_estado = false;
    }
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

  if (t.endsWith("/config")) {
    StaticJsonDocument<256> doc;
    deserializeJson(doc, msg);

    if (doc.containsKey("nivel_min")) nivel_min = doc["nivel_min"];
    if (doc.containsKey("nivel_max")) nivel_max = doc["nivel_max"];
    if (doc.containsKey("modo")) modo_auto = (String)doc["modo"] == "auto";
    if (doc.containsKey("altura_tanque")) altura_tanque = doc["altura_tanque"];

    guardarConfig();
  }

  if (t.endsWith("/command")) {
    if (msg == "ON") {
      ultimo_estado_bomba = true;
      modo_auto = false;
    }
    if (msg == "OFF") {
      ultimo_estado_bomba = false;
      modo_auto = false;
    }
  }
}

// ---------------- MQTT ----------------
void reconnect() {
  while (!client.connected()) {
    if (client.connect(device_id.c_str(), mqtt_user, mqtt_pass)) {
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
    } else {
      delay(5000);
    }
  }
}

// ---------------- SETUP ----------------
void setup() {
  Serial.begin(115200);
  Serial.println("Iniciando Sensor de Nivel JSN-SR04T...");

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(SENSOR_RESERVA, INPUT);
  pinMode(RELE_PIN, OUTPUT);

  digitalWrite(RELE_PIN, LOW);
  digitalWrite(TRIG_PIN, LOW);

  cargarConfig();

  // WiFi portal
  WiFiManager wm;
  wm.setTimeout(180);
  if (!wm.autoConnect("AGROSENTINEL-SETUP")) {
    ESP.restart();
  }

  base_topic = "devices/" + device_id;

  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);

  Serial.println("Device ID: " + device_id);
}

// ---------------- LOOP ----------------
void loop() {
  if (!client.connected()) reconnect();
  client.loop();

  int nivel = leerNivelTanque();
  int reserva = leerNivelReserva();

  controlarBomba(nivel, reserva);

  // Telemetría cada 15 segundos
  if (millis() - lastSend > 15000) {
    lastSend = millis();

    StaticJsonDocument<256> doc;
    doc["device_id"] = device_id;
    doc["nivel"] = nivel;
    doc["reserva"] = reserva;
    doc["bomba"] = ultimo_estado_bomba;
    doc["rssi"] = WiFi.RSSI();
    doc["altura_tanque"] = altura_tanque;

    char buffer[256];
    serializeJson(doc, buffer);
    client.publish((base_topic + "/telemetry").c_str(), buffer);
  }

  // Heartbeat cada 30 segundos
  if (millis() - lastHeartbeat > 30000) {
    lastHeartbeat = millis();
    client.publish((base_topic + "/heartbeat").c_str(), "1");
  }

  delay(100);
}
