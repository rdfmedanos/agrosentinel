# AgroSentinel

Plataforma SaaS IoT para monitoreo de tanques de agua con ESP32.

Control de aguadas rurales.

Incluye:
- Backend Node.js + Express + MongoDB + MQTT + Socket.IO
- Frontend React + Leaflet en tiempo real
- Alertas automaticas (offline y nivel critico)
- Ordenes de trabajo automáticas a partir de alertas
- Facturacion mensual con estructura preparada para ARCA (Argentina)
- Despliegue en VPS con Docker Compose

## Arquitectura recomendada aplicada

- **TypeScript** en frontend y backend para escalar con seguridad de tipos.
- **Multi-tenant** desde v1 (`tenantId` en modelos clave).
- **Despliegue VPS** con Docker Compose.
- **Facturacion ARCA-ready**: guardado de campos CAE, punto de venta y comprobante para integrar WSFEv1.

## Estructura

```text
agrosentinel/
  apps/
    api/        # API REST + MQTT + Socket.IO + cron jobs
    web/        # Dashboard React
  infra/
    mosquitto/
    nginx/
  docker-compose.yml
```

## Funcionalidades implementadas

### Backend
- API REST:
  - `GET /api/health`
  - `GET/POST /api/devices`
  - `POST /api/devices/:deviceId/command`
  - `GET /api/alerts`
  - `GET /api/work-orders`
  - `PATCH /api/work-orders/:id/assign`
  - `PATCH /api/work-orders/:id/close`
  - `GET /api/billing/plans`
  - `GET /api/billing/invoices`
  - `POST /api/billing/run-monthly`
  - `GET /api/billing/arca-config?tenantId=...`
  - `PUT /api/billing/arca-config?tenantId=...`
- MQTT:
  - Suscripcion `devices/+/#`
  - Heartbeat en `devices/{id}/heartbeat`
  - Telemetria en `devices/{id}/telemetry` o `devices/{id}/status`
  - Comandos en `devices/{id}/command`
- Alertas automaticas:
  - Dispositivo offline por ausencia de heartbeat
  - Nivel critico configurable por `CRITICAL_LEVEL_PCT`
- Ordenes de trabajo:
  - Se crean automaticamente al abrir alertas
  - Asignacion de tecnico
  - Cierre de orden y resolucion de alerta
- Facturacion:
  - Planes por usuario owner
  - Generacion mensual (cron 1ro de mes 03:00)
  - Campos ARCA: `cae`, `ptoVta`, `cbteNro`, `cbteTipo`

### Frontend
- Dashboard principal con tarjetas SaaS
- Mapa interactivo Leaflet con colores por estado
- Panel de alertas
- Panel de ordenes de trabajo
- Panel de facturacion
- Apartado visual de configuracion ARCA (token/sign, CUIT, pto. de venta, mock/real)
- Botones de control de bomba (on/off)
- Actualizacion en tiempo real via Socket.IO

## Topics y payloads MQTT

### Entrada al backend
- `devices/{id}/heartbeat`
  ```json
  { "ts": "2026-03-17T12:00:00.000Z" }
  ```
- `devices/{id}/telemetry`
  ```json
  {
    "levelPct": 42,
    "reserveLiters": 4200,
    "pumpOn": false,
    "ts": "2026-03-17T12:00:00.000Z"
  }
  ```

### Salida desde backend
- `devices/{id}/command`
  ```json
  { "cmd": "pump_on", "requestId": "uuid" }
  ```

## Ejecucion local (dev)

### Requisitos
- Node.js 20+
- MongoDB
- Mosquitto

### 1) API
```bash
cd agrosentinel/apps/api
cp ../../.env.example ../../.env
npm install
npm run dev
```

### 2) Web
```bash
cd agrosentinel/apps/web
cp .env.example .env
npm install
npm run dev
```

Abrir: `http://localhost:5173`

## Despliegue en VPS (Docker Compose)

### 1) Preparar variables
```bash
cd agrosentinel
cp .env.example .env
```

Editar `.env` con valores reales (dominio, credenciales, ARCA, etc).

### 2) Levantar stack
```bash
docker compose up -d --build
```

### 3) Servicios
- Web: `http://IP_VPS:8080`
- API: `http://IP_VPS:4000/api/health`
- MQTT: `IP_VPS:1883`

## Integracion ARCA (Argentina)

La facturacion mensual ya llama WSFEv1 cuando activas modo real.

- Servicio: `apps/api/src/services/arca.service.ts`
- Flujo implementado:
  1. `FECompUltimoAutorizado` para obtener ultimo numero
  2. `FECAESolicitar` para autorizar comprobante
  3. Guardado de `CAE`, vencimiento y numero de comprobante en `Invoice.arca`

Variables relevantes:
- `ARCA_ENABLED=true` habilita ARCA
- `ARCA_MOCK=true` usa simulador (recomendado para desarrollo)
- `ARCA_MOCK=false` usa WSFEv1 real
- `ARCA_WSFE_URL` endpoint SOAP (homo o produccion)
- `ARCA_TOKEN` y `ARCA_SIGN` credenciales WSAA vigentes
- `ARCA_CUIT` CUIT emisor
- `ARCA_PTO_VTA` punto de venta

Para produccion fiscal en VPS:
1. Obtener `token` y `sign` via WSAA (homologacion primero).
2. Cargar `ARCA_TOKEN` y `ARCA_SIGN` en `.env`.
3. Cambiar `ARCA_MOCK=false`.
4. Ejecutar `POST /api/billing/run-monthly` y validar CAE emitido.

## Endpoints de prueba rapida

### Crear dispositivo
```bash
curl -X POST http://localhost:4000/api/devices \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId":"demo-tenant",
    "deviceId":"ESP32-ESTE-003",
    "name":"Tanque Este",
    "lat":-34.59,
    "lng":-58.52,
    "address":"Lote Este"
  }'
```

### Comando bomba
```bash
curl -X POST http://localhost:4000/api/devices/ESP32-NORTE-001/command \
  -H "Content-Type: application/json" \
  -d '{"cmd":"pump_off"}'
```

## Escalabilidad

- Arquitectura modular por servicios.
- Multi-tenant con room realtime por tenant.
- Indices Mongo para lectura de telemetria.
- Cron jobs desacoplables a worker dedicado.
- Preparado para agregar Redis/BullMQ y auth empresarial.
