#!/bin/bash
# Haushaltsbuch – Libre Workspace Addon Rebuild
# Startet alle Container neu ohne Datenverlust (Datenbank und Uploads bleiben erhalten).

set -euo pipefail

APP_DIR="/root/haushaltsbuch"

if [ ! -d "${APP_DIR}" ]; then
    echo "[haushaltsbuch] App-Verzeichnis nicht gefunden."
    exit 1
fi

echo "[haushaltsbuch] Stoppe Container (Daten bleiben erhalten)..."
cd "${APP_DIR}" && docker-compose down --remove-orphans

echo "[haushaltsbuch] Lade aktuelle docker-compose.yml..."
curl -fsSL "https://raw.githubusercontent.com/boernie77/haushaltsbuch-home/main/docker-compose.yml" \
    -o "${APP_DIR}/docker-compose.yml"

echo "[haushaltsbuch] Ziehe aktuelle Images..."
cd "${APP_DIR}" && docker-compose pull

echo "[haushaltsbuch] Starte Container..."
cd "${APP_DIR}" && docker-compose up -d

echo "[haushaltsbuch] Rebuild abgeschlossen. Daten sind erhalten."
