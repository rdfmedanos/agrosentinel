#!/usr/bin/env bash
set -euo pipefail

DOMAIN="agrosentinel.jaz.ar"
BRANCH="main"
SKIP_GIT="false"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Uso:
  ./update_server.sh [opciones]

Opciones:
  --branch <rama>       Rama git a actualizar (default: main)
  --domain <dominio>    Dominio para healthcheck HTTPS (default: agrosentinel.jaz.ar)
  --skip-git            No hace git fetch/pull (solo rebuild/restart)
  -h, --help            Muestra esta ayuda

Ejemplos:
  ./update_server.sh
  ./update_server.sh --branch production
  ./update_server.sh --skip-git
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
      --branch)
        BRANCH="${2:-}"
        shift 2
        ;;
      --domain)
        DOMAIN="${2:-}"
        shift 2
        ;;
      --skip-git)
        SKIP_GIT="true"
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
}

assert_project_files() {
  [[ -f "$SCRIPT_DIR/docker-compose.yml" ]] || {
    echo "Error: no encuentro docker-compose.yml en $SCRIPT_DIR" >&2
    exit 1
  }
  [[ -f "$SCRIPT_DIR/.env" ]] || {
    echo "Error: no encuentro .env en $SCRIPT_DIR. Ejecuta primero install_server.sh" >&2
    exit 1
  }
}

git_update() {
  if [[ "$SKIP_GIT" == "true" ]]; then
    log "Saltando actualizacion git (--skip-git)"
    return
  fi

  if [[ ! -d "$SCRIPT_DIR/.git" ]]; then
    log "No es un repo git local. Salto git pull."
    return
  fi

  log "Actualizando codigo desde git (${BRANCH})"
  git -C "$SCRIPT_DIR" fetch --all --prune
  git -C "$SCRIPT_DIR" checkout "$BRANCH"
  git -C "$SCRIPT_DIR" pull --ff-only origin "$BRANCH"
}

redeploy() {
  log "Rebuild y redeploy de contenedores"
  sudo docker compose -f "$SCRIPT_DIR/docker-compose.yml" --env-file "$SCRIPT_DIR/.env" up -d --build
}

healthcheck() {
  log "Estado de servicios"
  sudo docker compose -f "$SCRIPT_DIR/docker-compose.yml" ps

  log "Health API local"
  curl -fsS "http://127.0.0.1:4000/api/health"

  log "Health web HTTPS"
  curl -fsSI "https://${DOMAIN}" >/dev/null
  echo "OK https://${DOMAIN}"
}

main() {
  parse_args "$@"
  assert_project_files

  require_cmd sudo
  require_cmd curl
  require_cmd docker

  log "Validando privilegios sudo"
  sudo -v

  git_update
  redeploy
  healthcheck

  log "Actualizacion finalizada"
}

main "$@"
