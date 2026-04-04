#!/bin/bash
# Haushaltsbuch – Libre Workspace Addon Update
# Watchtower zieht neue Images täglich automatisch.
# Dieses Skript aktualisiert manuell auf das neueste Image.

set -euo pipefail

APP_DIR="/root/haushaltsbuch"

if [ ! -f "${APP_DIR}/docker-compose.yml" ]; then
    echo "[haushaltsbuch] Installation nicht gefunden, Update übersprungen."
    exit 0
fi

echo "[haushaltsbuch] Ziehe aktuelle Images..."
cd "${APP_DIR}"
if command -v docker-compose &>/dev/null; then
    docker-compose pull
    docker-compose up -d
else
    docker compose pull
    docker compose up -d
fi

echo "[haushaltsbuch] Update abgeschlossen."
