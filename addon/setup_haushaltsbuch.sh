#!/bin/bash
# Haushaltsbuch – Libre Workspace Addon Setup
# Wird automatisch als root ausgeführt.
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

echo "[haushaltsbuch] Erstelle docker-compose.yml..."
printf '%s' "$DB_PASSWORD"     > /tmp/hb_db_password
printf '%s' "$JWT_SECRET"      > /tmp/hb_jwt_secret
printf '%s' "$ENCRYPTION_KEY"  > /tmp/hb_encryption_key
printf '%s' "$APP_DOMAIN"      > /tmp/hb_app_domain

python3 - <<'PYEOF'
db_password   = open('/tmp/hb_db_password').read()
jwt_secret    = open('/tmp/hb_jwt_secret').read()
encryption_key = open('/tmp/hb_encryption_key').read()
app_domain    = open('/tmp/hb_app_domain').read()

compose = f"""services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: haushaltsbuch
      POSTGRES_USER: haushalt
      POSTGRES_PASSWORD: "{db_password}"
    volumes:
      - ./data/db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U haushalt -d haushaltsbuch"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    image: ghcr.io/boernie77/haushaltsbuch-home-backend:latest
    restart: unless-stopped
    pull_policy: always
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: "postgres://haushalt:{db_password}@db:5432/haushaltsbuch"
      JWT_SECRET: "{jwt_secret}"
      ENCRYPTION_KEY: "{encryption_key}"
      PORT: "3000"
      NODE_ENV: production
      APP_URL: "https://{app_domain}"
      ALLOWED_ORIGINS: "https://{app_domain}"
    volumes:
      - ./data/uploads:/app/uploads

  web:
    image: ghcr.io/boernie77/haushaltsbuch-home-web:latest
    restart: unless-stopped
    pull_policy: always
    depends_on:
      - backend
    ports:
      - "8481:80"

  watchtower:
    image: containrrr/watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      WATCHTOWER_CLEANUP: "true"
    command: --interval 86400
"""

with open('/root/haushaltsbuch/docker-compose.yml', 'w') as f:
    f.write(compose)
print("docker-compose.yml erstellt")
PYEOF

rm -f /tmp/hb_db_password /tmp/hb_jwt_secret /tmp/hb_encryption_key /tmp/hb_app_domain

echo "[haushaltsbuch] Starte Container..."
cd "${APP_DIR}"
if command -v docker-compose &>/dev/null; then
    docker-compose pull
    docker-compose up -d
else
    docker compose pull
    docker compose up -d
fi

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
