#!/bin/bash
# Haushaltsbuch – Libre Workspace Addon Setup
# Wird als root ausgeführt.
# Verfügbare Variablen: $DOMAIN, $ADMIN_PASSWORD, $IP, $LDAP_DC, $LANGUAGE_CODE

set -euo pipefail

APP_NAME="haushaltsbuch"
APP_DIR="/root/${APP_NAME}"
APP_DOMAIN="${APP_NAME}.${DOMAIN}"

echo "[haushaltsbuch] Erstelle Verzeichnisse..."
mkdir -p "${APP_DIR}/data/db"
mkdir -p "${APP_DIR}/data/uploads"

echo "[haushaltsbuch] Generiere Zugangsdaten..."
DB_PASSWORD=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
JWT_SECRET=$(openssl rand -base64 64 | tr -dc 'a-zA-Z0-9' | head -c 64)
ENCRYPTION_KEY=$(openssl rand -hex 32)

echo "[haushaltsbuch] Erstelle .env..."
cat > "${APP_DIR}/.env" << ENV
DB_PASSWORD=${DB_PASSWORD}
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
APP_URL=https://${APP_DOMAIN}
ALLOWED_ORIGINS=https://${APP_DOMAIN}
WEB_PORT=8481
ENV

echo "[haushaltsbuch] Lade docker-compose.yml..."
curl -fsSL "https://raw.githubusercontent.com/boernie77/haushaltsbuch-home/main/docker-compose.yml" \
    -o "${APP_DIR}/docker-compose.yml"

echo "[haushaltsbuch] Starte Container..."
cd "${APP_DIR}" && docker-compose pull
cd "${APP_DIR}" && docker-compose up -d

echo "[haushaltsbuch] Warte auf Backend-Start..."
sleep 10

echo "[haushaltsbuch] Konfiguriere Caddy Reverse-Proxy..."
cat > "/etc/caddy/sites/${APP_NAME}.caddy" << CADDY
${APP_DOMAIN} {
    reverse_proxy localhost:8481
}
CADDY

systemctl reload caddy || caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || true

echo "[haushaltsbuch] Installation abgeschlossen."
echo "[haushaltsbuch] Erreichbar unter: https://${APP_DOMAIN}"
echo "[haushaltsbuch] Beim ersten Aufruf einen Account anlegen — dieser wird automatisch zum Admin."
