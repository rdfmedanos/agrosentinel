# Manual de despliegue en servidor (VPS)

Este manual te deja AgroSentinel operativo en un servidor Linux usando Docker Compose.

Dominio objetivo de este despliegue: `agrosentinel.jaz.ar`.

## 1) Requisitos recomendados

- Ubuntu 22.04 LTS (o Debian 12)
- 2 vCPU, 4 GB RAM, 40 GB disco
- Acceso SSH con usuario sudo
- Dominio apuntando al VPS (opcional, recomendado)

## 2) Preparar el servidor

Actualiza paquetes:

```bash
sudo apt update && sudo apt upgrade -y
```

Instala Docker + Compose Plugin:

```bash
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Habilita Docker al arranque:

```bash
sudo systemctl enable docker
sudo systemctl start docker
```

Configura firewall (UFW):

```bash
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8080/tcp
sudo ufw allow 1883/tcp
sudo ufw enable
```

Notas:
- `8080` publica la web y API (la web hace proxy a `/api` y `/socket.io`).
- `1883` publica MQTT para los ESP32.
- Si vas a usar dominio + SSL, al final restringe `8080` solo local o por firewall.

## 3) Subir el proyecto al VPS

Si usas git:

```bash
git clone <URL_DEL_REPO> agrosentinel
cd agrosentinel
```

Si ya lo tienes local, copia la carpeta `agrosentinel/` al servidor (scp/rsync) y entra al directorio.

## 4) Configurar variables de entorno

Crear `.env` desde plantilla:

```bash
cp .env.example .env
```

Editar `.env` con valores reales:

```env
PORT=4000
MONGO_URI=mongodb://mongo:27017/agrosentinel
MQTT_URL=mqtt://mosquitto:1883
MQTT_USERNAME=
MQTT_PASSWORD=
DEVICE_OFFLINE_SECONDS=5
CRITICAL_LEVEL_PCT=20
CORS_ORIGIN=https://agrosentinel.jaz.ar

ARCA_ENABLED=false
ARCA_MOCK=true
ARCA_CUIT=30712345678
ARCA_PTO_VTA=1
ARCA_WSFE_URL=https://wswhomo.afip.gov.ar/wsfev1/service.asmx
ARCA_TOKEN=
ARCA_SIGN=

# Notificaciones Telegram (opcional)

TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

Para produccion con dominio y HTTPS, usa tu dominio real en `CORS_ORIGIN` (en este caso `https://agrosentinel.jaz.ar`).

## 5) Levantar servicios

Desde la raiz del proyecto:

```bash
docker compose up -d --build
```

Verifica estado:

```bash
docker compose ps
```

Servicios esperados:
- `mongo`
- `mosquitto`
- `api`
- `web`

## 6) Pruebas de funcionamiento

Salud de API:

```bash
curl http://127.0.0.1:4000/api/health
```

Web:

```bash
curl -I http://127.0.0.1:8080
```

Desde afuera del VPS:
- `http://IP_VPS:8080`
- `mqtt://IP_VPS:1883`

## 7) Operacion diaria

Logs en vivo:

```bash
docker compose logs -f
```

Reiniciar stack:

```bash
docker compose restart
```

Actualizar a nueva version:

```bash
git pull
docker compose up -d --build
```

## 8) SSL con `agrosentinel.jaz.ar` (paso a paso)

### 8.1 DNS

En tu proveedor DNS crea/valida:
- Registro `A` para `agrosentinel.jaz.ar` apuntando a la IP publica del VPS.

Verifica resolucion:

```bash
dig +short agrosentinel.jaz.ar
```

### 8.2 Instalar Nginx + Certbot en el host

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 8.3 Configurar Nginx como proxy a Docker

Crea este archivo:

`/etc/nginx/sites-available/agrosentinel.jaz.ar`

```nginx
server {
  listen 80;
  server_name agrosentinel.jaz.ar;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /socket.io/ {
    proxy_pass http://127.0.0.1:8080/socket.io/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Activar sitio y validar:

```bash
sudo ln -s /etc/nginx/sites-available/agrosentinel.jaz.ar /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 8.4 Emitir certificado Let's Encrypt

```bash
sudo certbot --nginx -d agrosentinel.jaz.ar
```

Verifica renovacion automatica:

```bash
sudo systemctl status certbot.timer
```

### 8.5 Cerrar acceso publico a 8080

Cuando HTTPS ya este funcionando:

```bash
sudo ufw delete allow 8080/tcp
```

Con esto queda expuesto al publico solo `80/443`, y Nginx del host redirige a Docker local.

## 9) MQTT en produccion (seguridad)

Actualmente Mosquitto esta en modo anonimo (`allow_anonymous true`).

Para endurecer seguridad en produccion:
- Crear usuarios/clave de MQTT.
- Poner `allow_anonymous false`.
- Completar `MQTT_USERNAME` y `MQTT_PASSWORD` en `.env`.
- Ideal: agregar TLS para MQTT (puerto 8883) o tunel VPN.

## 10) Backup y recuperacion

Backup de Mongo (volumen Docker):

```bash
docker run --rm -v agrosentinel_mongo_data:/data/db -v $(pwd):/backup alpine tar czf /backup/mongo_data_$(date +%F).tar.gz -C /data/db .
```

Backup de configuracion:
- Guardar `.env`
- Guardar `infra/mosquitto/mosquitto.conf`

## 11) Notificaciones por Telegram

### 11.1 Obtener el Token del Bot

1. Abre Telegram y busca `@BotFather`
2. Enviale el comando `/newbot`
3. Sigue las instrucciones y给它 un nombre (ej: `AgroSentinel Bot`)
4. Cuando te pida el username, ingresa uno que termine en `bot` (ej: `agrosentinel_alerts_bot`)
5. Copia el **Token** que te da (algo como `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 11.2 Obtener el Chat ID

1. Agrega el bot a tu Telegram
2. Enviale un mensaje al bot (cualquier texto)
3. Visita: `https://api.telegram.org/bot<TU_TOKEN>/getUpdates`
4. Busca el campo `"chat":{"id":123456789,...}` - ese número es tu **Chat ID**

### 11.3 Configurar en .env

```env
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=123456789
```

### 11.4 Notificaciones que se envían

- 🔴 **Dispositivo Offline** - Cuando un dispositivo deja de enviar datos
- 🟢 **Dispositivo Online** - Cuando un dispositivo offline se reconecta
- ⚠️ **Nivel Crítico** - Cuando el nivel del tanque baja del umbral configurado
- 🟡 **Advertencia** - Alertas generales

### 11.5 Reiniciar servicios

```bash
docker compose down
docker compose up -d --build
```

---

## 12) Checklist final

- [ ] `docker compose ps` en estado `Up`
- [ ] `GET /api/health` responde OK
- [ ] Frontend abre desde navegador
- [ ] ESP32 publica en MQTT y aparece telemetria
- [ ] Alertas y ordenes de trabajo se crean correctamente
- [ ] Backup probado al menos una vez
- [ ] Telegram configurado y funcionando (opcional)

---

Con esto ya queda operativo para uso real en VPS.
