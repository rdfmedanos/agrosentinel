#include <WiFi.h>
#include <WiFiManager.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <EEPROM.h>

const char* mqtt_server = "192.168.100.20";
const int mqtt_port = 1883;
const char* mqtt_user = "admin@agrosentinel.com";
const char* mqtt_pass = "Empresa123!";

#define LED_ESTADO 2

#define TRIG_PIN 4
#define ECHO_PIN 15
#define SENSOR_RESERVA 19
#define RELE_PIN 21

WiFiClient espClient;
PubSubClient client(espClient);

String device_id;
String base_topic;

bool wifi_conectado = false;
bool mqtt_conectado = false;

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
  if (cfg.altura_tanque > 0 && cfg.altura_tanque < 2000) altura_tanque = cfg.altura_tanque;
  if (cfg.distancia_sensor >= 0 && cfg.distancia_sensor < 500) distancia_sensor = cfg.distancia_sensor;
  
  config_modo_auto = cfg.modo_auto;
  config_habilitar_bomba = true;
}

#define NUM_LECTURAS 5

int leerDistanciaJSN() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(20);
  digitalWrite(TRIG_PIN, LOW);

  delayMicroseconds(100);

  unsigned long start = micros();
  int timeout = 0;
  while (digitalRead(ECHO_PIN) == LOW) {
    if (micros() - start > 30000) {
      timeout = 1;
      break;
    }
  }
  
  if (timeout) return -1;
  
  unsigned long echoStart = micros();
  while (digitalRead(ECHO_PIN) == HIGH) {
    if (micros() - echoStart > 30000) return -1;
  }
  long duracion = micros() - echoStart;
  
  if (duracion > 25000) return -1;
  
  int dist = duracion * 0.034 / 2;
  return dist;
}

int filtroMediana() {
  int validas = 0;
  int temp_lecturas[NUM_LECTURAS];
  
  for (int i = 0; i < NUM_LECTURAS; i++) {
    int dist = leerDistanciaJSN();
    delay(100);
    
    if (dist >= 0 && dist < 500) {
      temp_lecturas[validas] = dist;
      validas++;
    }
  }

  Serial.print("Lecturas: ");
  for (int i = 0; i < validas; i++) {
    Serial.print(temp_lecturas[i]);
    Serial.print(" ");
  }
  Serial.println();

  if (validas == 0) return -1;
  
  int validas_dist = 0;
  int temp_dist[NUM_LECTURAS];
  for (int i = 0; i < validas; i++) {
    if (temp_lecturas[i] > 0) {
      temp_dist[validas_dist] = temp_lecturas[i];
      validas_dist++;
    }
  }

  if (validas_dist == 0 && validas > 0) return 0;
  
  for (int i = 0; i < validas_dist - 1; i++) {
    for (int j = 0; j < validas_dist - i - 1; j++) {
      if (temp_dist[j] > temp_dist[j + 1]) {
        int temp = temp_dist[j];
        temp_dist[j] = temp_dist[j + 1];
        temp_dist[j + 1] = temp;
      }
    }
  }
  
  int mediana = temp_dist[validas_dist / 2];
  Serial.print("Mediana: ");
  Serial.println(mediana);
  return mediana;
}

int leerNivelTanque() {
  int distancia = filtroMediana();
  
  if (distancia == -1) return -1; 

  Serial.print("Distancia: ");
  Serial.print(distancia);
  Serial.print(" cm, altura_tanque: ");
  Serial.println(altura_tanque);
  
  if (distancia <= distancia_sensor) return 100;
  if (distancia > altura_tanque) distancia = altura_tanque;
  
  Serial.print("Distancia limitada: ");
  Serial.println(distancia);
  
  int nivel = map(distancia, altura_tanque, distancia_sensor, 0, 100);
  nivel = constrain(nivel, 0, 100);
  
  Serial.print("Nivel: ");
  Serial.println(nivel);
  
  return nivel;
}

int leerNivelReserva() {
  return digitalRead(SENSOR_RESERVA) ? 100 : 0;
}

void controlarBomba(int nivel, int reserva) {
  unsigned long ahora = millis();
  
  if (ahora - ultimo_cambio_bomba < 3000) {
    digitalWrite(RELE_PIN, ultimo_estado_bomba ? HIGH : LOW);
    return;
  }
  
  bool nuevo_estado = ultimo_estado_bomba;
  
  if (config_modo_auto && config_habilitar_bomba) {
    Serial.print("Bomba check: nivel=");
    Serial.print(nivel);
    Serial.print(" min=");
    Serial.print(config_nivel_min);
    Serial.print(" reserva=");
    Serial.print(reserva);
    Serial.print(" ultimo_estado=");
    Serial.println(ultimo_estado_bomba);
    
    if (nivel < config_nivel_min && !ultimo_estado_bomba) {
      Serial.println("-> ENCENDIENDO BOMBA");
      nuevo_estado = true;
    } else if (nivel >= config_nivel_max && ultimo_estado_bomba) {
      Serial.println("-> APAGANDO BOMBA");
      nuevo_estado = false;
    }
  }
  
  if (nivel < config_alerta_baja && ultimo_estado_bomba == false && !alerta_baja_emitida) {
    alerta_baja_emitida = true;
  }
  
  if (nuevo_estado != ultimo_estado_bomba) {
    ultimo_estado_bomba = nuevo_estado;
    ultimo_cambio_bomba = ahora;
  }
  
  digitalWrite(RELE_PIN, ultimo_estado_bomba ? HIGH : LOW);
}

void callback(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (int i = 0; i < length; i++) msg += (char)payload[i];

  String t = String(topic);

  if (t.endsWith("/command")) {
    if (msg == "ON" || msg.indexOf("\"cmd\":\"pump_on\"") >= 0) {
      ultimo_estado_bomba = true;
      config_modo_auto = false;
    } else if (msg == "OFF" || msg.indexOf("\"cmd\":\"pump_off\"") >= 0) {
      ultimo_estado_bomba = false;
      config_modo_auto = false;
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
  }
}

void reconnectMQTT() {
  if (client.connected()) {
    mqtt_conectado = true;
    return;
  }
  
  unsigned long ahora = millis();
  if (ahora - lastMqttAttempt < 3000) return;
  lastMqttAttempt = ahora;
  
  if (client.connect(device_id.c_str(), mqtt_user, mqtt_pass)) {
    digitalWrite(LED_ESTADO, LOW);
    mqtt_conectado = true;
    
    client.subscribe((base_topic + "/config").c_str());
    client.subscribe((base_topic + "/command").c_str());

    StaticJsonDocument<200> doc;
    doc["device_id"] = device_id;
    doc["type"] = "nivel_tanque";
    char buffer[200];
    serializeJson(doc, buffer);
    client.publish((base_topic + "/register").c_str(), (uint8_t*)buffer, strlen(buffer));
  } else {
    mqtt_conectado = false;
  }
}

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("AgroSentinel ESP32 v1.0");

  bootTime = millis();

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(SENSOR_RESERVA, INPUT);
  pinMode(RELE_PIN, OUTPUT);
  pinMode(LED_ESTADO, OUTPUT);

  digitalWrite(RELE_PIN, LOW);
  digitalWrite(TRIG_PIN, LOW);
  digitalWrite(LED_ESTADO, HIGH);

  uint64_t chipid = ESP.getEfuseMac();
  device_id = "ESP32_" + String((uint16_t)(chipid >> 32), HEX) + String((uint32_t)chipid, HEX);
  base_topic = "devices/" + device_id;

  cargarConfig();
  
  WiFiManager wm;
  wm.setTimeout(180);
  
  if (!wm.autoConnect("AGROSENTINEL-SETUP")) {
    delay(3000);
    ESP.restart();
  }

  wifi_conectado = true;

  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setKeepAlive(90);
  client.setSocketTimeout(15);
}

void loop() {
  if (!client.connected()) {
    reconnectMQTT();
  }
  
  int mqttState = client.state();
  if (mqttState != 0 && mqttState != -2) {
    mqtt_conectado = false;
  }
  
  client.loop();

  int nivel = leerNivelTanque();
  int reserva = leerNivelReserva();

  if (nivel != -1) {
    controlarBomba(nivel, reserva);
  }

  if (millis() - lastSend > 15000 && client.connected() && mqtt_conectado) {
    lastSend = millis();

    StaticJsonDocument<512> doc;
    doc["device_id"] = device_id;
    if (nivel != -1) doc["nivel"] = nivel;
    doc["reserva"] = reserva;
    doc["bomba"] = ultimo_estado_bomba;
    doc["rssi"] = WiFi.RSSI();
    doc["h"] = altura_tanque;
    doc["s"] = distancia_sensor;
    if (nivel == -1) doc["error"] = "sensor_hardware_fail";

    char buffer[512];
    serializeJson(doc, buffer);
    client.publish((base_topic + "/telemetry").c_str(), (uint8_t*)buffer, strlen(buffer));
    
    Serial.print("Nivel: ");
    Serial.print(nivel);
    Serial.println("%");
  }

  if (millis() - lastHeartbeat > 30000 && client.connected() && mqtt_conectado) {
    lastHeartbeat = millis();
    client.publish((base_topic + "/heartbeat").c_str(), (uint8_t*)"1", 1);
  }

  if (millis() - bootTime > 86400000) {
    ESP.restart();
  }

  delay(100);
}