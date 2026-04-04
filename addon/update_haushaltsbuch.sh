#!/bin/bash
# Haushaltsbuch – Libre Workspace Addon Update
# Watchtower zieht neue Images täglich automatisch.
# Dieses Skript aktualisiert manuell die docker-compose.yml und startet ggf. neu.

set -euo pipefail

APP_DIR="/root/haushaltsbuch"

if [ ! -d "${APP_DIR}" ]; then
    echo "[haushaltsbuch] App-Verzeichnis nicht gefunden, Update übersprungen."
    exit 0
fi

echo "[haushaltsbuch] Lade aktuelle docker-compose.yml..."
curl -fsSL "https://raw.githubusercontent.com/boernie77/haushaltsbuch-home/main/docker-compose.yml" \
    -o "${APP_DIR}/docker-compose.yml"

echo "[haushaltsbuch] Ziehe aktuelle Images..."
cd "${APP_DIR}" && docker-compose pull

echo "[haushaltsbuch] Starte Container neu..."
cd "${APP_DIR}" && docker-compose up -d

echo "[haushaltsbuch] Update abgeschlossen."
