# Haushaltsbuch Home – Claude Code Instructions

## Projektübersicht
Öffentliche Family-Mode-Version von Haushaltsbuch für Selbst-Hosting (Heimserver, Libre Workspace, Portainer).
- **GitHub:** https://github.com/boernie77/haushaltsbuch-home (öffentlich)
- **Haupt-Repo:** https://github.com/boernie77/haushaltsbuch (privat, kommerzielle Version)
- **Docker Images:** `ghcr.io/boernie77/haushaltsbuch-home-backend:latest` + `ghcr.io/boernie77/haushaltsbuch-home-web:latest`
- **Build:** GitHub Actions bei jedem Push auf `main` → ghcr.io
- **Updates:** Watchtower zieht neue Images täglich automatisch

## Unterschiede zum Haupt-Repo
- `FAMILY_MODE=true` ist im `backend/Dockerfile` fest eingebaut (`ENV FAMILY_MODE=true`) — kann nicht überschrieben werden
- Kein Impressum / Datenschutz — stattdessen Link zu `byboernie.de` (Login, Register, Sidebar-Footer, Mobile Settings)
- Kein Admin-Bereich, kein Abonnement-System
- Addon-Verzeichnis: `addon/` mit Libre Workspace Add-On Generator Daten

## Deployment-Optionen
1. **docker-compose.yml** direkt (Portainer Stacks, eigener Server)
2. **Libre Workspace Add-On Generator** — Formular unter LW-Admin → Add-Ons

## Libre Workspace Add-On Generator
LW hat ein Web-Formular das die ZIP automatisch generiert. **KEIN manuelles Shell-Skript nötig.**

Felder:
| Feld | Wert |
|------|------|
| Addon-ID | `haushaltsbuch` |
| Addon-Name | `Haushaltsbuch` |
| Beschreibung | `Budget-App für Familien mit Statistiken und KI-Belegen` |
| Projekt-Homepage | `https://byboernie.de` |
| Autor | `boernie77` |
| E-Mail | `christian@bernauer24.com` |
| Addon-URL | `haushaltsbuch` |
| Interner HTTP-Port | `8481` |
| Logo | `haushaltsbuch.jpg` (256×256px) |

### ⚠️ KRITISCH: Zeilenlänge in docker-compose.yml
Der LW Add-On Generator bricht Zeilen über ~80 Zeichen um → YAML wird ungültig.

**Regeln:**
- Secrets maximal **16 Zeichen** für DB-Passwort
- **32 Zeichen** für JWT_SECRET
- `ENCRYPTION_KEY` im **Base64-Format (43 Zeichen)** statt Hex (64 Zeichen)
- Keine Anführungszeichen um lange Werte
- `$DOMAIN` wird von LW automatisch ersetzt → für APP_URL verwenden

### ENCRYPTION_KEY: Base64 statt Hex
`backend/src/utils/encrypt.js` akzeptiert:
- 64 Hex-Zeichen (Standard)
- 43–44 Base64-Zeichen (für LW-Formular)

Generieren: `openssl rand -base64 32 | tr -d '+/=' | head -c 43`

### docker-compose.yml für LW-Formular (Template)
```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: haushaltsbuch
      POSTGRES_USER: haushalt
      POSTGRES_PASSWORD: <16-Zeichen-Passwort>
    volumes:
      - /root/haushaltsbuch/data/db:/var/lib/postgresql/data
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
      DATABASE_URL: postgres://haushalt:<PASS>@db:5432/haushaltsbuch
      JWT_SECRET: <32-Zeichen>
      ENCRYPTION_KEY: <43-Zeichen-Base64>
      PORT: "3000"
      NODE_ENV: production
      APP_URL: https://haushaltsbuch.$DOMAIN
      ALLOWED_ORIGINS: https://haushaltsbuch.$DOMAIN
    volumes:
      - /root/haushaltsbuch/data/uploads:/app/uploads

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
```

## Wichtige Konventionen
- **Migrations-Parameter:** `sequelize` (Instanz), nicht `queryInterface`!
- **FAMILY_MODE** ist im Dockerfile eingebaut — niemals als ENV in docker-compose setzen
- **Watchtower** aktualisiert laufende Container — startet sie NICHT neu nach Absturz
- Bei SSH auf Heimserver: `systemv@192.168.2.204` (kein Key, Passwort-Auth)
- Docker Compose auf LW-Server: `docker compose` (Plugin, nicht `docker-compose`)
