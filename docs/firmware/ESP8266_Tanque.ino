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

#define LED_ESTADO LED_BUILTIN

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

// ---------------- CONFIGURACION ----------------
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
  if (cfg.altura_tanque > 0 && cfg.altura_tanque < 2000) altura_tanque = cfg.altura_tanque;
  if (cfg.distancia_sensor >= 0 && cfg.distancia_sensor < 500) distancia_sensor = cfg.distancia_sensor;
  
  config_modo_auto = cfg.modo_auto;
  config_habilitar_bomba = true; // Forzamos a true porque el panel web no tiene switch y la EEPROM lo rompe
}

// ---------------- SENSOR ----------------
#define NUM_LECTURAS 5
int lecturas[NUM_LECTURAS];

int leerDistanciaJSN() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // Aumentamos el timeout a 30ms (~5 metros)
  long duracion = pulseIn(ECHO_PIN, HIGH, 30000);
  
  if (duracion == 0) {
    // Un timeout de 0 suele ser "zona muerta" (agua muy cerca) o desconexion.
    // Lo tratamos como 0cm para que la logica de "Lleno" lo capture.
    return 0;
  }
  
  int dist = duracion * 0.034 / 2;
  return dist;
}

int filtroMediana() {
  int validas = 0;
  int ceros = 0;
  int temp_lecturas[NUM_LECTURAS];
  
  for (int i = 0; i < NUM_LECTURAS; i++) {
    int dist = leerDistanciaJSN();
    delay(100); // Aumentar delay para dejar que los ecos se disipen
    
    if (dist >= 0 && dist < 500) {
      temp_lecturas[validas] = dist;
      validas++;
      if (dist == 0) ceros++;
      Serial.print(String(dist) + " ");
    } else {
      Serial.print("X ");
    }
  }
  Serial.println();

  if (validas == 0) return -1;
  
  // Si tenemos lecturas mayores a 0, preferimos ignorar los 0s (ruido/errores)
  // a menos que sea la UNICA lectura que tenemos (zona muerta real).
  int validas_dist = 0;
  int temp_dist[NUM_LECTURAS];
  for (int i = 0; i < validas; i++) {
    if (temp_lecturas[i] > 0) {
      temp_dist[validas_dist] = temp_lecturas[i];
      validas_dist++;
    }
  }

  // Si no hay lecturas > 0 pero sí hubo lecturas válidas (fueron 0)
  if (validas_dist == 0 && validas > 0) {
    Serial.println("DEBUG: Sensor en zona muerta (o desconectado)");
    return 0;
  }
  
  // Ordenar solo las lecturas > 0
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
  return mediana;
}

int leerNivelTanque() {
  int distancia = filtroMediana();
  
  if (distancia == -1) {
    Serial.println("ALERTA: Sensor no responde (revisar cables/alimentacion)");
    return -1; 
  }

  Serial.println("Distancia: " + String(distancia) + " cm");
  
  // Si la distancia es menor a la distancia_sensor (ej: 20cm), esta lleno (100%)
  // Esto incluye el caso de distancia = 0 (zona muerta)
  if (distancia <= distancia_sensor) return 100;
  if (distancia > altura_tanque) distancia = altura_tanque;
  
  int nivel = map(distancia, altura_tanque, distancia_sensor, 0, 100);
  nivel = constrain(nivel, 0, 100);
  Serial.println("Nivel calculado: " + String(nivel) + "%");
  return nivel;
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
      Serial.printf("DEBUG PUMP: nivel(%d) < min(%d) && reserva(%d) > 10... ENCENDIENDO\n", nivel, config_nivel_min, reserva);
      nuevo_estado = true;
    } else if (nivel >= config_nivel_max && ultimo_estado_bomba) {
      Serial.printf("DEBUG PUMP: nivel(%d) >= max(%d)... APAGANDO\n", nivel, config_nivel_max);
      nuevo_estado = false;
    } else if (!ultimo_estado_bomba && nivel < config_nivel_min) {
      // Si la bomba no prende, es porque reserva no es > 10
      Serial.printf("DEBUG PUMP FALLO: nivel(%d) < min(%d) PERO reserva(%d) no es > 10\n", nivel, config_nivel_min, reserva);
    }
  } else {
    static unsigned long last_debug = 0;
    if (ahora - last_debug > 5000) {
      Serial.printf("DEBUG PUMP BLOQUEADO: modo_auto=%d, habilitar_bomba=%d\n", config_modo_auto, config_habilitar_bomba);
      last_debug = ahora;
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
  
  Serial.print("Intentando MQTT: ");
  Serial.println(mqtt_server);
  
  if (client.connect(device_id.c_str(), mqtt_user, mqtt_pass, 0, 0, 0, 1)) {
    digitalWrite(LED_ESTADO, LOW);
    Serial.println("MQTT conectado!");
    mqtt_conectado = true;
    
    client.subscribe((base_topic + "/config").c_str(), 1);
    client.subscribe((base_topic + "/command").c_str(), 1);

    StaticJsonDocument<200> doc;
    doc["device_id"] = device_id;
    doc["type"] = "nivel_tanque";
    char buffer[200];
    serializeJson(doc, buffer);
    client.publish((base_topic + "/register").c_str(), buffer, false, 1);
    Serial.println("Registro enviado a " + base_topic + "/register");
  } else {
    Serial.print("MQTT fallo, rc=");
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
  pinMode(LED_ESTADO, OUTPUT);

  digitalWrite(RELE_PIN, LOW);
  digitalWrite(TRIG_PIN, LOW);
  digitalWrite(LED_ESTADO, HIGH); // LED OFF

  device_id = "ESP8266_" + String(ESP.getChipId(), HEX);
  base_topic = "devices/" + device_id;

  cargarConfig();

  Serial.println("Device: " + device_id);
  
  WiFiManager wm;
  wm.setTimeout(180);
  
  if (!wm.autoConnect("AGROSENTINEL-SETUP")) {
    Serial.println("WiFi fallo, reiniciando...");
    delay(3000);
    ESP.restart();
  }

  wifi_conectado = true;
  Serial.println("WiFi OK: " + WiFi.localIP().toString());

  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
  client.setKeepAlive(90);
  client.setSocketTimeout(15);
}

// ---------------- LOOP ----------------
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
    client.publish((base_topic + "/telemetry").c_str(), buffer, false, 1);
    
    if (nivel == -1) {
      Serial.println("Estado: ERROR DE SENSOR | Bomba: " + String(ultimo_estado_bomba ? "ON" : "OFF"));
    } else {
      Serial.println("Nivel: " + String(nivel) + "% | Bomba: " + String(ultimo_estado_bomba ? "ON" : "OFF"));
    }
  }

  if (millis() - lastHeartbeat > 30000 && client.connected() && mqtt_conectado) {
    lastHeartbeat = millis();
    client.publish((base_topic + "/heartbeat").c_str(), "1");
  }

  if (millis() - bootTime > 86400000) {
    ESP.restart();
  }

  delay(100);
}
