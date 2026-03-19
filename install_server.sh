#!/usr/bin/env bash

if [ -z "${BASH_VERSION:-}" ]; then
  echo "Error: este script requiere bash. Ejecuta: bash ./install_server.sh [opciones]" >&2
  exit 1
fi
set -euo pipefail

DOMAIN="agrosentinel.jaz.ar"
EMAIL=""
SKIP_CERTBOT="false"
OPEN_8080="true"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Uso:
  ./install_server.sh --email tu-correo@dominio.com [opciones]

Opciones:
  --email <correo>         Correo para Let's Encrypt (requerido salvo --skip-certbot)
  --domain <dominio>       Dominio a configurar (default: agrosentinel.jaz.ar)
  --skip-certbot           No emitir SSL con Let's Encrypt
  --open-8080              Mantiene 8080 abierto en UFW (admin empresa)
  -h, --help               Muestra esta ayuda

Ejemplo:
  ./install_server.sh --email admin@jaz.ar --domain agrosentinel.jaz.ar
EOF
}

log() {
  printf "\n[%s] %s\n" "$(date +"%Y-%m-%d %H:%M:%S")" "$*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Error: falta comando '$1'" >&2
    exit 1
  }
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --email)
        EMAIL="${2:-}"
        shift 2
        ;;
      --domain)
        DOMAIN="${2:-}"
        shift 2
        ;;
      --skip-certbot)
        SKIP_CERTBOT="true"
        shift
        ;;
      --open-8080)
        OPEN_8080="true"
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "Opcion no reconocida: $1" >&2
        usage
        exit 1
        ;;
    esac
  done

  if [[ "$SKIP_CERTBOT" != "true" && -z "$EMAIL" ]]; then
    echo "Error: --email es requerido si no usas --skip-certbot" >&2
    usage
    exit 1
  fi
}

assert_project_files() {
  [[ -f "$SCRIPT_DIR/docker-compose.yml" ]] || {
    echo "Error: no encuentro docker-compose.yml en $SCRIPT_DIR" >&2
    exit 1
  }
  [[ -f "$SCRIPT_DIR/.env.example" ]] || {
    echo "Error: no encuentro .env.example en $SCRIPT_DIR" >&2
    exit 1
  }
}

set_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"

  if grep -qE "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf "%s=%s\n" "$key" "$value" >> "$file"
  fi
}

install_base_packages() {
  log "Instalando paquetes base"
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg lsb-release ufw nginx certbot python3-certbot-nginx dnsutils
}

install_docker() {
  if [[ ! -f /etc/os-release ]]; then
    echo "Error: no se puede detectar sistema operativo" >&2
    exit 1
  fi

  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    echo "Error: este script instala Docker con repo de Ubuntu. SO detectado: ${ID:-desconocido}" >&2
    echo "Usa Ubuntu 22.04/24.04 o adapta el bloque de instalacion de Docker." >&2
    exit 1
  fi

  if command -v docker >/dev/null 2>&1; then
    log "Docker ya esta instalado"
  else
    log "Instalando Docker Engine + Compose plugin"
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi

  sudo systemctl enable docker
  sudo systemctl start docker
}

configure_firewall() {
  log "Configurando firewall UFW"
  sudo ufw allow OpenSSH
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw allow 1883/tcp
  sudo ufw allow 8080/tcp

  sudo ufw --force enable
}

prepare_env() {
  log "Preparando archivo .env"
  if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
  fi

  set_env_var "$SCRIPT_DIR/.env" "CORS_ORIGIN" "https://${DOMAIN}"
}

deploy_stack() {
  log "Levantando stack Docker"
  sudo docker compose -f "$SCRIPT_DIR/docker-compose.yml" --env-file "$SCRIPT_DIR/.env" up -d --build
}

configure_nginx() {
  local nginx_conf="/etc/nginx/sites-available/${DOMAIN}"

  log "Configurando Nginx para ${DOMAIN}"
  sudo tee "$nginx_conf" >/dev/null <<EOF
server {
  listen 80;
  server_name ${DOMAIN};

  location / {
    proxy_pass http://127.0.0.1:8081;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location /socket.io/ {
    proxy_pass http://127.0.0.1:8081/socket.io/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
EOF

  sudo ln -sfn "$nginx_conf" "/etc/nginx/sites-enabled/${DOMAIN}"
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t
  sudo systemctl enable nginx
  sudo systemctl reload nginx
}

run_certbot() {
  if [[ "$SKIP_CERTBOT" == "true" ]]; then
    log "Saltando Certbot (--skip-certbot)"
    return
  fi

  require_cmd dig
  local resolved_ip
  resolved_ip="$(dig +short "$DOMAIN" | tail -n 1 || true)"
  if [[ -z "$resolved_ip" ]]; then
    log "Aviso: el dominio ${DOMAIN} no resuelve todavia. Certbot puede fallar."
  else
    log "Dominio resuelve a: ${resolved_ip}"
  fi

  log "Solicitando certificado SSL con Certbot"
  sudo certbot --nginx --non-interactive --agree-tos --redirect -m "$EMAIL" -d "$DOMAIN"
  sudo systemctl status certbot.timer --no-pager || true
}

final_checks() {
  log "Estado de servicios"
  sudo docker compose -f "$SCRIPT_DIR/docker-compose.yml" ps

  log "Prueba API local"
  curl -fsS "http://127.0.0.1:4000/api/health" || true

  log "Prueba web por dominio"
  curl -I "https://${DOMAIN}" || true
}

main() {
  parse_args "$@"
  assert_project_files

  require_cmd sudo
  require_cmd grep
  require_cmd sed
  require_cmd apt-get

  log "Validando privilegios sudo"
  sudo -v

  install_base_packages
  install_docker
  configure_firewall
  prepare_env
  deploy_stack
  configure_nginx
  run_certbot
  final_checks

  log "Instalacion finalizada"
  echo "Landing y panel cliente: https://${DOMAIN}"
  echo "Admin empresa: https://${DOMAIN}:8080"
  echo "MQTT: ${DOMAIN}:1883"
  echo "Proyecto: ${SCRIPT_DIR}"
}

main "$@"
