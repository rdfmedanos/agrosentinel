# AgroSentinel Firmware

Firmware para dispositivos ESP8266 con sensor de nivel de tanque JSN-SR04T.

## Hardware Required

- ESP8266 (NodeMCU)
- Sensor ultrasonico JSN-SR04T (más estable que HC-SR04)
- Sensor de reserva (float switch)
- Relay 5V

## Pinout

| Pin | Función |
|-----|---------|
| D1  | ECHO    |
| D2  | TRIG    |
| D3  | Sensor Reserva |
| D4  | Relay   |

## Características de Estabilidad

- **Filtro de mediana**: 7 lecturas consecutivas ordenadas y se toma la mediana para eliminar picos
- **Anti-rebote en bomba**: 5 segundos de delay entre cambios de estado
- **Histéresis**: El nivel mínimo y máximo evitan oscilaciones constantes
- **Validación de distancia**: Descarta lecturas fuera del rango válido

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
  "rssi": -45,
  "altura_tanque": 150
}
```

## Configuración Remota

```json
{
  "nivel_min": 30,
  "nivel_max": 90,
  "modo": "auto",
  "altura_tanque": 150
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

## Ajuste del Tanque

Editar estas líneas según tu tanque:
```cpp
int altura_tanque = 150;    // cm desde el sensor hasta el fondo
int distancia_sensor = 20;  // cm desde el sensor hasta el nivel máximo
```

## Licencia

MIT
