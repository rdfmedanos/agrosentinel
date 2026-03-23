# AgroSentinel Firmware

Firmware para dispositivos ESP8266 con sensor de nivel de tanque.

## Hardware Required

- ESP8266 (NodeMCU)
- Sensor ultrasonico HC-SR04
- Sensor de reserva (float switch)
- Relay 5V

## Pinout

| Pin | Función |
|-----|---------|
| D1  | ECHO    |
| D2  | TRIG    |
| D3  | Sensor Reserva |
| D4  | Relay   |

## MQTT Topics

- `devices/{device_id}/telemetry` - Datos del sensor (nivel, reserva, bomba)
- `devices/{device_id}/heartbeat` - Keep-alive cada 30s
- `devices/{device_id}/config` - Configuración remotely
- `devices/{device_id}/command` - Control de bomba (ON/OFF)
- `devices/register` - Auto-registro del dispositivo

## Formato Telemetría

```json
{
  "device_id": "ESP8266_XXXXXX",
  "nivel": 75,
  "reserva": 100,
  "bomba": false,
  "rssi": -45
}
```

## Configuración WiFi

El dispositivo crea un AP `AGROSENTINEL-SETUP` para configurar WiFi la primera vez.

## Compilación

Requiere las librerías:
- ESP8266WiFi
- WiFiManager
- PubSubClient
- ArduinoJson
- EEPROM

## Licencia

MIT
