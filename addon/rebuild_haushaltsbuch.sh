#!/bin/bash
# Haushaltsbuch – Libre Workspace Addon Rebuild
# Startet alle Container neu ohne Datenverlust.

set -euo pipefail

APP_DIR="/root/haushaltsbuch"

if [ ! -f "${APP_DIR}/docker-compose.yml" ]; then
    echo "[haushaltsbuch] Installation nicht gefunden."
    exit 1
fi

echo "[haushaltsbuch] Stoppe Container (Daten bleiben erhalten)..."
cd "${APP_DIR}"
if command -v docker-compose &>/dev/null; then
    docker-compose down --remove-orphans
    docker-compose pull
    docker-compose up -d
else
    docker compose down --remove-orphans
    docker compose pull
    docker compose up -d
fi

echo "[haushaltsbuch] Rebuild abgeschlossen. Daten sind erhalten."
