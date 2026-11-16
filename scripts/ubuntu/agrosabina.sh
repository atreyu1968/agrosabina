#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${AGROSABINA_REPO:-https://github.com/atreyu1968/agrosabina.git}"
BRANCH="${AGROSABINA_BRANCH:-main}"
APP_ROOT="${AGROSABINA_ROOT:-/opt/agrosabina}"
APP_USER="${AGROSABINA_USER:-agrosabina}"
DATA_DIR="${AGROSABINA_DATA_DIR:-/var/lib/agrosabina}"
ETC_DIR="${AGROSABINA_ETC_DIR:-/etc/agrosabina}"
ENV_FILE="$ETC_DIR/agrosabina.env"
INSTALLER_CONFIG="${AGROSABINA_INSTALLER_CONFIG:-/etc/agrosabina/installer.conf}"
SERVICE="agrosabina"
PORT="${AGROSABINA_PORT:-8080}"
STATIC_DIR="$APP_ROOT/artifacts/agrosabina/dist/public"
HEALTH_URL="http://127.0.0.1:$PORT/api/healthz"

log() { printf '[Agrosabina] %s\n' "$*"; }
fail() { printf '[Agrosabina] ERROR: %s\n' "$*" >&2; exit 1; }

load_installer_config() {
  [[ -f "$INSTALLER_CONFIG" ]] || return 0
  local key value
  while IFS='=' read -r key value; do
    case "$key" in
      REPO_URL) [[ -n "${AGROSABINA_REPO:-}" ]] || REPO_URL="$value" ;;
      BRANCH) [[ -n "${AGROSABINA_BRANCH:-}" ]] || BRANCH="$value" ;;
      APP_ROOT) [[ -n "${AGROSABINA_ROOT:-}" ]] || APP_ROOT="$value" ;;
      APP_USER) [[ -n "${AGROSABINA_USER:-}" ]] || APP_USER="$value" ;;
      DATA_DIR) [[ -n "${AGROSABINA_DATA_DIR:-}" ]] || DATA_DIR="$value" ;;
      ETC_DIR) [[ -n "${AGROSABINA_ETC_DIR:-}" ]] || ETC_DIR="$value" ;;
      PORT) [[ -n "${AGROSABINA_PORT:-}" ]] || PORT="$value" ;;
    esac
  done < "$INSTALLER_CONFIG"
  ENV_FILE="$ETC_DIR/agrosabina.env"
  STATIC_DIR="$APP_ROOT/artifacts/agrosabina/dist/public"
  HEALTH_URL="http://127.0.0.1:$PORT/api/healthz"
}

usage() {
  cat <<'EOF'
Uso: sudo ./scripts/ubuntu/agrosabina.sh install|update|status

  install  Instala Agrosabina y conserva los datos fuera del código.
  update   Actualiza desde la rama main, con copia de seguridad y reversión.
  status   Muestra el estado del servicio y su comprobación de salud.

Opciones configurables mediante variables de entorno:
  AGROSABINA_REPO, AGROSABINA_BRANCH, AGROSABINA_ROOT,
  AGROSABINA_USER, AGROSABINA_DATA_DIR, AGROSABINA_ETC_DIR, AGROSABINA_PORT
EOF
}

require_root() {
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || fail "Ejecuta este comando con sudo."
  load_installer_config
  [[ -f /etc/os-release ]] || fail "No se detectó Ubuntu o una distribución compatible."
  . /etc/os-release
  [[ "${ID:-}" == "ubuntu" || "${ID_LIKE:-}" == *debian* ]] || fail "Este instalador requiere Ubuntu o una distribución basada en Debian."
  case "$DATA_DIR" in
    "$APP_ROOT"|"$APP_ROOT"/*) fail "La carpeta de datos debe quedar fuera del repositorio."; ;;
  esac
}

write_installer_config() {
  cat > "$INSTALLER_CONFIG" <<EOF
REPO_URL=$REPO_URL
BRANCH=$BRANCH
APP_ROOT=$APP_ROOT
APP_USER=$APP_USER
DATA_DIR=$DATA_DIR
ETC_DIR=$ETC_DIR
PORT=$PORT
EOF
  chmod 0600 "$INSTALLER_CONFIG"
  chown root:root "$INSTALLER_CONFIG"
}

run_as_app() {
  runuser -u "$APP_USER" -- env HOME="$DATA_DIR" PATH="/usr/local/bin:/usr/bin:/bin" "$@"
}

install_system_dependencies() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl git gnupg build-essential

  local node_major
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || printf '0')"
  if (( node_major < 24 )); then
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    chmod 0644 /etc/apt/keyrings/nodesource.gpg
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main\n' \
      "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/nodesource.list
    apt-get update
    apt-get install -y nodejs
  fi

  command -v systemctl >/dev/null || fail "No se encontró systemd."
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare pnpm@10.26.1 --activate
  else
    npm install --global pnpm@10.26.1
  fi
  node -e 'require("node:sqlite")' >/dev/null 2>&1 || fail "Node.js no incluye node:sqlite; se necesita Node.js 24."
}

ensure_service_user() {
  if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd --system --home-dir "$DATA_DIR" --create-home --shell /usr/sbin/nologin "$APP_USER"
  fi
  install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$DATA_DIR"
  install -d -o root -g root -m 0755 "$ETC_DIR"
  install -d -o root -g root -m 0755 "$(dirname "$INSTALLER_CONFIG")"
  install -d -o root -g root -m 0755 "$(dirname "$APP_ROOT")"
}

ensure_setup_code() {
  local token=""
  if [[ -f "$ENV_FILE" ]]; then
    token="$(sed -n 's/^APP_SETUP_TOKEN=\([A-Za-z0-9_-]\{32,\}\)$/\1/p' "$ENV_FILE" | head -n 1)"
  fi
  if [[ -z "$token" ]]; then
    token="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
    if [[ ! -f "$ENV_FILE" ]]; then
      cat > "$ENV_FILE" <<EOF
NODE_ENV=production
DATA_DIR=$DATA_DIR
PORT=$PORT
HOST=127.0.0.1
TRUST_PROXY=false
APP_PUBLIC_URL=
APP_SETUP_TOKEN=$token
EOF
    else
      sed -i '/^APP_SETUP_TOKEN=/d' "$ENV_FILE"
      printf 'APP_SETUP_TOKEN=%s\n' "$token" >> "$ENV_FILE"
    fi
  fi
  chmod 0600 "$ENV_FILE"
  chown root:root "$ENV_FILE"
  SETUP_CODE="$token"
}

ensure_repository() {
  if [[ ! -d "$APP_ROOT/.git" ]]; then
    [[ ! -e "$APP_ROOT" ]] || fail "$APP_ROOT ya existe y no parece un repositorio Git."
    git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$APP_ROOT"
  else
    local current_remote
    current_remote="$(run_as_app git -C "$APP_ROOT" remote get-url origin)"
    [[ "$current_remote" == "$REPO_URL" ]] || run_as_app git -C "$APP_ROOT" remote set-url origin "$REPO_URL"
  fi
  chown -R "$APP_USER:$APP_USER" "$APP_ROOT"
}

build_application() {
  run_as_app bash -c '
    set -e
    cd "$1"
    pnpm install --frozen-lockfile
    PORT="$2" BASE_PATH=/ pnpm --filter @workspace/agrosabina run build
    pnpm --filter @workspace/api-server run build
  ' _ "$APP_ROOT" "$PORT"
}

write_service_unit() {
  cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Agrosabina shared accounting application
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_ROOT
EnvironmentFile=$ENV_FILE
Environment=STATIC_DIR=$STATIC_DIR
ExecStart=/usr/bin/node --enable-source-maps $APP_ROOT/artifacts/api-server/dist/index.mjs
Restart=on-failure
RestartSec=3
TimeoutStartSec=60
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
  chmod 0644 "/etc/systemd/system/$SERVICE.service"
  systemctl daemon-reload
}

wait_for_health() {
  local attempt
  for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

install_app() {
  require_root
  install_system_dependencies
  ensure_service_user
  ensure_setup_code
  ensure_repository
  build_application
  chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
  write_installer_config
  write_service_unit
  systemctl enable --now "$SERVICE"
  if ! wait_for_health; then
    systemctl --no-pager --full status "$SERVICE" || true
    fail "Agrosabina no respondió. Consulta: journalctl -u $SERVICE -n 100"
  fi
  log "Instalación lista. Abre http://127.0.0.1:$PORT en Ubuntu."
  log "Introduce este código una sola vez en la pantalla de primer acceso:"
  printf '%s\n' "$SETUP_CODE"
  log "Después crea el administrador y configura Resend desde Ajustes."
}

restore_data_backup() {
  local backup="$1"
  systemctl stop "$SERVICE" || true
  find "$DATA_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  tar -xzf "$backup" -C "$DATA_DIR"
  chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
}

rollback_code() {
  local old_revision="$1"
  run_as_app git -C "$APP_ROOT" reset --hard "$old_revision" || true
  build_application || true
  systemctl start "$SERVICE" || true
}

update_app() {
  require_root
  [[ -d "$APP_ROOT/.git" ]] || fail "No existe una instalación en $APP_ROOT."
  local dirty
  dirty="$(run_as_app git -C "$APP_ROOT" status --porcelain)"
  [[ -z "$dirty" ]] || fail "Hay cambios locales en el repositorio; se cancela la actualización para no sobrescribirlos."
  run_as_app git -C "$APP_ROOT" fetch --prune origin "$BRANCH"
  local old_revision
  old_revision="$(run_as_app git -C "$APP_ROOT" rev-parse HEAD)"
  systemctl stop "$SERVICE"

  local backup_dir backup_file stamp
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_dir="/var/backups/agrosabina/$stamp"
  install -d -o root -g root -m 0700 "$backup_dir"
  backup_file="$backup_dir/data.tar.gz"
  if ! tar -czf "$backup_file" -C "$DATA_DIR" .; then
    systemctl start "$SERVICE" || true
    fail "No se pudo crear la copia de seguridad; no se actualizó el código."
  fi
  chmod 0600 "$backup_file"

  if ! run_as_app git -C "$APP_ROOT" merge --ff-only "origin/$BRANCH"; then
    rollback_code "$old_revision"
    fail "La actualización no es de avance rápido; el servicio anterior se ha restaurado."
  fi
  if ! build_application; then
    rollback_code "$old_revision"
    fail "Falló la compilación; se volvió al código anterior."
  fi
  chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
  systemctl start "$SERVICE"
  if wait_for_health; then
    log "Actualización lista. Copia de datos: $backup_file"
    return
  fi

  log "La nueva versión no pasó la comprobación; se restauran el código y los datos."
  restore_data_backup "$backup_file"
  run_as_app git -C "$APP_ROOT" reset --hard "$old_revision" || true
  build_application || true
  systemctl start "$SERVICE" || true
  fail "La actualización se revirtió. Revisa journalctl -u $SERVICE -n 100."
}

show_status() {
  systemctl --no-pager --full status "$SERVICE" || true
  if curl --fail --silent --show-error --max-time 3 "$HEALTH_URL"; then
    printf '\n'
  else
    printf '[Agrosabina] La comprobación de salud no respondió.\n' >&2
    return 1
  fi
}

case "${1:-}" in
  install) install_app ;;
  update) update_app ;;
  status) require_root; show_status ;;
  -h|--help|help) usage ;;
  *) usage; exit 2 ;;
esac
