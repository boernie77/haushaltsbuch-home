# Haushaltsbuch – Claude Code Instructions

## Projektübersicht
Budget-App für Haushalte mit Web, Mobile (iOS/Android) und KI-OCR-Quittungsanalyse.
- **GitHub:** https://github.com/boernie77/haushaltsbuch (privat)
- **Produktion:** https://haushalt.bernauer24.com (Hetzner VPS 37.27.193.27)
- **Deployment:** Docker Compose, **automatischer Deploy bei jedem Push auf `main`** via GitHub Actions

## Stack
| Bereich | Technologie |
|---------|-------------|
| Backend | Node.js/Express, Sequelize ORM, PostgreSQL |
| Web | React + Vite + Tailwind CSS, React Router v6, Recharts |
| Mobile | React Native + Expo SDK 52, expo-router, react-native-paper, Zustand, react-native-mmkv |
| Auth | JWT (30 Tage), bcryptjs |
| KI/OCR | Anthropic Claude API (`claude-opus-4-6`) |
| Bildverarbeitung | Sharp (Quittungs-Scan-Filter) |
| SFTP-Backup | ssh2-sftp-client |
| Cron | node-cron |
| Reverse Proxy | Caddy (SSL, Port 8081) |

## Verzeichnisstruktur
```
/
├── backend/
│   ├── server.js                   Einstiegspunkt: migrate() → listen → startCron()
│   └── src/
│       ├── models/index.js         Alle Sequelize-Modelle
│       ├── migrations/             001-initial … 008-transaction-paperless-metadata,
│       │                           009-savings-goals, 010-transaction-splits,
│       │                           011-password-reset, 012-reports, 013-statistics
│       ├── routes/                 Express-Router (auth, households, transactions, admin, backup, ocr, paperless, …)
│       ├── services/
│       │   ├── backupService.js    Export/Import/SFTP-Upload/runGlobalBackup
│       │   └── cronService.js      Cron: Backup + Wiederkehrende Buchungen + Paperless-Auto-Sync
│       ├── middleware/auth.js      JWT + Role Guards
│       └── utils/
│           ├── migrate.js          Migrations-Runner (_migrations-Tabelle)
│           ├── receiptProcessor.js Sharp-Pipeline (B&W Dokumenten-Scan-Filter)
│           └── seedCategories.js   17 Systemkategorien
├── web/
│   └── src/
│       ├── pages/                  Alle Seiten
│       ├── services/api.ts         Axios-Wrapper
│       ├── store/authStore.ts      Zustand Store
│       └── components/Layout.tsx  Sidebar + Household-Switcher
├── mobile/
│   ├── app/                        expo-router Screens
│   ├── ios/                        Natives iOS-Projekt (nach expo prebuild generiert)
│   └── src/
│       ├── services/api.ts         Mobile Axios-Wrapper
│       ├── services/offlineStore.ts  MMKV-Cache + Offline-Queue
│       ├── store/authStore.ts      Zustand + SecureStore
│       └── themes/index.ts         Feminine/Masculine Themes
├── docker-compose.yml
├── CLAUDE.md
└── .github/workflows/deploy.yml   Auto-Deploy bei push auf main + workflow_dispatch
```

## Begriffe: Haushalt vs. Haushaltsbuch
| Begriff | Bedeutung | DB-Modell |
|---------|-----------|-----------|
| **Haushalt** | Eine Personengruppe (z.B. Familie). Daten verschiedener Haushalte müssen **STRIKT GETRENNT** bleiben. | Kein eigenes Modell — implizit durch HouseholdMember-Zugehörigkeiten |
| **Haushaltsbuch** | Ein Budget-Buch innerhalb eines Haushalts. Ein User kann mehrere haben (z.B. "Unser Haushalt" + "Christian Privat"). | `Household` |

⚠️ **KRITISCH:** NIEMALS Daten zwischen verschiedenen Haushalten (Personengruppen) verschieben oder teilen! Verschiebungen von Buchungen sind NUR zwischen den eigenen Haushaltsbüchern des angemeldeten Users erlaubt.

## Datenmodelle
- **User**: id, name, email, password, role (superadmin/admin/member), theme (feminine/masculine), aiKeyGranted
- **Household** (= Haushaltsbuch): id, name, currency, monthlyBudget, budgetWarningAt, anthropicApiKey, aiEnabled, adminUserId
- **HouseholdMember**: householdId, userId, role (admin/member/viewer)
- **Transaction**: amount, description, date, type (expense/income), categoryId, householdId, userId, receiptImage, merchant, tags, `isRecurring`, `recurringInterval` (weekly/monthly/yearly), `recurringDay`, `recurringNextDate`, `paperlessDocId` (INTEGER), `paperlessMetadata` (TEXT/JSON)
- **Category**: name, nameDE, icon, color, isSystem, householdId (null = global Systemkategorie)
- **Budget**: householdId, categoryId, limitAmount, month, year, warningAt
- **GlobalSettings**: id='global', anthropicApiKey, aiKeyPublic (single-row)
- **InviteCode**: code, **type** (new_household|add_member), householdId, role, useCount, maxUses, expiresAt
- **BackupConfig**: sftpHost, sftpPort, sftpUser, sftpPassword, sftpPath, schedule, scheduleLabel, isActive, lastRunAt, lastRunStatus
- **PaperlessConfig**: householdId, baseUrl, apiToken, isActive
- **PaperlessDocumentType / PaperlessCorrespondent / PaperlessTag**: householdId, paperlessId, name, `isFavorite`, syncedAt
- **PaperlessUser**: householdId, paperlessId (Integer), username, fullName, `isEnabled` (default true), syncedAt
- **TransactionSplit**: transactionId, categoryId, amount, description
- **SavingsGoal**: householdId, name, icon, targetAmount, currentAmount, deadline
- **password_reset_tokens**: userId, token, expiresAt, createdAt

## Einladungs- und Registrierungslogik
| Typ | Erstellt von | Effekt |
|-----|-------------|--------|
| `new_household` | Superadmin | Registrant bekommt eigenen Haushalt, wird Admin |
| `add_member` | Haushalt-Admin | Registrant tritt dem Haushalt bei |

- Erster User → automatisch superadmin + Haushalt, kein Code nötig
- Alle weiteren User → Einladungscode zwingend
- Admin sieht nur Statistiken, verwaltet keine fremden Haushalte

## Migrations-System
Eigener leichtgewichtiger Runner (`src/utils/migrate.js`):
- Verwaltet eine `_migrations`-Tabelle in der DB
- Liest JS-Files aus `src/migrations/` (alphabetisch sortiert)
- Alle Migrations-SQL verwenden `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`
- Wird automatisch bei Server-Start ausgeführt (vor `app.listen`)

### ⚠️ KRITISCH: Migrations-Signatur
Der Runner übergibt `sequelize` (die Instanz) direkt — **NICHT** `queryInterface`!
```js
// RICHTIG:
module.exports = {
  up: async (sequelize) => {
    await sequelize.query(`ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`);
  }
};

// FALSCH (crasht den Server → Container-Restart-Loop!):
module.exports = {
  async up(queryInterface, Sequelize) { ... }
};
```

## Cron-Jobs (`cronService.js`)
| Zeit | Job |
|------|-----|
| täglich 06:00 | `processRecurringTransactions` — erstellt fällige Kopien wiederkehrender Buchungen |
| alle 6h | `syncAllPaperless` — synchronisiert alle aktiven Paperless-Haushalte |
| 1. jeden Monats 08:00 | `sendMonthlyReports` — HTML-Monatsberichte per E-Mail |
| konfigurierbar | SFTP-Backup (täglich 02:00 / wöchentlich / monatlich) |

## Quittungs-Bildverarbeitung (`receiptProcessor.js`)
Sharp-Pipeline: `rotate` → `greyscale` → `normalize` → `clahe({width:8,height:8,maxSlope:2})` → `sharpen({sigma:0.8})` → `gamma(1.3)` → `threshold(165)` → `jpeg({quality:95})`
- Aufgerufen in `transactions.js` nach Multer-Upload (in-place)
- Aufgerufen in `ocr.js` vor dem Claude-API-Call (als Buffer)
- Ergebnis: Schwarz-Weiß Dokumenten-Scan-Optik für klare Quittungen

## Wiederkehrende Buchungen
- `isRecurring: true` → **Template-Buchung** (nur Template, erscheint NICHT in normaler Transaktionsliste)
- `recurringNextDate` = Buchungsdatum beim Erstellen (Cron erstellt ab dann Kopien)
- `recurringInterval`: `weekly` | `monthly` | `yearly`
- `GET /api/transactions` filtert `isRecurring: true` automatisch aus
- `GET /api/transactions/recurring` + `DELETE /api/transactions/recurring/:id`
- `PUT /api/transactions/:id` akzeptiert `isRecurring` + `recurringInterval`
- Web: TransactionsPage — eigener Filter-Tab "Wiederkehrend" mit Bearbeiten/Beenden/Verschieben
- Mobile: add.tsx — Switch + Intervall-Chips

## Buchungen verschieben
- `PUT /api/transactions/:id/move` — verschiebt Buchung in anderes Haushaltsbuch
- Prüft Zugriff auf Quell- UND Ziel-Haushaltsbuch (User muss Mitglied in beiden sein)
- Benutzerdefinierte Kategorien werden entfernt wenn im Ziel nicht verfügbar
- Web: ArrowRightLeft-Icon bei jeder Buchung, Modal mit Dropdown der eigenen Haushaltsbücher

## Buchungen bearbeiten
- `PUT /api/transactions/:id` — aktualisiert alle Felder inkl. isRecurring/recurringInterval
- Web: Pencil-Icon bei jeder Buchung, befüllt das Erstellen-Formular mit `editingId`

## Duplikat-Check
- `POST /api/transactions/duplicate-check` — prüft auf ähnliche Buchungen (Betrag, Datum, Beschreibung)
- Web: automatischer Check bei Blur auf Betrag/Datum/Beschreibung, Warnung wenn Duplikate gefunden

## Passwort-Reset
- `POST /api/auth/forgot-password` — sendet Reset-E-Mail mit Token (1h gültig)
- `POST /api/auth/reset-password` — setzt Passwort mit Token
- Web: ForgotPasswordPage + ResetPasswordPage
- Mobile: Link auf Login-Seite öffnet Web-URL

## Backup-System
**Haushalt-Backup:**
- `GET /api/backup/export?householdId=&format=json|csv`
- `POST /api/backup/import` — Duplikaterkennung aktiv

**Admin-Backup (SFTP):**
- `GET/PUT /api/admin/backup/config`, `POST /api/admin/backup/test`, `POST /api/admin/backup/run`
- Format: alle Tabellen als JSON, gzip-komprimiert

## KI-OCR API-Key-Auflösung (3 Stufen)
1. Haushalt eigener Key (`household.aiEnabled && household.anthropicApiKey`)
2. Globaler Admin-Key (`globalSettings.aiKeyPublic` ODER `user.aiKeyGranted`)
3. Server ENV `ANTHROPIC_API_KEY`

API-Key-Validierung: Beim Speichern gegen `claude-haiku-4-5-20251001` getestet.
**Wichtig:** Mobile muss `householdId` beim OCR-Request mitsenden — sonst schlägt Key-Auflösung fehl.

## KI-OCR Prompt-Details
- Modell: `claude-opus-4-6`
- Prompt enthält **aktuelles Datum** (`Heute ist der DD.MM.YYYY`) damit das Modell das Jahr bei Kassenbons korrekt einordnet (z.B. "05.03.26" → 2026, nicht 2025)
- `description`: max. 1–3 Wörter Oberbegriff (z.B. "Lebensmitteleinkauf", "Restaurantbesuch") — keine Artikellisten
- `amount`: wird mit `parseFloat(...).toFixed(2)` ins Eingabefeld geschrieben (immer 2 Dezimalstellen)
- Auto-Upload zu Paperless in `add.tsx`: geschieht nach Transaction-Create wenn Paperless-Felder ausgewählt sind

## Paperless-Integration
- **Sync:** Vollständige Paginierung via `fetchAllPages()`, kein Item-Limit
  - ⚠️ Paperless gibt in `data.next` oft interne URLs zurück (anderer Host/Protokoll) → Host wird auf konfigurierten baseUrl normalisiert
  - Bulk-Upsert via raw SQL `INSERT ... ON CONFLICT (householdId, paperlessId) DO UPDATE SET ...` mit `randomUUID()` für neue IDs
- **Auto-Sync:** Cron alle 6h für alle Haushalte mit aktiver Paperless-Config
- **Favoriten:** `isFavorite`-Flag auf DocumentType, Correspondent, Tag — nur Favoriten im Upload-Dialog
- **Benutzer:** `PaperlessUser`-Tabelle (Migration 006), `isEnabled` toggle
  - ⚠️ `/api/users/` in Paperless erfordert Admin-Token — Fehler werden ignoriert (Sync bricht nicht ab)
  - Deaktivierte Benutzer stehen beim Upload nicht zur Auswahl
- **Duplikatcheck:** `GET /api/paperless/check?householdId=&type=&name=` (case-insensitive, DB-Suche)
- **Erstellen aus UI:** Dokumententypen, Absender, Tags mit Live-Duplikatcheck (350ms Debounce, ✓/⚠)
  - ⚠️ Paperless `?name=` Filter nutzt `icontains` (Teilstring) — beim Erstellen immer exakten Namensvergleich auf `results` machen (`r.name.toLowerCase() === name.trim().toLowerCase()`)
  - Erstellen möglich in Browser (PaperlessPage) und Mobile (paperless-settings.tsx)
- **Upload-Berechtigungen:** `ownerPaperlessUserId` + `viewPaperlessUserIds` → werden als Paperless-Integer-IDs (`paperlessId`) gesendet, nicht als DB-UUIDs
- **`PUT /api/paperless/favorite`:** unterstützt `type`: `doctype` | `correspondent` | `tag` | `user`
  - Für User: `{ type: 'user', id, isEnabled }` statt `isFavorite`
- **Metadata-Vorauswahl:** Nach Upload wird `paperlessMetadata` (JSON) auf der Transaction gespeichert mit `{ documentTypeId, correspondentId, tagIds, ownerPaperlessUserId, viewPaperlessUserIds }` — beim erneuten Öffnen des Upload-Modals wird Vorauswahl wiederhergestellt
- **Upload-Button Sichtbarkeit:** Nur anzeigen wenn Haushalt eine aktive Paperless-Config hat (`hasPaperless`-State aus `paperlessAPI.getConfig`)
- **`paperlessDocId`:** INTEGER in DB (Paperless-interne Dok-ID), NICHT die Task-UUID — wird asynchron im Hintergrund nach erfolgreichem Indexieren gesetzt
- **Unique Constraints** (Migration 007): `(householdId, paperlessId)` auf document_types, correspondents, tags — `Model.upsert()` schlägt fehl → `findOrCreateLocal()`-Hilfsfunktion verwenden

## Offline-Modus (Mobile)
- `mobile/src/services/offlineStore.ts`: MMKV-Cache + Offline-Queue
- `react-native-mmkv` bereits in package.json, autolinking (kein Expo-Plugin nötig)
- Cache-Keys: `overview_{householdId}`, `budgets_{householdId}`, `transactions_{householdId}`
- Queue-Key: `offline_tx_queue` — Buchungen ohne Foto werden offline gespeichert
- Auto-Sync: beim App-Start + bei Wechsel in den Vordergrund (`AppState` in `_layout.tsx`)
- `isNetworkError(err)`: `!err.response` → echter Netzwerkfehler (kein `err.response` bei Timeout/Offline)
- Offline-Banner auf Übersicht und Buchungsliste
- Offline-Buchungen erscheinen in der Liste mit Uhr-Icon + "(ausstehend)"

## Haushalt löschen
- `DELETE /api/households/:id` — nur Admin, mindestens 1 anderer Haushalt muss verbleiben
- Kaskadiert: Transactions, Budgets, Categories (non-system), InviteCodes, alle Paperless-Daten, HouseholdMembers
- UI: Löschen-Button nur sichtbar wenn `households.length > 1`

## E-Mail-Konfiguration
- **SMTP:** smtp.strato.de, Port 465 (SSL)
- **User:** christian@bernauer24.com
- **Absender:** noreply@bernauer24.com (Strato-Alias)
- **Verwendet für:** Passwort-Reset-E-Mails, Monatsberichte
- ENV-Variablen: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

## Statistiken & Dashboard
- **Dashboard:** 4 Karten (Ausgaben, Einnahmen, Bilanz, Sparquote) + Monats-Prognose + Budgetanzeige + Kategorie-Pie-Chart
- **Statistiken:** 5 Tabs — Monat, Jahr, Trends (Durchschnittsausgaben nach Kategorie), Vermögen (kumulierte Bilanz), Personen (Ausgaben pro Person + Ausgleichsrechnung)
- API: `statsAPI.trends()`, `statsAPI.wealth()`, `statsAPI.byPerson()`

## Sparziele
- `SavingsGoal`: householdId, name, icon, targetAmount, currentAmount, deadline
- CRUD: `GET/POST/PUT/DELETE /api/savings-goals`
- Web: BudgetPage — zweiter Tab "Sparziele" mit Fortschrittsbalken, Einzahlung, Icon-Picker
- Mobile: budget.tsx — Sparziele-Sektion

## Monatsberichte
- `GET /api/reports/monthly?householdId=&year=&month=` — HTML-Report zum Download
- `POST /api/reports/monthly/send` — sendet Report per E-Mail an alle Mitglieder
- Cron: 1. jeden Monats 08:00 — automatischer Versand an alle Haushalte mit `emailReportsEnabled`

## Deployment
```bash
# Automatisch bei push auf main (GitHub Actions)
# Manuell: Actions → Deploy to Hetzner VPS → Run workflow

# Deploy-Script:
#   1. git pull
#   2. docker-compose build --no-cache
#   3. docker-compose up -d
#   4. node src/utils/migrate.js
#   5. seedSystemCategories()

# Direkt auf VPS:
ssh -i ~/.ssh/emailrelay_vps root@37.27.193.27
cd /opt/haushaltsbuch && git pull && docker-compose up -d --build
```

## iOS Mobile App
- **Expo SDK 52**, expo-router
- **Bundle ID:** `de.bernauer24.haushaltsbuch`
- **Apple Development Team:** Y83997R5WL (Persönliches Team)
- **Signing:** Automatic (Xcode verwaltet Provisioning Profile)
- **Testgerät:** Physisches iPhone, App läuft als **Release-Build** (kein Metro!)
- **Push Notifications:** NICHT aktiviert — `aps-environment` muss aus `.entitlements` entfernt bleiben, `expo-notifications` Plugin darf nicht in `app.json` stehen

### iOS neu bauen (nach JS-Änderungen):
1. **⇧⌘K** — Clean Build Folder
2. **⌘R** — Build & Run

### iOS Rebuild nach nativen Änderungen (app.json, neue native Module):
```bash
cd mobile && expo prebuild --clean
# Danach in Xcode: Team + Bundle ID prüfen, dann bauen
```

## VPS-Wartung
- **Docker-Disk-Cleanup:** `docker system prune -af --volumes=false` — entfernt ungenutzte Images/Container. Docker overlay2 kann sich auf 50+ GB ansammeln wenn viele Deploys stattfanden.
- Disk prüfen: `df -h /`
- Bei vollem Disk: PostgreSQL schreibt keine Checkpoints mehr → DB-Container unhealthy → Backend-Fehler 500

## Wichtige Konventionen
- VPS verwendet `docker-compose` (mit Bindestrich, nicht Plugin `docker compose`)
- SSH-Key für VPS: `~/.ssh/emailrelay_vps`
- Web-Build: `npm install` (kein `npm ci`, kein Lockfile committed)
- Backend ENV auf VPS: `/opt/haushaltsbuch/.env`
- DB-User: `haushalt`, DB-Name: `haushaltsbuch`
- 17 Systemkategorien automatisch geseedet
- Themes: `feminine` = rosa/hell, `masculine` = dunkelblau
- API-Routes unter `/api/...` (Caddy → Port 8081 → nginx → Backend Port 3001)
- **Niemals** `sequelize.sync()` in Produktion — nur Migrations-Runner verwenden
- **Migrations-Parameter:** `sequelize` (Instanz), nicht `queryInterface`!
- Paperless: `paperlessId` (Integer) für Paperless-API, `id` (UUID) für interne DB — beim Upload immer `paperlessId` senden
- React Native: Komponenten **nicht** innerhalb anderer Komponenten definieren (`const Foo = () =>`) — führt zu Remount bei jedem Render (Eingabefeld verliert Fokus). Stattdessen Render-Funktion (`const renderFoo = (...)`) verwenden.
- React Native Modal vs Paper Portal: Paper `Portal`/`Modal` bricht `ScrollView` + `maximumZoomScale` auf iOS → für Vollbild-Zoom nativen `Modal as RNModal` aus `react-native` verwenden
- **Tailwind `.input` Klasse:** Hat `@apply px-3` → überschreibt Utility-Klasse `pl-9`. Fix: `style={{ paddingLeft: '2.25rem' }}` inline
- **Sequelize Association-Naming:** `h.HouseholdMembers` (Default), nicht `h.members`
- **Datenmodelle:** `Household` in der DB = "Haushaltsbuch" in der UI (siehe Begriffe-Sektion oben)
