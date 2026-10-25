# Project air – Bauplan

Stand 2026-10-25 · Arbeitstitel **Project air** · eigenständige Whiteboard-Plattform mit eigener
Engine, eigenem Backend und eigener Echtzeit · neues Projekt, ohne Altlasten

> Dieses Dokument ist die **einzige Startvorlage**. Wer das Projekt beginnt (Mensch oder
> Agent), arbeitet es von oben nach unten ab. Jede Phase hat eine Abnahme; ohne Abnahme keine
> nächste Phase. Alles mit **[Entscheidung]** legt der Owner vorher fest.

---

## Bereits vorhandene Startdateien

Diese Dateien liegen schon im Projektordner, **1:1 übernommen** (unverändert), und sind die
Grundlage für Phase 0. Agenten bauen darauf auf, statt sie neu zu erfinden; Änderungen nur per
Aufgabe mit Review.

| Datei | Inhalt | Grundlage für |
| --- | --- | --- |
| `docs/design-rules.md` | Design-Gesetz | P0-10, Abschnitt 21.1 |
| `docs/canvas-polish.md` | Leinwand-Arbeitsaufträge mit Soll-Werten und Abnahme | P0-11, Abschnitt 21.2 |
| `docs/engine-plan.md` | Plan der eigenen Engine (C++/WebAssembly/WebGPU) | P2-06, `docs/engine.md` |
| `src/app/globals.css` | Design-Tokens als CSS-Variablen | P0-12 (`tokens.json`) |
| `src/ui/canvas/toolbar-icons.tsx` | Icons der Werkzeugleiste | P0-12 (Icons im `ui-kit`) |
| `src/ui/canvas/canvas-toolbar.module.css` | Stil der Werkzeugleiste | P6-02 (L00) |
| `src/ui/strings.de.ts` | alle deutschen Oberflächentexte | P0-18 (`messages/de.json`, `en.json`) |
| `docs/owner/polier-1.0-workplan.md` | Arbeitsplan für das Planungswerkzeug | P0-00 |

---

## Inhalt

1. Zielbild
2. Grundentscheidungen
3. Monorepo-Struktur
4. Die Pakete im Detail
5. Der Vertrag (`contracts`) – Herzstück
6. Abhängigkeitsregeln
7. Arbeitsregeln für Agenten
8. Ablauf einer einzelnen Aufgabe
9. Branches, Versionen, Releases (Kurzfassung)
10. Lokale Entwicklungsumgebung und Ports
11. Teststrategie
12. CI-Pipeline
13. Umgebungen, Deployment, Datenbank
14. Sicherheit und Datenschutz
15. **Der Gesamtablauf – Phase für Phase**
16. **Fehler, die nicht passieren dürfen**
17. **Frühwarnzeichen und Wochen-Check**
18. Offene Entscheidungen
19. Zeitrahmen
20. Checkliste Tag 1
21. **Design-Gesetz und Leinwand-Abnahmekatalog**
22. **Releases, Updates und Changelog – Bedienungsanleitung**
23. **Sprache und Übersetzung – Code Englisch, Webseite Deutsch, übersetzbar**

---

## 1. Zielbild

**Was das Produkt ist:** eine Online-Leinwand, auf der Personen allein oder gemeinsam in
Echtzeit Notizen, Zonen, Checklisten, Tabellen, Bilder und Dateien anordnen, verbinden und
besprechen – flüssig auch bei sehr grossen Boards.

**Womit es sich abhebt (Positionierung) [Entscheidung]:**

| Hebel | Inhalt |
| --- | --- |
| Ruhe | ruhiges, fokussiertes Design statt bunter Werkzeugflut |
| Notizen als Wissen | eine Notiz existiert einmal und kann auf vielen Boards liegen, mit `[[Links]]` und Rückverweisen |
| Datenstandort | Hosting in der Schweiz/EU, DSGVO und nDSG von Anfang an |
| KI als Coach | KI schlägt vor, schreibt aber nie Nutzertext um |
| Leistung | eigene Engine: 10.000+ Objekte flüssig |
| Offen | Import aus verbreiteten Whiteboard-Formaten, Export in offene Formate |

**Was es (zunächst) nicht ist:** Zeichenprogramm, Präsentationswerkzeug, Video-Konferenz,
Projektmanagement-Suite.

**Messbare Produktziele für die erste öffentliche Version (v1):**

| Ziel | Wert |
| --- | --- |
| Objekte pro Board flüssig | 10.000 bei 60 fps (Referenz-Hardware festlegen) |
| Gleichzeitige Personen pro Board | 25 mit Live-Cursorn |
| Latenz einer Änderung zu anderen Personen | p95 ≤ 150 ms innerhalb Europas |
| Datenverlust | null; jede bestätigte Änderung überlebt einen Server-Neustart |
| Verfügbarkeit | 99,5 % pro Monat |
| Import | Haftnotizen, Formen, Text, Bilder, Rahmen eines typischen Boards aus mindestens einem verbreiteten Format |

---

## 2. Grundentscheidungen

Vorgeschlagene Standards. Jede Zeile ist eine **[Entscheidung]**, vor Phase 0 bestätigen.

| Thema | Vorschlag | Begründung |
| --- | --- | --- |
| Repository-Form | **ein Monorepo**, privat, auf GitHub | ein gültiger Stand, Vertragsänderungen in einem Schritt |
| Sprachen | TypeScript (Web, Server), **C++20** (Engine), SQL | Leistung in der Engine, ein Ökosystem für den Rest |
| Laufzeit Server | Node.js (aktuelle LTS) | gleiche Sprache wie Web |
| Paketverwaltung | Workspaces des Paketmanagers | eingebaut, kein Zusatzwerkzeug |
| Build-Orchestrierung | Werkzeug, das nur geänderte Pakete baut/testet | CI-Zeit bleibt klein |
| Datenbank | **PostgreSQL**, selbst betrieben | bewährt; eigene Datenbank zu schreiben lohnt nicht |
| Dateispeicher | S3-kompatibler Speicher (selbst betrieben oder Anbieter in CH/EU) | Standard-Schnittstelle, austauschbar |
| Echtzeit-Transport | WebSocket | überall verfügbar |
| Konfliktlösung | CRDT für Board-Dokumente | Offline und gleichzeitiges Bearbeiten ohne Sperren |
| Web-Framework | React mit Server-Rendering-Framework | verbreitet, gut für Agenten |
| Rendering | eigene Engine: WebGPU, Fallback WebGL2, über WebAssembly | Leistungsziele aus Abschnitt 1 |
| Hosting | Anbieter mit Rechenzentrum in CH/EU, Container-basiert | Datenschutz-Versprechen |
| Lizenzen fremder Bausteine | nur MIT, BSD, Apache-2.0, ISC, Zlib | kein Copyleft im Produkt |
| Sprache | **Code komplett Englisch**. **Webseite Deutsch**, von Tag 1 übersetzbar (Abschnitt 23) | Markt DACH zuerst, später international ohne Umbau |
| Planung und Führung der Agenten | **Polier 1.0** (eigenes Werkzeug): Board, Briefs, Slots, exklusive Gates, Claims, Worktrees, Release-Check | Fehler aus Abschnitt 16 verhindert das Werkzeug, nicht nur eine Regel |
| Design | **Design-Gesetz** und **Leinwand-Abnahmekatalog** (Abschnitt 21), automatisch geprüft | „sauber“ wird messbar, gilt für Web-App und Engine gleich |

**Pinning-Regel:** Jede Werkzeug- und Bibliotheksversion wird beim Setup aus der offiziellen
Quelle ermittelt, exakt gepinnt und in `docs/versions.md` mit Datum, Quelle und Lizenz
eingetragen. Nie „latest“. Konkrete Bibliotheken wählt die jeweilige Aufgabe und legt sie dem
Owner zur Freigabe vor.

---

## 3. Monorepo-Struktur

```text
project-air/
├─ README.md                    # Einstieg, 1 Seite
├─ ARCHITECTURE.md              # Zielbild, Schichten, Invarianten (max. 800 Wörter)
├─ AGENTS.md                    # Regeln für Agenten (max. 400 Wörter, verweist hierher)
├─ STATUS.md                    # aktueller Stand, generiert aus board.json
├─ CHANGELOG.md                 # ein Verlauf, Einträge mit Bereich, ab 0.0.1
├─ RELEASING.md                 # Bedienungsanleitung Release/Update/Changelog (Abschnitt 22)
├─ board.json                   # Aufgaben, Stufen, Abhängigkeiten, Gates, Status (Polier)
├─ .changes/                    # ein kleiner Änderungs-Eintrag pro Aufgabe
├─ docs/
│  ├─ adr/                      # Architekturentscheidungen ADR-0001 …
│  ├─ versions.md               # gepinnte Versionen mit Quelle und Lizenz
│  ├─ design-rules.md           # Design-Gesetz (Abschnitt 21.1)
│  ├─ canvas-acceptance.md      # Leinwand-Abnahmekatalog (Abschnitt 21.2)
│  ├─ engine.md                 # Engine-Architektur (aus Abschnitt 4.2 und ADR)
│  ├─ contracts.md              # Erklärung des Vertrags in Prosa
│  ├─ i18n/                     # Glossar, Stilregeln je Sprache (Abschnitt 23)
│  ├─ owner/                    # Owner-Dokumente, Deutsch erlaubt (dieser Bauplan, Entscheidungen)
│  └─ runbooks/                 # Betrieb: Umgebungen, Backup, Restore, Störungen
├─ tasks/                       # Aufgaben-Briefs Pxx-yy.md (Englisch)
├─ reviews/                     # Reviews und Gate-Nachweise
│
├─ packages/                    # Bibliotheken, werden importiert, nie allein deployt
│  ├─ contracts/                # Datenmodell, Operationen, Protokoll, Schemas, Codegen
│  ├─ engine/                   # C++ → WebAssembly, eigener Build + TS-Brücke
│  ├─ crdt/                     # Board-Dokument als CRDT hinter eigener Schnittstelle
│  ├─ ui-kit/                   # Design-Tokens, Icons, Basis-Komponenten
│  ├─ editor/                   # Notiz-Editor (Rich Text, [[Links]])
│  ├─ sdk/                      # typisierter Client für platform + sync
│  └─ test-kit/                 # gemeinsame Test-Helfer, Fixtures, Fake-Server
│
├─ services/                    # Server-Dienste, jeweils eigener Container
│  ├─ platform/                 # HTTP-API: Workspaces, Boards, Notizen, Rechte
│  ├─ auth/                     # Konten, Sessions, Einladungen, später SSO
│  ├─ sync/                     # WebSocket-Echtzeit, CRDT-Abgleich, Presence
│  ├─ media/                    # Uploads, Vorschauen, Thumbnails, PDF-Seiten
│  ├─ ai/                       # Coach, Suche, Zusammenfassungen
│  └─ worker/                   # Hintergrundjobs: Import, Export, Aufräumen
│
├─ apps/
│  ├─ web/                      # Haupt-App
│  ├─ engine-playground/        # Demo-Seite nur für die Engine, ohne Backend
│  └─ admin/                    # später: interne Admin-Konsole
│
├─ tools/
│  ├─ import-export/            # Import-/Export-Konverter (Bibliothek + CLI)
│  ├─ design-check/             # Prüfung Design-Gesetz (Abschnitt 21.3)
│  ├─ language-check/           # Prüfung Sprache/Übersetzung (Abschnitt 23.4)
│  ├─ release/                  # Release- und Changelog-Befehle (Abschnitt 22)
│  └─ dev/                      # Setup/Teardown pro Slot, Seed-Daten
│
├─ infra/
│  ├─ containers/               # Container-Definitionen pro Dienst
│  ├─ compose/                  # lokale Umgebung (Postgres, S3, Mail-Fänger, Dienste)
│  ├─ migrations/               # SQL-Migrationen (eine Quelle für alle Dienste)
│  └─ deploy/                   # Infrastruktur als Code (Umgebungen)
│
└─ tests/
   ├─ integration/              # Dienste zusammen, ohne Browser
   ├─ e2e/                      # Browser, ganzer Stack
   └─ perf/                     # Last- und Leistungstests
```

---

## 4. Die Pakete im Detail

Für jedes Paket: **Zweck · Liefert · Hängt ab von · Technik · Umfang v1 · Fertig wenn**.

### 4.1 `packages/contracts`

- **Zweck:** die gemeinsame Sprache. Alles, was zwei Pakete austauschen, ist hier definiert.
- **Liefert:** Typen und Schemas für Datenmodell, Operationen, Sync-Protokoll, API, Grenzen;
  generierten C++-Code für die Engine; Versionsnummer.
- **Hängt ab von:** nichts.
- **Technik:** JSON Schema als Quelle der Wahrheit, Codegen nach TypeScript und C++.
- **Umfang v1:** Abschnitt 5.
- **Fertig wenn:** jedes Schema hat gültige und ungültige Beispiele als Fixtures; Codegen ohne
  Handarbeit; ein Test zeigt, dass TS und C++ dieselben Fixtures gleich lesen.

### 4.2 `packages/engine`

- **Zweck:** zeichnet die Leinwand und verarbeitet Gesten.
- **Liefert:** `engine.wasm` + TS-Brücke (`createEngine(canvas, options)`), Ereignisse
  („Operation erzeugt“, „Objekt angeklickt“, „Auswahl geändert“).
- **Hängt ab von:** `contracts` (generierter C++-Code), `ui-kit` (generierter Token-Header).
- **Technik:** C++20 → WebAssembly (Emscripten), CMake, WebGPU + WebGL2-Fallback.
- **Architektur:**
  - Module: `doc` (Objekte in flachen Arrays), `camera` (Pan/Zoom, Umrechnung), `spatial`
    (Raumindex), `hit` (Treffertest, Griffe), `gesture` (Zustandsmaschine: Drücken → Ziehen/
    Klick → Loslassen), `snap`, `ops` (Operationen `{do, undo}`), `render` (Ebenen nach
    Design-Gesetz §8), `gpu/webgpu` + `gpu/webgl2`, `text` (Glyphen-Atlas), `image` (Texturen,
    Detailstufen).
  - Brücke JS ↔ WASM schmal und binär: Befehlspuffer pro Frame, kein Aufruf pro Objekt.
  - Eingaben (Maus, Trackpad, Touch, Tastatur) werden in JS gesammelt und normalisiert, die
    Gesten-Logik lebt in C++.
  - Text zum Start: Browser rastert Text in einen Atlas, Engine zeichnet Texturen; eigene
    Schriftdarstellung erst, wenn nötig.
  - Bearbeiten von Feldern über ein **DOM-Overlay** (echtes Eingabefeld über dem Objekt).
  - **A11y-/Test-Spiegel:** unsichtbare DOM-Liste aller sichtbaren Objekte (Rolle, Name,
    `data-testid`) für Screenreader und Tests.
  - Nur zeichnen, wenn sich etwas ändert (kein Dauer-Loop im Ruhezustand).
- **Umfang v1:** Kamera, Raumindex, Treffertest, Gesten (Ziehen, Schwelle, Einrasten,
  Mehrfachauswahl, Grösse ändern), Karten, Zonen, Blöcke, Kanten, Text, Bilder, Live-Cursor
  fremder Personen, A11y-/Test-Spiegel, DOM-Overlay.
- **Fertig wenn:** Playground zeigt 10.000 Objekte bei 60 fps; alle Engine-Einträge des
  Abnahmekatalogs erfüllt; Bildvergleichstests für beide Backends grün.
- **Kennt nicht:** Netzwerk, Datenbank, Konten. Sie bekommt Operationen hinein und gibt
  Operationen heraus.

### 4.3 `packages/crdt`

- **Zweck:** Board-Inhalt so halten, dass mehrere Personen gleichzeitig und offline ändern
  können und alle am Ende denselben Stand haben.
- **Liefert:** `BoardDoc` mit `apply(op)`, `encodeUpdate()`, `applyUpdate()`, `snapshot()`.
- **Hängt ab von:** `contracts`.
- **Technik [Entscheidung]:** (a) bewährte Open-Source-CRDT-Bibliothek (MIT) hinter eigener
  Schnittstelle oder (b) eigener CRDT. **Vorschlag:** (a) für v1, Schnittstelle so, dass (b)
  später austauschbar ist.
- **Fertig wenn:** Konvergenz-Tests (zufällige Operationen in 3 Kopien, beliebige Reihenfolge →
  gleicher Endstand) laufen 10.000 Runden ohne Abweichung.

### 4.4 `packages/ui-kit`

- **Zweck:** ein Look überall.
- **Liefert:** `tokens.json` (Farben, Abstände, Radien, Schatten, Schrift, Bewegung, Schwellen)
  → generierte CSS-Variablen **und** C++-Header `tokens.h`; Icons (SVG); Knöpfe, Menüs,
  Dialoge, Tooltips.
- **Fertig wenn:** jede Komponente hat alle Zustände aus Design-Gesetz §6 und eine
  Beispielseite; Codegen erzeugt CSS und C++ ohne Handarbeit.

### 4.5 `packages/editor`

- **Zweck:** Notiz-Editor im Panel.
- **Technik [Entscheidung]:** etablierte Rich-Text-Editor-Bibliothek (MIT), Inhalt als
  strukturiertes JSON, Klartext für die Suche beim Speichern abgeleitet.
- **Fertig wenn:** Notiz schreiben, `[[Link]]` mit Vorschlagsliste setzen, Speichern mit Status,
  Platzhalter und Fokus in leerer Notiz (Abnahmekatalog L06).

### 4.6 `packages/sdk`

- **Zweck:** ein typisierter Client für alle Server-Aufrufe, damit `apps/web` nie selbst URLs
  zusammenbaut.
- **Liefert:** `api.boards.list()`, `api.notes.update()`, `sync.connect(boardId)` …
- **Hängt ab von:** `contracts`.

### 4.7 `packages/test-kit`

- **Zweck:** gleiche Testdaten und Helfer für alle.
- **Liefert:** Fixture-Boards (leer, klein, 500, 10.000 Objekte), Fake-Sync-Server,
  Login-Helfer, Port-Ermittlung aus `.polier-slot`.

### 4.8 `services/platform` – eigenes Backend

- **Zweck:** dauerhafte Daten und Rechte.
- **Liefert:** HTTP-API für Workspaces, Mitglieder, Boards, Notizen, Links, Vorlagen,
  Dateien-Metadaten; prüft bei **jedem** Zugriff die Berechtigung.
- **Hängt ab von:** `contracts`, PostgreSQL, `auth`.
- **Technik:** Node.js, SQL-Migrationen aus `infra/migrations/`, Row-Level-Security in
  PostgreSQL als zweite Sicherheitslinie, Verbindungspool.
- **Umfang v1:** Workspaces, Rollen (Besitzer, Bearbeiter, Leser), Boards, Notizen,
  Teilen-Links, Vorlagen, Papierkorb (30 Tage), Audit-Log für Rechteänderungen.
- **Fertig wenn:** API-Testsuite deckt jede Route mit „darf“ und „darf nicht“ ab; RLS-Tests
  zeigen, dass ein fremder Workspace nie lesbar ist, auch bei falscher API-Logik.

### 4.9 `services/auth`

- **Zweck:** wer ist diese Person?
- **Liefert:** Registrierung, Login (E-Mail + Passwort, Magic Link), Passwort zurücksetzen,
  Sessions (kurzlebige Tokens + Refresh), Einladungen; später Login über externe
  Identitätsanbieter, SAML/SCIM.
- **Technik [Entscheidung]:** selbst gebaut auf bewährten Bausteinen (Argon2id, signierte
  Tokens) oder selbst gehosteter Open-Source-Auth-Server. **Vorschlag:** selbst gebaut, schmal,
  mit externem Sicherheits-Review vor v1.
- **Fertig wenn:** Sicherheits-Checkliste (Rate-Limits, Sperre nach Fehlversuchen, sichere
  Cookies, Token-Rotation, keine Passwörter in Logs) abgehakt und extern geprüft.

### 4.10 `services/sync`

- **Zweck:** Echtzeit.
- **Liefert:** WebSocket-Endpunkt pro Board; verteilt CRDT-Updates und Presence (Cursor,
  Auswahl, Name, Farbe); speichert Updates sofort dauerhaft (Write-Ahead in PostgreSQL) und
  verdichtet sie regelmässig zu Snapshots.
- **Hängt ab von:** `contracts`, `crdt`, PostgreSQL, `auth`, `platform` (Rechte beim Verbinden).
- **Umfang v1:** 25 Personen pro Board, Wiederverbinden mit Nachholen, Offline-Änderungen beim
  Wiederverbinden zusammenführen, horizontale Skalierung (Board → Server-Zuordnung).
- **Fertig wenn:** Lasttest 25 Clients × 10 Operationen/s, p95 ≤ 150 ms; Server-Neustart während
  des Tests verliert keine bestätigte Änderung.

### 4.11 `services/media`

- **Zweck:** Dateien.
- **Liefert:** signierte Upload-URLs, Virenprüfung [Entscheidung], Bild-Thumbnails in mehreren
  Grössen (für Detailstufen der Engine), PDF-Seitenbilder, Textauszug für die Suche.
- **Grenzen:** Dateien privat pro Workspace; Auslieferung nur über signierte, kurzlebige URLs.

### 4.12 `services/ai`

- **Zweck:** Coach und Suche.
- **Liefert:** Vorschläge (nie Ghostwriting), Zusammenfassungen, semantische Suche.
- **Regeln:** KI nur serverseitig; jede Antwort gegen Schema validiert, ungültig = Fehler ohne
  Änderung; Budget pro Person/Tag und global/Monat vor dem Aufruf atomar reserviert;
  KI-Anbieter im Datenschutzhinweis; Modell-Kennungen nur als Konstanten an einer Stelle;
  Antworten in der Sprache der Person.

### 4.13 `services/worker`

- **Zweck:** alles, was länger als eine Anfrage dauert: Import, Export, Thumbnails nachrechnen,
  Papierkorb leeren, Snapshots verdichten.
- **Technik:** Job-Warteschlange in PostgreSQL (keine zusätzliche Infrastruktur in v1).

### 4.14 `apps/web`

- **Zweck:** das Produkt, das Personen sehen.
- **Liefert:** Startseite, Login, Boards-Liste, Board mit Engine, Panel mit Editor, Vorlagen,
  Bibliothek, Suche, Einstellungen, Teilen.
- **Hängt ab von:** `ui-kit`, `editor`, `engine`, `sdk`, `contracts`. **Nie** direkt von
  `services/*` (nur über `sdk`).

### 4.15 `apps/engine-playground`

- **Zweck:** Engine allein entwickeln und vorführen, ohne Login und Server.
- **Liefert:** Szenen (leer, 500, 10.000, Stress), FPS-Anzeige, Backend-Umschalter
  WebGPU/WebGL2, simulierte fremde Cursor.

### 4.16 `tools/import-export`

- **Zweck:** Daten mitnehmen – rein und raus.
- **Liefert:** Import aus verbreiteten Whiteboard-Exportformaten [Entscheidung: welche, nach
  rechtlicher Prüfung der Nutzungsbedingungen], Export als PDF, PNG, Markdown-ZIP und eigenes
  JSON-Format (verlustfrei).
- **Fertig wenn:** 10 Beispiel-Boards (anonymisiert) importieren mit Abnahmeliste pro
  Objekttyp; JSON-Export → Import ergibt identischen Stand.

### 4.17 `infra/*`

- **Liefert:** Container-Definitionen, lokale Umgebung, Migrationen, Umgebungen als Code,
  Backups, Monitoring (Logs, Metriken, Alarme).

---

## 5. Der Vertrag (`contracts`) – Herzstück

Alles fügt sich nur zusammen, wenn alle dieselbe Sprache sprechen. Deshalb wird der Vertrag
**zuerst** gebaut und **nur über Versionen** geändert.

### 5.1 Inhalt

| Teil | Inhalt |
| --- | --- |
| **IDs** | UUIDv7 (zeitlich sortierbar) |
| **Datenmodell** | `Workspace`, `Member`, `Board`, `Note`, `BoardObject` (Karte, Zone, Block-Typen, Bild, Datei), `Edge`, `Comment`, `Template` |
| **Geometrie** | Welt-Koordinaten in Pixeln (Float64), Raster 16, z-Ordnung als Bruch-Index (Einfügen ohne Umnummerieren), Eltern-Beziehung (Objekt in Zone) |
| **Operationen** | `create`, `update` (Teilfelder), `move`, `resize`, `reparent`, `delete`, `restore`, `reorder`, `group` (Sammeloperation = eine Geste) |
| **Undo-Paare** | jede Operation definiert ihre Gegenoperation |
| **Sync-Protokoll** | Nachrichten `hello`, `sync-step`, `update`, `presence`, `ack`, `error`; Versionsfeld in jeder Nachricht |
| **API** | Ressourcen, stabile Fehlercodes (sprachneutral; Texte übersetzt die App) |
| **Grenzen** | max. Objekte pro Board, Textlängen, Dateigrössen, Mindestgrössen pro Objekttyp – an einer Stelle |

### 5.2 Beispiel einer Operation (Format, nicht endgültig)

```json
{
  "v": 1,
  "op": "move",
  "id": "0192f0c4-…",
  "board": "0192f0a1-…",
  "actor": "0192e9…",
  "at": "2027-01-10T09:00:00.000Z",
  "objects": [{ "id": "0192f0c5-…", "x": 512, "y": 256 }],
  "undo": { "op": "move", "objects": [{ "id": "0192f0c5-…", "x": 480, "y": 240 }] }
}
```

### 5.3 Versionsregeln

- **SemVer** für `contracts`: Patch = Doku/Fixtures, Minor = neues optionales Feld oder neue
  Operation, Major = Bedeutung ändert sich oder Feld fällt weg.
- **Server versteht immer aktuelle und vorherige Major-Version** (Übergangszeit für offene
  Browser-Tabs).
- **Jede Änderung** an `contracts` braucht neue Fixtures, Codegen-Lauf, alle abhängigen Pakete
  im **selben Pull Request** angepasst, Eintrag in `docs/contracts.md`.
- **Nie** ein Feld umbenennen; neues Feld anlegen, altes als veraltet markieren, nach einer
  Major-Version entfernen.

---

## 6. Abhängigkeitsregeln

```text
apps/web ──► ui-kit, editor, engine, sdk, contracts
apps/engine-playground ──► engine, ui-kit, test-kit, contracts
engine ──► contracts, ui-kit (nur generierte Tokens)
crdt ──► contracts
sdk ──► contracts
services/sync ──► crdt, contracts
services/platform, auth, media, ai, worker ──► contracts
tools/import-export ──► contracts
contracts ──► (nichts)
```

- **Verboten:** `apps/*` importiert `services/*`; `services/*` importieren sich gegenseitig im
  Code (Kommunikation nur über HTTP/Nachrichten); `engine` kennt Netzwerk oder Konten.
- **Durchsetzung:** Polier-Gate `boundaries` (Importgrenzen für TS und C++). Ein Verstoss
  bricht den Build.

---

## 7. Arbeitsregeln für Agenten

Diese Regeln stehen gekürzt in `AGENTS.md` (Englisch) und vollständig hier.

### 7.1 Arbeitsplatz

1. **Nie im Hauptordner arbeiten.** Jede Aufgabe bekommt einen eigenen Worktree:
   `tools/worktree.py start <task-id>` (Polier: Worktree + Branch `task/<task-id>` + Slot +
   Claim); `finish <task-id>` räumt auf.
2. **Ein Worktree = eine Aufgabe = ein Branch = ein Pull Request.**
3. **Ports und Datenbank pro Worktree** (Abschnitt 10). Kein Agent startet oder beendet
   Prozesse, die nicht zu seinem Slot gehören. **Nie** `kill`/`pkill` auf fremde Prozesse.
4. Die Daten des Owners (Slot 0) werden **nie** zurückgesetzt.

### 7.2 Umfang

5. Jeder Brief nennt **erlaubte Pfade**. Polier blockiert Schreiben ausserhalb; die CI prüft
   den Diff zusätzlich.
6. Ändert eine Aufgabe `contracts`, passt sie **alle** Abhängigen im selben PR an.
7. Keine neue Abhängigkeit ohne Freigabe; Freigabe steht in `docs/versions.md`.
8. Bestehende Tests nicht ändern oder löschen ohne Freigabe.

### 7.3 Qualität

9. Jede Aufgabe hat Gates aus `board.json`. Jedes Gate läuft über `gate.py`; der Nachweis
   liegt unter `reviews/evidence/`.
10. **Exklusive Gates:** e2e, Leistung und alles mit gemeinsamer Ressource laufen über
    `gate.py --exclusive <ressource>` (wartet statt parallel zu starten). Ports und Datenbank
    nur aus `.polier-slot`.
10a. **Sprache:** Code, Kommentare, Commits, Tests, Briefs, Reviews auf Englisch; jeder für
    Nutzer sichtbare Text nur als Schlüssel in `messages/*.json` (de **und** en im selben PR);
    Gate `language-check` Pflicht (Abschnitt 23).
10b. **UI-Aufgaben** halten das Design-Gesetz ein und belegen den passenden Eintrag des
    Abnahmekatalogs (Abschnitt 21); Gate `design-check` Pflicht.
11. Unklar → `open_questions` im Ergebnis; nicht raten, nicht als erledigt melden.
12. Unabhängiges Review vor dem Merge (anderer Agent oder Mensch).

### 7.4 Releases

13. **Agenten veröffentlichen nie.** Releases macht der Owner mit einem Befehl, ausgeführt von
    der CI aus einem Tag (Abschnitt 22).
14. Nie direkt auf `main` pushen; nur über Pull Request mit grüner CI.

---

## 8. Ablauf einer einzelnen Aufgabe

```text
Brief ─► Worktree ─► Lesen ─► Bauen ─► Gates ─► PR ─► Review ─► Merge ─► Aufräumen
```

| Schritt | Wer | Was genau | Ergebnis |
| --- | --- | --- | --- |
| 1 Brief | Lead/Owner | `tasks/<id>.md` (Englisch): Ziel, Hintergrund, erlaubte Pfade, Soll-Werte, Nicht-tun, Abnahme-Checkboxen, Gates | Brief im Repo, Eintrag in `board.json` (`ready`) |
| 2 Worktree | Agent | `tools/worktree.py start <id>`; `tools/dev/setup` liest `.polier-slot`, legt DB + Bucket an | eigener Arbeitsplatz |
| 3 Lesen | Agent | `ARCHITECTURE.md`, `AGENTS.md`, `STATUS.md`, betroffene ADRs, Brief, Dateien im Pfad | Fragen sofort in `open_questions` |
| 4 Bauen | Agent | Code + neue Tests; nur in erlaubten Pfaden; `.changes/`-Eintrag | Commits auf `task/<id>` |
| 5 Gates | Agent | jedes Gate über `gate.py` | Nachweise in `reviews/evidence/` |
| 6 PR | Agent | PR `<id>: <title>`, Beschreibung = Abnahme-Checkboxen ✓/✗ + Nachweise + `open_questions` | PR offen, CI läuft |
| 7 Review | anderer Agent/Mensch | prüft Brief-Treue, Abnahme, Design-Gesetz, Sprache; wiederholt Gates | `reviews/<id>.md` pass/fail |
| 8 Merge | Lead/Owner | Squash-Merge nach grüner CI + Review pass | ein Commit auf `main` |
| 9 Aufräumen | Agent | `tools/worktree.py finish <id>`; `board.json` → `done` | sauberer Rechner |

**„Fertig“ heisst:** alle Abnahme-Checkboxen ✓, alle Gates grün mit Nachweis, Review pass,
Changelog-Eintrag, keine `open_questions` offen (oder vom Owner abgezeichnet).

---

## 9. Branches, Versionen, Releases (Kurzfassung)

> Bedienungsanleitung mit Befehlen und Regeln: Abschnitt 22 (wird `RELEASING.md`).

- **Trunk-based:** `main` ist immer lauffähig. Arbeit nur auf kurzlebigen `task/<id>`-Branches
  (Ziel < 3 Tage).
- **Commits:** `<task-id>: <title>`; Squash-Merge, ein Task = ein Commit.
- **Eine Produktversion** bis v1, Start `0.0.1`, Einträge mit Bereich (Abschnitt 22.1).
- **Changelog:** jeder PR bringt einen `.changes/`-Eintrag; `CHANGELOG.md` schreibt nur der
  Release (Abschnitt 22.3).
- **Release:** Owner führt `npm run release -- patch|minor|major "…"` aus → Release-PR → nach
  Merge setzt die CI den Tag → Build aus dem Tag → staging → Freigabe → production. Rückweg:
  vorherigen Tag erneut ausrollen (Migrationen sind rückwärtskompatibel, 13.3).
- **Vorschau pro PR:** eigene Umgebung mit Seed-Datenbank, wird beim Schliessen gelöscht.

---

## 10. Lokale Entwicklungsumgebung und Ports

### 10.1 Was lokal läuft

`infra/compose/` startet PostgreSQL, S3-kompatiblen Speicher, einen Mail-Fänger (für
Login-Mails) und optional alle Dienste. Ein Befehl: `npm run dev:up`.

### 10.2 Port-Schema (verhindert Zusammenstösse)

Jeder Worktree hat eine Nummer `N` (0 = Hauptordner des Owners, 1–9 = Agenten-Worktrees),
vergeben von Polier (`tools/slot.py acquire`) und gespeichert in `.polier-slot` (nicht
eingecheckt). Das Board trägt `resources` mit `port_base: 4000`, `port_stride: 100` und den
Dienst-Offsets.

| Dienst | Port-Formel | Owner (N=0) | Agent N=3 |
| --- | --- | --- | --- |
| apps/web | 4000 + 100·N | 4000 | 4300 |
| apps/web e2e | 4001 + 100·N | 4001 | 4301 |
| platform | 4010 + 100·N | 4010 | 4310 |
| auth | 4020 + 100·N | 4020 | 4320 |
| sync | 4030 + 100·N | 4030 | 4330 |
| media | 4040 + 100·N | 4040 | 4340 |
| ai | 4050 + 100·N | 4050 | 4350 |
| engine-playground | 4060 + 100·N | 4060 | 4360 |
| PostgreSQL | gemeinsamer Server, **Datenbank** `air_slot_N` | `air_slot_0` | `air_slot_3` |
| S3 | gemeinsamer Server, **Bucket** `air-slot-N` | `air-slot-0` | `air-slot-3` |

- Testrunner lesen Ports **nur** aus `.polier-slot`. Fest verdrahtete Ports sind ein Lint-Fehler.
- `tools/dev/setup` legt DB und Bucket an, spielt Migrationen + Seed ein; `teardown` räumt auf.
- Kein Skript setzt `air_slot_0` zurück.

---

## 11. Teststrategie

| Ebene | Was | Wo | Wann in CI |
| --- | --- | --- | --- |
| Unit (TS) | reine Funktionen, Schemas, SDK | im Paket | jeder PR, betroffene Pakete |
| Unit (C++) | Kamera, Raumindex, Gesten, Einrasten, Ops | `packages/engine/tests` | bei Änderung an engine/contracts |
| Vertrag | TS und C++ lesen dieselben Fixtures gleich | `packages/contracts/tests` | bei Änderung an contracts/engine |
| CRDT-Konvergenz | zufällige Operationen, 3 Kopien | `packages/crdt/tests` | bei Änderung an crdt/contracts |
| API | jede Route: darf / darf nicht | `services/platform/tests` | bei Änderung an platform/auth/migrations |
| RLS/DB | fremder Workspace nie lesbar | `infra/migrations/tests` | bei Änderung an migrations |
| Integration | Dienste zusammen, ohne Browser | `tests/integration` | jeder PR |
| Bildvergleich | Engine-Szenen pro Backend, Web-Seiten 1440×900 und 390×844 | `packages/engine/visual`, `tests/e2e/visual` | bei Änderung an engine/UI |
| e2e | Browser, ganzer Stack | `tests/e2e` | PR: betroffene Specs (exklusiv); nachts: alle |
| Pseudo-Sprache | Hauptabläufe in `en-XA` | `tests/e2e` | nachts |
| Last/Leistung | 10.000 Objekte, 25 Clients | `tests/perf` | nachts + vor Release |
| Sicherheit | Abhängigkeits-Scan, Secret-Scan, Auth-Checkliste | CI | jeder PR + vor Release |

**Regeln:** Tests greifen nur über Rollen, `data-testid` und den A11y-Spiegel zu – nie über
interne CSS-Klassen einer Bibliothek. Jeder Fehlerfix bringt einen Test mit, der vorher rot war.

---

## 12. CI-Pipeline

```text
PR geöffnet
 ├─ 1 Scope-Check (nur erlaubte Pfade laut Brief)
 ├─ 2 boundaries (Abhängigkeitsregeln, Abschnitt 6)
 ├─ 3 Lint + Typecheck (betroffene Pakete)
 ├─ 4 Unit TS / C++ / Vertrag / CRDT (betroffene)
 ├─ 5 Build (betroffene) inkl. engine.wasm (gepinnte Toolchain)
 ├─ 6 Integration
 ├─ 7 e2e (betroffene Specs, exklusiv) gegen Vorschau-Umgebung
 ├─ 8 Bildvergleich (wenn engine oder UI betroffen)
 ├─ 9 Secret- und Abhängigkeits-Scan
 ├─ 10 design-check + UI-Screenshots vorhanden (Abschnitt 21.3)
 ├─ 11 language-check (Abschnitt 23.4)
 ├─ 12 changelog-entry (Abschnitt 22.3)
 └─ 13 Vorschau-Umgebung bereitstellen, Smoke-Test, Link im PR
Merge auf main
 └─ alles oben + Vollbuild, Artefakte mit Commit-Hash
Nachts
 └─ alle e2e, en-XA, Leistung, Last, Backup-Wiederherstellungstest
Tag
 └─ Release-Ablauf (Abschnitt 22.4)
```

---

## 13. Umgebungen, Deployment, Datenbank

### 13.1 Umgebungen

| Umgebung | Zweck | Daten | Wer deployt |
| --- | --- | --- | --- |
| local | Entwicklung | Seed, pro Slot | Agent/Mensch |
| preview | pro PR / benannter Vorschau-Stand | Seed | CI automatisch |
| staging | Vorabtest des Releases | anonymisierte Kopie oder Seed | CI aus Tag |
| production | echte Nutzer | echt | CI aus Tag nach Freigabe |

### 13.2 Geheimnisse und Konfiguration

- Nur im Secret-Speicher der Hosting-Plattform bzw. der CI; nie im Repo, nie im Client-Bundle,
  nie in Logs. Pro Umgebung eigene Schlüssel. Production-Schlüssel kennt kein Agent.
- **Jede Umgebung hat eine Variablen-Liste** in `docs/runbooks/environments.md` (Namen, nie
  Werte). Neue Variable = Eintrag dort im selben PR.
- **Nach jedem Deploy** läuft ein Smoke-Test (Polier `smoke.py`) über feste Seiten; fehlt eine
  Variable, ist er rot, bevor jemand die Seite öffnet.

### 13.3 Migrationen

- Eine Migrationsquelle: `infra/migrations/NNNN_name.sql` (englische Namen).
- **Expand → Migrate → Contract:** erst Neues hinzufügen (rückwärtskompatibel), Code umstellen,
  Altes erst im nächsten Release entfernen. So ist jedes Release zurückrollbar.
- Jede Migration hat einen DB-Test; RLS für jede neue Tabelle ist Pflicht.

### 13.4 Betrieb

- Backups: täglich voll + kontinuierliches WAL-Archiv; **wöchentlich automatischer
  Wiederherstellungstest**.
- Monitoring: Fehlerquote, Latenz (API, Sync), aktive Verbindungen, Speicher; Alarme an Owner.
- Runbooks: Datenbank wiederherstellen, Sync-Server ausgefallen, Schlüssel rotieren,
  Datenpanne melden.

---

## 14. Sicherheit und Datenschutz

- Hosting und Backups in CH/EU [Entscheidung: Land/Anbieter].
- Datenschutzhinweis (DSGVO + nDSG) vor dem ersten externen Tester; Auftragsverarbeitung mit
  jedem Anbieter (Hosting, Mail, KI) dokumentiert.
- Berechtigung zweifach: API-Logik **und** Row-Level-Security.
- Passwörter: Argon2id; Login-Rate-Limit; Sperre nach Fehlversuchen; sichere Cookies
  (`HttpOnly`, `Secure`, `SameSite`).
- Dateien: privat pro Workspace, signierte kurzlebige URLs, Typ- und Grössenprüfung.
- KI: nur serverseitig, kein Training mit Nutzerdaten, im Hinweis ausgewiesen.
- Externer Sicherheits-Review (Auth, Sync, Rechte) vor v1.
- Konto löschen = alle Daten innerhalb von 30 Tagen weg, inklusive Backups nach Ablauf.

---

## 15. Der Gesamtablauf – Phase für Phase

Jede Phase: **Ziel · Aufgaben (in Reihenfolge) · Abnahme (Gate zur nächsten Phase)**.
Aufgaben-IDs: `P<Phase>-<Nr>`. Parallel nur, was in der Spalte „parallel“ markiert ist **und**
getrennte Pfade hat. Stufen und Stopp-Punkte stehen als `stages` im Board (Polier).

### Phase 0 – Fundament (2–3 Wochen)

**Ziel:** leeres, aber vollständig arbeitsfähiges Monorepo – mit allen Prüfungen, die später
Fehler verhindern.

| ID | Aufgabe | parallel |
| --- | --- | --- |
| P0-00 | **Voraussetzung:** Polier 1.0 mindestens Stufe 1 + 2 fertig (Slots, exklusive Gates, Claims, Worktrees, Monorepo, Stufen) | – |
| P0-01 | Owner bestätigt Grundentscheidungen (Abschnitt 2) und Positionierung (Abschnitt 1) | – |
| P0-02 | GitHub-Repo anlegen (privat), Branch-Schutz `main` (nur PR, grüne CI, 1 Review, kein Force-Push) | – |
| P0-03 | Ordnerstruktur aus Abschnitt 3, je Paket README (Englisch) mit Zweck | – |
| P0-04 | Workspaces + Build-Orchestrierung, Versionen pinnen, `docs/versions.md` | – |
| P0-05 | `ARCHITECTURE.md`, `AGENTS.md`, `STATUS.md`, `board.json` (mit `stages`, `packages`, `resources`), ADR-0001 „Monorepo“ | ja (mit P0-06) |
| P0-06 | `tools/dev/setup|teardown` mit Port-Schema und Slot-Datenbanken | ja |
| P0-07 | `infra/compose`: PostgreSQL, S3, Mail-Fänger | ja |
| P0-08 | CI-Grundgerüst: Scope-Check, boundaries, Lint, Typecheck, leere Tests | nach P0-04 |
| P0-09 | Gate-Werkzeug und Nachweis-Ordner (Polier `gate.py`) eingebunden | ja |
| P0-10 | `docs/design-rules.md` prüfen und übernehmen (Entwurf liegt vor) | ja |
| P0-11 | `docs/canvas-acceptance.md` prüfen und übernehmen (Entwurf liegt vor) | nach P0-10 |
| P0-12 | Codegen aus vorhandener `packages/ui-kit/tokens.json` → CSS-Variablen + C++-Header; Icons einbinden | nach P0-10 |
| P0-13 | `tools/design-check` + CI-Gate `design-check` (Abschnitt 21.3) | nach P0-12 |
| P0-14 | `CHANGELOG.md` mit `0.0.1`, `.changes/`, `npm run change`, Gate `changelog-entry` (Abschnitt 22.3) | nach P0-08 |
| P0-15 | Release-Befehle `release` / `release -- preview` + CI-Release aus Tags (Abschnitt 22.4) | nach P0-14 |
| P0-16 | Update-Automatik (Abhängigkeits-PRs), Polier-Update-Prüfung, optional KI-Changelog (Abschnitt 22.5, 22.6) | nach P0-15 |
| P0-17 | `RELEASING.md` aus Abschnitt 22, erstes Release `0.0.1` durchspielen | nach P0-15 |
| P0-18 | i18n-Grundgerüst auf den vorhandenen `messages/*.json`, Gate `language-check`, Glossar und Stilregeln übernehmen (Abschnitt 23.6) | ja (ab P0-08) |

**Abnahme Phase 0:**
- frischer Klon → `npm ci && npm run dev:up && tools/dev/setup` läuft auf einem zweiten
  Rechner ohne Handarbeit;
- zwei Worktrees laufen gleichzeitig ohne Port-Konflikt; zwei e2e-Läufe warten aufeinander
  statt sich zu stören;
- je ein Test-PR wird abgelehnt: Änderung ausserhalb des Pfads (Scope), neue Hex-Farbe
  (`design-check`), deutscher Kommentar oder hart codierter Knopftext (`language-check`), Code
  ohne Änderungs-Eintrag (`changelog-entry`);
- `tokens.json` erzeugt CSS und C++ ohne Handarbeit;
- Release `0.0.1` und eine Vorschau sind einmal komplett über die CI gelaufen (Tag → Build →
  staging → Freigabe → production) und stehen im Changelog;
- Beispielseite zeigt Deutsch, Englisch und `en-XA` nur durch Umschalten der Sprache.

### Phase 1 – Vertrag (2–3 Wochen)

**Ziel:** die gemeinsame Sprache steht in Version 0.1.

| ID | Aufgabe | parallel |
| --- | --- | --- |
| P1-01 | Datenmodell (Abschnitt 5.1) als Schemas + Fixtures, inkl. Eltern-Beziehung, Bruch-Index, Mindestgrössen | – |
| P1-02 | Operationen + Undo-Paare + Sammeloperation `group` + Fixtures | nach P1-01 |
| P1-03 | Codegen TS + C++, Prüftest „gleiche Fixtures, gleiches Ergebnis“ | nach P1-02 |
| P1-04 | Sync-Protokoll-Nachrichten | ja (mit P1-05) |
| P1-05 | API-Ressourcen + Fehlercodes (je ein Übersetzungsschlüssel `errors.<CODE>`) | ja |
| P1-06 | `docs/contracts.md` + ADR „Vertrag und Versionen“ | ja |

**Abnahme Phase 1:** `contracts@0.1.0` getaggt; Codegen ohne Handarbeit; Review durch Owner.

### Phase 2 – Engine-Spike (2–3 Wochen) – **Stopp-Punkt**

**Ziel:** beweisen, dass die eigene Engine die Leistungsziele schafft.

| ID | Aufgabe | parallel |
| --- | --- | --- |
| P2-01 | C++ → WebAssembly-Build, Laden im Playground | – |
| P2-02 | WebGPU- und WebGL2-Backend hinter einer Schnittstelle | nach P2-01 |
| P2-03 | 50.000 instanzierte Rechtecke, Pan/Zoom, FPS-Messung (= Leistungs-Basis, Katalog L01) | nach P2-02 |
| P2-04 | Raumindex-Varianten messen (Grid-Hash vs. R-Baum) | ja (mit P2-05) |
| P2-05 | Brücke messen: Befehlspuffer JS ↔ WASM pro Frame | ja |
| P2-06 | Bericht mit Zahlen + ADR „Engine-Architektur“ + `docs/engine.md` | nach allen |

**Abnahme Phase 2:** 60 fps bei 50.000 Rechtecken auf Referenz-Hardware, WASM ≤ 300 KB gzip.
**Owner entscheidet: weiter oder Plan B** (Engine in TypeScript mit Canvas2D/WebGL).

### Phase 3 – Backend-Kern (4–6 Wochen, parallel zu Phase 4)

**Ziel:** Konten, Rechte und dauerhafte Daten.

| ID | Aufgabe | parallel |
| --- | --- | --- |
| P3-01 | Migrationen: Workspaces, Mitglieder, Boards, Notizen, Objekte (mit Eltern-Feld), Links + RLS + DB-Tests | – |
| P3-02 | `auth`: Registrieren, Login, Logout, Sessions, Passwort zurücksetzen, mehrsprachige E-Mails | nach P3-01 |
| P3-03 | `platform`: Workspaces, Rollen, Boards, Notizen (CRUD) mit Rechteprüfung | nach P3-02 |
| P3-04 | `sdk`: typisierter Client für auth + platform | nach P3-03 |
| P3-05 | `media`: Upload, Thumbnails, signierte URLs | ja (ab P3-02) |
| P3-06 | `worker`: Job-Warteschlange + erster Job (Thumbnails) | ja (mit P3-05) |

**Abnahme Phase 3:** API-Testsuite (darf/darf nicht) grün; RLS-Tests grün; ein Skript legt per
`sdk` Konto, Workspace, Board und Notiz an und liest sie zurück; ein zweites Konto sieht nichts.

### Phase 4 – Engine-Kern (6–8 Wochen, parallel zu Phase 3)

**Ziel:** Board-Inhalte anzeigen und bearbeiten – zunächst ohne Server.

| ID | Aufgabe | parallel |
| --- | --- | --- |
| P4-01 | Dokument + Kamera + Raumindex + Treffertest; Ansicht pro Board merken (L17) | – |
| P4-02 | Zeichnen: Karten, Zonen, Blöcke, Kanten, Raster, Auswahl; Ebenen (L13); Canvas-Feel (L19); sichtbare Qualität (L02) | nach P4-01 |
| P4-03 | Text-Atlas, Titel/Vorschau mit Ellipse | nach P4-02 |
| P4-04 | Gesten: Ziehen vs. Bearbeiten (L03), Einrasten (L07), Zonen als Container (L08), Mehrfachauswahl (L10), Grösse ändern (L14), Tastatur (L12), Trackpad (L15), Platzierung (L20) | nach P4-01 |
| P4-05 | Operationen `{do, undo}` + Verlauf (L11) | nach P4-04 |
| P4-06 | Bilder mit Detailstufen | nach P4-03 |
| P4-07 | A11y-/Test-Spiegel | nach P4-02 |
| P4-08 | DOM-Overlay für Feldbearbeitung, Inline-Komfort (L18) | nach P4-04 |
| P4-09 | Bildvergleichstests beider Backends | nach P4-03 |

**Abnahme Phase 4:** Playground zeigt 10.000 Objekte bei 60 fps; alle Katalog-Einträge mit
Phase 4 erfüllt; Bildvergleich grün; Design-Werte der Engine stammen nachweislich aus
`tokens.json`; Screenreader liest Objekte über den Spiegel.

### Phase 5 – Echtzeit (5–7 Wochen)

**Ziel:** mehrere Personen gleichzeitig auf einem Board.

| ID | Aufgabe | parallel |
| --- | --- | --- |
| P5-01 | `crdt`: BoardDoc + Konvergenz-Tests; Undo nur eigener Operationen (L11) | – |
| P5-02 | `sync`: WebSocket, Rechteprüfung beim Verbinden, Updates verteilen | nach P5-01 |
| P5-03 | Dauerhaft speichern (Write-Ahead) + Snapshots im `worker`; Speicherstatus = Server-Bestätigung (L05) | nach P5-02 |
| P5-04 | Presence: Cursor, Auswahl, Namen; Engine zeichnet fremde Cursor (Design-Gesetz §12) | nach P5-02 |
| P5-05 | Wiederverbinden + Offline-Zusammenführung | nach P5-03 |
| P5-06 | Lasttest 25 Clients, Neustart-Test | nach P5-05 |

**Abnahme Phase 5:** Lasttest p95 ≤ 150 ms; Server-Neustart verliert keine bestätigte Änderung;
zwei Browser offline ändern, wieder online → gleicher Stand.

### Phase 6 – Web-App zusammensetzen (4–6 Wochen)

**Ziel:** das Produkt in einem Stück.

| ID | Aufgabe | parallel |
| --- | --- | --- |
| P6-01 | `apps/web`-Gerüst: Layout, Navigation, Boards-Liste, Einstellungen, Sprachwahl; alle Daten über `sdk` | – |
| P6-02 | Board-Seite mit Engine; Werkzeugleiste (L00), Zoom-Steuerung, Kontextmenü (L12) | nach P6-01 |
| P6-03 | Panel überlagert die Leinwand (L04), Editor mit Platzhalter (L06), Titel im Panel (L09) | nach P6-02 |
| P6-04 | Sync in Board-Seite: Live-Cursor, Live-Änderungen, Speicherstatus (L05) | nach P6-02 |
| P6-05 | Vorlagen, Bibliothek, Suche | ja (ab P6-01) |
| P6-06 | e2e-Suite des Stacks: Login → Board → zu zweit bearbeiten → Reload | nach P6-04 |

**Abnahme Phase 6:** e2e-Hauptabläufe grün auf Vorschau-Umgebung; **alle** Einträge des
Abnahmekatalogs erfüllt, jeder mit Test oder Screenshot-Nachweis; `design-check` und
`language-check` grün über das ganze Repo; Tester-Skript (Abschnitt 21.4) „klappt“ in allen
Punkten.

### Phase 7 – Wechsel- und Mehrwert-Funktionen (4–6 Wochen)

| ID | Aufgabe | parallel |
| --- | --- | --- |
| P7-01 | Import aus verbreiteten Formaten (nach rechtlicher Prüfung) | ja |
| P7-02 | Export PDF/PNG/Markdown/JSON | ja |
| P7-03 | `ai`: Coach, Zusammenfassen, Suche (Regeln aus 4.12) | ja |
| P7-04 | Teilen-Links + Rollen im UI | ja |
| P7-05 | Kommentare auf Objekten | ja |

**Abnahme Phase 7:** 10 Beispiel-Boards importiert mit Abnahmeliste; JSON-Export verlustfrei;
Coach-Budget greift.

### Phase 8 – Härtung und Beta (4 Wochen)

| ID | Aufgabe |
| --- | --- |
| P8-01 | Umgebungen staging + production als Code, Backups + Wiederherstellungstest |
| P8-02 | Monitoring, Alarme, Runbooks |
| P8-03 | Datenschutzhinweis, Auftragsverarbeitungen, Konto-Löschung |
| P8-04 | Externer Sicherheits-Review, Befunde behoben |
| P8-05 | Touch-Bedienung (L15 Teil Touch), Englisch-Review, `en-XA` ohne Befund |
| P8-06 | Geschlossene Beta (10–30 Personen), Feedback-Schleife wöchentlich |

**Abnahme Phase 8:** alle Produktziele aus Abschnitt 1 gemessen erfüllt; keine offenen
Sicherheitsbefunde „hoch“; 2 Wochen Beta ohne Datenverlust.

### Phase 9 – Öffentliche Version v1

| ID | Aufgabe |
| --- | --- |
| P9-01 | Startseite, Preise [Entscheidung], Anmeldung offen |
| P9-02 | Abrechnung (falls bezahlt) – eigenes Paket `services/billing` |
| P9-03 | Support-Kanal, Status-Seite |
| P9-04 | Release `1.0.0` nach Release-Ablauf |

**Danach (eigene Pläne):** Integrationen mit verbreiteten Kommunikations-, Ticket- und
Dateidiensten, Admin-Konsole, SSO/SAML/SCIM, Desktop-/Mobile-Apps mit derselben Engine.

---

## 16. Fehler, die nicht passieren dürfen

Jede Zeile: **was passieren kann · Regel · wer es verhindert**. Die Regel allein reicht nie –
in der letzten Spalte steht, welches Werkzeug oder welche Prüfung den Fehler technisch
unmöglich oder sofort sichtbar macht.

| # | Was passieren kann | Regel | Durchsetzung |
| --- | --- | --- | --- |
| F1 | Mehrere Agenten arbeiten im selben Ordner; ihre Änderungen vermischen sich in denselben Dateien, niemand weiss mehr, was zu welcher Aufgabe gehört | jede Aufgabe in ihrem eigenen Worktree; nie im Hauptordner arbeiten | Polier: Worktree-Pflicht, Claim pro Aufgabe, Schreibschutz ausserhalb des Pfads; Stopp-Prüfung meldet fremde Änderungen |
| F2 | Zwei Testläufe nutzen denselben Port und dieselbe Datenbank; einer beendet den Server des anderen; Tests scheitern zufällig | jeder Arbeitsplatz hat eigene Ports und eine eigene Test-Datenbank; nie fremde Prozesse beenden | Polier-Slots (`.polier-slot`), exklusive Gates mit Sperre, Warnung bei `kill`/`pkill` |
| F3 | Infrastruktur-Fehler (Server weg, Port belegt) sehen aus wie wackelige Tests; Agenten wiederholen Läufe in einer Schleife | Infrastruktur-Fehler werden erkannt und getrennt gemeldet; nie „bis grün“ wiederholen | Polier-Gate-Ergebnis `infra`/`busy`/`timeout` zählt nie als Nachweis; Meldung „allein wiederholen“ |
| F4 | Ein Release nimmt uncommittete oder fremde, halbfertige Arbeit mit und bringt sie live | Release nur aus sauberem, gemergtem, getaggtem Stand – gebaut von der CI | Release-Befehl verweigert schmutzigen Arbeitsordner; Build nur aus Tag (Abschnitt 22.4) |
| F5 | Eine Umgebung (Vorschau, staging) hat nicht alle Konfigurationswerte; jede Seite zeigt einen Serverfehler | jede Umgebung hat eine Variablen-Liste; neue Variable im selben PR | Liste in `environments.md`, Smoke-Test nach jedem Deploy (13.2) |
| F6 | Tests hängen an inneren CSS-Klassen einer Bibliothek; ein Technikwechsel macht alle Tests kaputt | Tests nur über Rollen, `data-testid` und A11y-Spiegel | Lint-Regel gegen Bibliotheks-Klassen in Tests; Review |
| F7 | Anforderungen sind ungenau („soll sich sauber anfühlen“); Ergebnisse sind Geschmackssache | jeder Auftrag mit Soll-Werten in Zahlen und Abnahme-Checkboxen | Brief-Schablone (Abschnitt 8), Abnahmekatalog (21.2), Polier-Rubrik lehnt Adjektive ohne Werte ab |
| F8 | Farben, Abstände und Grössen werden pro Komponente erfunden; die App wirkt zusammengewürfelt | nur Tokens, nur das 4-px-Raster, alle Zustände | `design-check`, Token-Codegen für Web und Engine |
| F9 | Deutsche Texte stehen im Code; eine zweite Sprache erfordert einen Umbau | Code Englisch, sichtbarer Text nur aus Übersetzungsdateien | `language-check`, Pseudo-Sprache `en-XA` |
| F10 | Agenten ändern Dateien ausserhalb ihrer Aufgabe „nebenbei“ | erlaubte Pfade im Brief; Weiteres nur nach Rückfrage | Polier-Schreibschutz + Scope-Check in der CI |
| F11 | Das Planungswerkzeug im Projekt veraltet oder wird lokal verändert, ohne dass es jemand merkt | Updates nur zwischen Stufen, als eigener PR | Polier-Drift-Prüfung (`check.py`) |
| F12 | Grenzwerte (Wortbudgets, Leistungsbudgets) werden still angepasst, statt Probleme zu lösen | Budgets nur mit Begründung und Owner-Freigabe ändern | Polier-Budgets mit Pflichtfeld `reason`; Perf-Gate gegen gemessene Basis |
| F13 | Eine Änderung am Vertrag bricht andere Pakete, die erst später angepasst werden | Vertragsänderung + alle Abhängigen im selben PR, Versionssprung | Polier-Vertragsprüfung, Codegen-Test in der CI |
| F14 | Ein Changelog fehlt oder wird von mehreren Agenten gleichzeitig bearbeitet und kollidiert | ein Eintrag pro Aufgabe in `.changes/`; `CHANGELOG.md` schreibt nur der Release | Gate `changelog-entry` |
| F15 | Eine Funktion wird als „fertig“ gemeldet, obwohl Teile fehlen oder Abweichungen verschwiegen werden | jede Checkbox einzeln ✓/✗; Abweichung nur mit Owner-Freigabe | Review prüft Checkboxen gegen Nachweise; Katalog-Status `abgewichen + Freigabe` |

---

## 17. Frühwarnzeichen und Wochen-Check

Einmal pro Woche (Owner oder Lead, 15 Minuten). Jede Ja-Antwort bei „Warnzeichen“ ist ein
Anlass, sofort zu handeln.

| Warnzeichen | Was es meist bedeutet | Sofortmassnahme |
| --- | --- | --- |
| Ein Gate ist mehr als zweimal hintereinander rot, ohne Codeänderung | Infrastruktur-Konflikt oder wackeliger Test (F2, F3) | Läufe stoppen, allein wiederholen, Ursache als eigene Aufgabe |
| `git status` im Hauptordner zeigt Änderungen, die niemand zuordnen kann | jemand arbeitet ausserhalb seines Worktrees (F1) | Claims prüfen (`pl_status`), Arbeit in Worktree verschieben |
| Eine Aufgabe läuft länger als doppelt so lange wie geschätzt | Aufgabe zu gross oder unklar (F7) | teilen oder Brief schärfen |
| PRs ohne Screenshots bei UI-Änderungen | Design-Nachweis fehlt (F8) | PR zurück |
| Vorschau-Link im PR zeigt Fehlerseite | Konfiguration fehlt (F5) | Variablen-Liste prüfen, Smoke-Test ansehen |
| Leistungsmessung schlechter als Basis + 10 % | Regression | Ursache finden, bevor weitere Engine-Aufgaben starten |
| Mehr als 5 offene `open_questions` | Entscheidungsstau beim Owner | Entscheidungstermin |
| Changelog seit letzter Version leer, aber Commits vorhanden | Einträge fehlen (F14) | Gate prüfen |

**Wochen-Check (Checkliste):**

- [ ] `STATUS.md` aktuell, „Ready now“ plausibel
- [ ] keine verwaisten Worktrees, Slots oder Claims (`tools/slot.py list`, `claim.py list`)
- [ ] nächtliche Läufe (alle e2e, `en-XA`, Leistung, Backup-Restore) grün
- [ ] keine offenen Sicherheitswarnungen älter als 7 Tage
- [ ] Abnahmekatalog: Anzahl „erfüllt“ gestiegen
- [ ] offene Entscheidungen terminiert

---

## 18. Offene Entscheidungen (vor Phase 0)

1. Positionierung und Name des Produkts.
2. Grundentscheidungen aus Abschnitt 2 (jede Zeile).
3. Hosting-Anbieter und Land.
4. CRDT: Bibliothek hinter eigener Schnittstelle (Vorschlag) oder eigener Algorithmus.
5. Auth: selbst gebaut (Vorschlag) oder selbst gehosteter Open-Source-Server.
6. Referenz-Hardware für 60 fps.
7. Wer baut die Engine (Person mit C++/Grafik-Erfahrung oder Agenten mit enger Führung).
8. Import: welche Formate, nach rechtlicher Prüfung.
9. Bezahlmodell für v1 (kostenlos, Freemium, bezahlt).
10. Versionsschema: `0.0.1` + Buchstaben (Vorschlag) oder vierstellig (Abschnitt 22.1).
11. KI-Changelog-Workflow ja/nein (Abschnitt 22.6).
12. i18n-Bibliothek oder eigene dünne Schicht (Abschnitt 23.2).
13. ~~Deutsche Schreibweise~~ **entschieden 2026-10-25:** eine deutsche Sprachdatei mit `ss`
    statt `ß`, Sprachkennung `de-DE`; keine getrennte `de-CH`-Variante (Abschnitt 23.7).
14. Englisch zum Start sichtbar oder nur vorbereitet; wer weitere Sprachen übersetzt.
15. Kollisionsverhalten auf der Leinwand: nur klare Ebenen (Vorschlag) oder sanftes Ausweichen (L13).
16. Trackpad-Standard: zwei Finger verschieben, Pinch zoomt (Vorschlag) oder Scrollen zoomt (L15).

---

## 19. Zeitrahmen (Vollzeit-Personenwochen, grob)

| Phase | Wochen |
| --- | --- |
| 0 Fundament | 2–3 |
| 1 Vertrag | 2–3 |
| 2 Engine-Spike | 2–3 |
| 3 Backend-Kern | 4–6 (parallel zu 4) |
| 4 Engine-Kern | 6–8 |
| 5 Echtzeit | 5–7 |
| 6 Web-App | 4–6 |
| 7 Wechsel/Mehrwert | 4–6 |
| 8 Härtung + Beta | 4 |
| 9 v1 | 2 |
| **Summe** | **≈ 35–48 Wochen**, mit Parallelität von Phase 3/4 ≈ 31–42 |

Bei wenigen Stunden pro Woche entsprechend länger. Agenten beschleunigen vor allem Phasen 1,
3, 6 und 7, weniger die Engine (Phase 2, 4) und die Echtzeit (Phase 5).

---

## 20. Checkliste Tag 1

- [ ] Polier 1.0 Stufe 1 + 2 fertig (Voraussetzung P0-00)
- [ ] Abschnitt 18 durchgehen, Entscheidungen 1–3 treffen, Rest mit Frist versehen
- [ ] GitHub-Repo `project-air` (privat) anlegen, Branch-Schutz setzen
- [ ] Dieses Dokument als `docs/owner/canvas-suite-blueprint.md` ins neue Repo legen
- [ ] `board.json` mit Phase-0-Aufgaben P0-00 … P0-18 anlegen
- [ ] Briefs `tasks/P0-03.md` … `tasks/P0-18.md` nach Schablone aus Abschnitt 8 (Englisch)
- [ ] ersten Agenten auf P0-03 (Ordnerstruktur) ansetzen – im eigenen Worktree
- [ ] Abnahme Phase 0 terminieren (Ende Woche 3)

---

## 21. Design-Gesetz und Leinwand-Abnahmekatalog

Zwei Dokumente sind im Projekt **Gesetz**, nicht Inspiration:

| Datei | Rolle |
| --- | --- |
| `docs/design-rules.md` | **wie** alles aussieht und sich verhält – für Web-App und Engine gleich |
| `docs/canvas-acceptance.md` | **was** die Leinwand können muss, mit Soll-Werten und Abnahme |

Grundsatz: **Jeder Wert hat genau eine Quelle im Code** (`tokens.json` bzw. `contracts`), und
jede Abnahme-Checkbox hat einen Test oder einen Screenshot-Nachweis. Was nicht prüfbar ist, gilt
nicht als erfüllt. **MUSS** heisst muss, **NIE** heisst nie. Wer abweichen will, schreibt die
Frage in `open_questions` und baut nicht.

### 21.1 Design-Gesetz (Inhalt von `docs/design-rules.md`, P0-10)

**§0 Leitbild**

1. **Inhalt zuerst, Werkzeug leise.** Die Inhalte der Person sind das Hellste auf dem
   Bildschirm; Leisten, Rahmen und Knöpfe treten zurück.
2. **Ruhig statt bunt.** Dunkles Grün-Grau, ein Akzent, sonst Grautöne.
3. **Nichts springt.** Kein Element ändert Position, Grösse oder Text, ohne dass die Person es
   ausgelöst hat.

**§1 Arbeitsregeln:** einen Katalog-Eintrag pro Aufgabe; jede Checkbox einzeln belegen;
Screenshots vorher/nachher bei 1440×900 und 390×844 unter `reviews/evidence/<task>-before|after-*.png`;
keine neue Abhängigkeit, keine bestehenden Tests ändern, keine Dateien ausserhalb des Pfads; nie
raten; nie Platzhalter oder TODOs abliefern.

**§2 Farben – nur Tokens aus `tokens.json`** (Startwerte, dunkles Thema):

| Token | Zweck | Startwert |
| --- | --- | --- |
| `bg` | Seitenhintergrund | `#121412` |
| `canvas` | Leinwandfläche | `#151815` |
| `surface` | Panels, Leisten, Menüs | `#1a1d1a` |
| `card` | Karten und Blöcke | `#202420` |
| `fg` | Haupttext | weiss 92 % |
| `muted` | Nebentext, inaktive Icons | weiss 66 % |
| `faint` | Hover-Fläche auf Icon-Knöpfen | weiss 12 % |
| `border` | Trennlinien, Ruhe-Rahmen | weiss 8 % |
| `border-strong` | Hover-Rahmen, Eingabefelder | weiss 16 % |
| `accent` | Auswahl, Fokus, aktive Werkzeuge | `#8fbfaf` (Salbei) |
| `accent-soft` / `accent-line` | Auswahlring / Akzentlinie | Akzent 14 % / 40 % |
| `danger` | Fehler | `#f0a8a0` |
| `tone-a … tone-e` | Zonen, Paletten, Kanten, Personenfarben | Salbei, Sand, Flieder, Himmel, Terrakotta |

- **NIE** Hex-/`rgb()`-Werte ausserhalb von `tokens.json`. Fehlt ein Ton: Frage, kein neuer Wert.
- Pro Bildschirm höchstens **ein** gefüllter Akzent-Knopf (die Hauptaktion).

**§3 Abstände, Grössen, Radien**

- Raster **4 px**; erlaubte Abstände `4, 8, 12, 16, 24, 32, 48`. Leinwand-Raster **16 px**.
- Klickziele ≥ **32 × 32 px** (Maus), ≥ **44 × 44 px** bei grober Zeigereingabe.

| Element | Radius | Rahmen | Schatten |
| --- | --- | --- | --- |
| Notizkarte | 14 | 1 px `border-strong` | `card-shadow` |
| Block / Zone | 20 | 1 px `border-strong` | `card-shadow` |
| Icon-Knopf, Eingabefeld, Menüeintrag | 10 | – / 1 px `border-strong` | – |
| Leiste, Menü / Tooltip | 14 / 6 | 1 px `border` | `card-shadow` |
| Text-Knopf ausserhalb der Leinwand | Pille | 1 px `border-strong` | – |

- **NIE** Pillen-Knöpfe innerhalb von Karten oder Blöcken. **NIE** andere Schatten als
  `card-shadow` und `shadow`.

**§4 Schrift**

| Rolle | Schrift | Grösse | Gewicht | Farbe |
| --- | --- | --- | --- | --- |
| Board-Titel, Panel-Titel, Leerzustand | Serif | 28 / 24 / 22 px | 400 | `fg` |
| Karten-/Block-Titel | Sans | 15 px | 600 | `fg` |
| Fliesstext in Karten/Blöcken | Sans | 13 px, Zeilenhöhe 1.4 | 400 | `fg` |
| Typ-Label | Sans | 11 px, Versalien, +0.1em | 600 | `accent` |
| Status, Hinweise | Sans | 12 px | 400 | `muted` |
| Tooltip | Sans | 12 px | 500 | `fg` |

- **NIE** Text unter 11 px; **NIE** mehr als zwei Gewichte in einer Karte.
- Lange Titel einzeilig mit Ellipse, voller Titel im Tooltip. **NIE** abgeschnittener Text ohne
  Ellipse.

**§5 Icons:** nur aus `packages/ui-kit/icons/` (eigene SVGs, 24er Raster, Strich 1.6,
`currentColor`, runde Enden). 20 px in 36-px-Knopf (Leiste), 16 px in 28-px-Knopf (in Karten).
**NIE** Emoji oder Zeichen (`×`, `✓`, `→`) als Icon, keine Icon-Bibliotheken. Icon-Knöpfe haben
`aria-label` (übersetzt) und eigenen Tooltip; **nie** das native `title`. Die Engine nutzt
dieselben SVGs als Textur-Atlas.

**§6 Zustände – jedes interaktive Element hat alle** (gilt auch für Objekte, die die Engine
zeichnet):

| Zustand | Aussehen |
| --- | --- |
| Ruhe | wie oben |
| Hover | Fläche `faint` oder Rahmen `border-strong`; Icon `muted` → `fg` |
| Gedrückt | wie Hover + `scale(0.97)` |
| Fokus (Tastatur) | Outline 2 px `accent`, Abstand 2 px – **nie** entfernen |
| Ausgewählt | Rahmen 1.5 px `accent`, äusserer Ring 3 px `accent-soft` |
| Wird gezogen | Schatten `shadow`, Cursor „grabbing“, volle Deckkraft |
| Deaktiviert | Deckkraft 0.4, kein Hover |
| Speichert / Gespeichert / Fehler | 12 px `muted` „Speichert …“ → „Gespeichert“ (blendet nach 2 s aus) → `danger`, bleibt stehen, Eingabe bleibt |

- Bedienelemente **in** Karten und Blöcken (Löschen, „Punkt hinzufügen“) sind in Ruhe
  unsichtbar und erscheinen bei Hover, Fokus innerhalb oder Auswahl; per Tastatur erreichbar;
  auf Touch bei Auswahl sichtbar.
- Statusplätze haben eine feste Höhe – nichts verschiebt sich.

**§7 Bewegung:** Hover/Farbe 120 ms; Ein-/Ausblenden 150 ms; Panel 180 ms ease-out, nur
`transform` und `opacity`; Tooltip nach 300 ms, sofort bei Tastaturfokus. **NIE** Bounce,
Federn, animierte Zahlen; **nie** Layout-Eigenschaften animieren. Bei
`prefers-reduced-motion: reduce` alles auf 0 ms.

**§8 Ebenen (unten → oben)** – zugleich Render-Reihenfolge der Engine und z-Ordnung des DOM:
1 Hintergrund-Raster · 2 Zonen · 3 Kanten · 4 Blöcke · 5 Notizkarten · 6 gezogenes/ausgewähltes
Element (oben in seiner Ebene) · 7 Einrastlinien, Auswahlrahmen · 7a fremde Cursor · 8
Leinwand-Chrome (Werkzeugleiste, Zoom) · 9 Seitenpanel · 10 Kontextmenü, Tooltip · 11 Dialoge,
Hinweise. **NIE** `z-index` > 10 ohne Eintrag in `ui-kit/layers.ts`.

**§9 Leinwand-Chrome – fester Ort**

| Element | Ort | Abstand |
| --- | --- | --- |
| Werkzeugleiste (Icons, DOM) | oben Mitte, schwebend | 12 px |
| Zoom-Steuerung | unten links, schwebend | 12 px |
| Speicher-/Fehlerhinweis | unten Mitte, schwebend | 12 px |
| Seitenpanel | rechts, **überlagert** die Leinwand, 400 px | 12 px |

**NIE** weitere schwebende Elemente oder Knopfreihen über der Leinwand. „Alles anzeigen“ hält
oben ≥ 64 px frei. Zoom-Steuerung immer vollständig sichtbar.

**§10 Texte:** nur aus Übersetzungsdateien (Abschnitt 23). Deutsch: Du-Form, Knopf ≤ 2 Wörter,
Tooltip ≤ 3 Wörter, Fehlermeldung ≤ 1 Satz + was zu tun ist; **nie** Ausrufezeichen, „Ups“ oder
Fachbegriffe; ein Begriff pro Sache (Glossar).

**§11 Abnahme jeder UI-Aufgabe:** keine Farbwerte ausserhalb der Tokens · alle Abstände aus der
4-px-Reihe · alle Zustände vorhanden und per Tastatur erreichbar · kein abgeschnittener Text, nichts
unter 11 px · nichts springt bei Hover, Speichern, Öffnen, Schliessen · bei 390 px Breite nichts
horizontal herausragend · Screenshots vorher/nachher vorhanden.

**§12 Echtzeit:** fremde Cursor 16 px mit Namensschild 12 px auf Fläche in Personenfarbe
(`tone-*`); nach 5 s Inaktivität Deckkraft 0.4; Auswahl anderer Personen: Rahmen 1.5 px in deren
Farbe, ohne Ring.

**§13 Engine:** keine Design-Zahlen im C++-Code ausser aus `tokens.h` (generiert). Radien,
Rahmen, Schatten, Schwellen (4 px Ziehen, 6 px Einrasten, 16 px Raster, 40 px Kopfzeile) sind
Tokens.

**§14 i18n im Layout:** Layout verträgt +40 % Textlänge; nur logische CSS-Richtungen
(`margin-inline-start` …); die Engine zeigt keine eigenen Texte ausser Objektinhalten.

### 21.2 Leinwand-Abnahmekatalog (Inhalt von `docs/canvas-acceptance.md`, P0-11)

Jeder Eintrag hat: **Ziel · Soll-Werte · Zustände · Nicht tun · Abnahme · Paket/Phase ·
Nachweis · Status** (`offen | erfüllt | abgewichen + Owner-Freigabe`). Ein Eintrag ist erst
vergeben, wenn alle Felder ausgefüllt sind. **Zu grob** (verboten): „Ziehen verbessern“.
**Richtig:** „Nach dem Loslassen sind `x` und `y` Vielfache von 16; mit `Shift` nicht.“

| ID | Thema | Soll-Werte (Kern) | Abnahme (Kern) | Paket · Phase | Nachweis |
| --- | --- | --- | --- | --- | --- |
| L00 | Werkzeugleiste | Icon-Leiste oben Mitte in der Leinwand; Knöpfe 36 px, Icons 20 px; Gruppen mit Trennstrich; Hauptaktion als einziger Akzent; Tooltip nach 300 ms | alle Werkzeuge per Maus und Tastatur erreichbar; Tooltip sichtbar; keine Knopfreihe ausserhalb der Leinwand | web · P6-02 | e2e + Screenshot |
| L01 | Leistungs-Basis und -Beweis | Basis in Phase 2 messen; danach nach jeder Engine-Phase; 10.000 Objekte, 60 fps, keine Long Task > 16 ms bei Pan/Zoom | Messwerte im Katalog eingetragen; jede Messung ≤ Basis + 10 % | engine, perf · P2-03, P4, P5-06, P8 | Perf-Gate |
| L02 | Sichtbare Qualität | Titel einzeilig mit Ellipse; Kopfzeile 40 px; Löschknopf 28 px, in Ruhe unsichtbar; keine inneren Scrollleisten in Blöcken (Blöcke wachsen in der Höhe); Spalten min. 176 px, Einträge umbrechen; Inhalt einer Zone beginnt unter ihrer Kopfzeile; Einpassen lässt oben ≥ 64 px frei | Tab erreicht jeden Löschknopf und macht ihn sichtbar; Beispiel-Board ohne abgeschnittenen Text und ohne innere Scrollleisten | engine, web · P4-02, P4-03, P6-02 | Bildvergleich + e2e |
| L03 | Ziehen vs. Bearbeiten | Drag-Schwelle 4 px; Karten: ganze Fläche ist Griff; Blöcke/Zonen: nur Kopfzeile 40 px; Felder nie ziehbar; Hover Kopfzeile `faint` 120 ms | Text in einem Feld markieren bewegt nichts; Ziehen an Kopfzeile bewegt; Klick ohne Bewegung > 4 px erzeugt keine Operation; Ziehen im Blockinneren bewegt nichts | engine · P4-04, P4-08 | C++-Unit + e2e |
| L04 | Panel ohne Sprung | Panel 400 px rechts, überlagert, 12 px Abstand; Ein-/Ausblenden 180 ms (`translateX(16px)` + Deckkraft); Leinwandbreite ändert sich nie; liegt die gewählte Karte unter dem Panel, Kamera 300 ms so weit, dass sie 24 px links vom Panel steht | sichtbare Karten bewegen sich beim Öffnen/Schliessen um 0 px; `Esc` schliesst | web · P6-03 | e2e (Positionen vorher/nachher) |
| L05 | Speichern mit Status | Status „Speichert …“ → „Gespeichert“ (2 s) → „Nicht gespeichert – erneut versuchen“ (klickbar); „Gespeichert“ = Server-Bestätigung; Offline-Änderungen in Warteschlange; nichts geht beim Schliessen/Navigieren verloren; Fokus und Cursor bleiben | Tippen ohne Fokuswechsel → bestätigt ≤ 500 ms; Reload zeigt Wert; Netz aus → Hinweis, Eingabe bleibt, nach Wiederverbinden gespeichert | web, sdk, sync · P5-03, P6-04 | Integration + e2e |
| L06 | Leere Notiz | Fokus beim Öffnen, Platzhalter „Schreib los …“ (`muted`, 15 px), verschwindet beim ersten Zeichen; Platzhalter nie gespeichert | Platzhalter sichtbar + Fokus; erstes Zeichen blendet aus; Reload speichert keinen Platzhaltertext | editor · P6-03 | e2e |
| L07 | Einrasten | Raster 16 px; Einrastlinien an Kanten und Mitten von Nachbarn und Zonen, Toleranz 6 px (Bildschirm); Linie 1 px `accent`; Linie vor Raster; max. 3 Linien; **Einrasten live während des Ziehens**; `Shift` = frei | nach Loslassen `x`/`y` Vielfache von 16; mit `Shift` frei; Linie sichtbar, solange eingerastet; Messung ≤ Basis + 10 % | engine · P4-04 | C++-Unit + e2e |
| L08 | Zonen als Container | Ablegen mit Mittelpunkt in Zone = Zugehörigkeit (gespeichert); Zone 1 s mit `accent-line` hervorgehoben; Herausziehen löst; Zone ziehen bewegt Inhalt in einer Operation; Löschen fragt „Inhalt behalten“ (Standard) / „mitlöschen“; Verkleinern nie kleiner als Inhalt + 16 px; keine verschachtelten Zonen in v1 | Zugehörigkeit übersteht Reload; Zone ziehen = eine Operation; Löschen fragt nach | contracts, engine, platform · P1-01, P3-01, P4-04 | Vertrags-Fixtures + e2e |
| L09 | Titel im Panel | Titel als Eingabefeld (Serif 24 px, Unterlinie bei Hover/Fokus); gleiche Validierung wie überall; `Enter` springt in den Editor | Titel ändern → Karte und Bibliothek aktuell; leer/zu lang → Fehler, nichts gespeichert | web · P6-03 | e2e |
| L10 | Mehrfachauswahl | `Shift`-Klick fügt hinzu/entfernt; Rahmenauswahl mit `Shift` auf leerer Fläche (Rahmen 1 px `accent`, Fläche `accent-soft`); Leiste „n ausgewählt“ + Löschen; gemeinsames Ziehen = eine Operation; `Esc` hebt auf | drei Karten ziehen = genau eine Operation; Auswahl bleibt nach dem Ziehen; `Esc` hebt auf | engine, contracts · P4-04, P1-02 | C++-Unit + e2e |
| L11 | Undo/Redo | 20 Schritte pro Sitzung; `Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`; Hinweis „Rückgängig: …“ 3 s unten Mitte; im Feld gehört `Cmd/Ctrl+Z` dem Feld; **mit Echtzeit nur eigene Operationen** | 20 Schritte zurück; ein Undo = genau eine Gegenoperation; Löschen rückgängig stellt wieder her; Undo von A ändert nichts an Änderungen von B | contracts, engine, crdt · P1-02, P4-05, P5-01 | Unit + e2e zu zweit |
| L12 | Tastatur und Kontextmenü | `Cmd/Ctrl+D` duplizieren (+16/+16); `Entf`/`Backspace` löschen; `Esc` schliessen; Pfeile 16 px, `Shift` 160 px (eine Operation 300 ms nach letzter Taste); Rechtsklick-Menü 200 px, Einträge 32 px (Öffnen, Duplizieren, Nach vorne, Nach hinten, Löschen), Kürzel rechts in `muted`; Kürzel nie in Feldern | Duplizieren/Löschen per Tastatur; Pfeile landen auf Raster; Kürzel im Feld wirkungslos; Menü per Tastatur bedienbar | engine, web · P4-04, P6-02 | e2e |
| L13 | Ebenen | Reihenfolge nach §8; zuletzt bewegtes Element oben in seiner Ebene (gespeichert als Bruch-Index); Kollision nach Entscheidung 15 | Notizkarte immer über Blöcken; zuletzt bewegtes Element nach Reload oben | engine, contracts · P4-02, P1-01 | Bildvergleich + e2e |
| L14 | Grösse ändern | Griffe 8 px `accent` bei Auswahl; Grösse rastet auf 16 px (`Shift` frei); Mindestgrössen: Notiz 176×80, Checkliste 224×128, Tabelle 288×160, Zone 256×192, Spalten 368×192, Zeitstrahl 320×160, Palette 224×128 | Masse Vielfache von 16; Mindestgrösse greift; eine Geste = eine Operation; übersteht Reload | engine, contracts · P4-04, P1-01 | C++-Unit + e2e |
| L15 | Trackpad und Touch | zwei Finger verschieben, Pinch zoomt um die Fingermitte, `Cmd/Ctrl`+Rad zoomt (Entscheidung 16); Touch: ein Finger auf Objekt zieht es, auf leerer Fläche verschiebt er die Ansicht | Zwei-Finger-Wischen ohne Zoom; Pinch um Fingermitte; Touch-Ziehen bewegt nicht die Ansicht | engine · P4-04 (Desktop), P8-05 (Touch) | e2e + manuell |
| L16 | Auto-Pan | Ansicht scrollt mit, wenn ein Objekt an den Rand gezogen wird (Randzone 48 px) | Objekt lässt sich über den sichtbaren Bereich hinaus ziehen | engine · P4-04 | e2e |
| L17 | Ansicht merken | Zoom und Position pro Board und Gerät gespeichert; ohne Eintrag „Alles anzeigen“ | Reload zeigt denselben Ausschnitt; neues Board startet eingepasst | engine, web · P4-01, P6-02 | e2e |
| L18 | Inline-Komfort | Checkliste/Spalten/Tabelle: `Enter` neuer Eintrag mit Fokus; `Tab`/`Shift+Tab` nächstes/vorheriges Feld; `Backspace` im leeren Eintrag löscht, Fokus auf vorherigen; Farbwähler als 24-px-Farbfeld | drei Punkte nur mit Tastatur anlegen; leeren Punkt mit `Backspace` löschen | engine (Overlay), web · P4-08, P6-02 | e2e |
| L19 | Canvas-Feel | „Alles anzeigen“ zoomt höchstens auf 100 %; Punktraster blendet unter Zoom 0,5 aus; nur zeichnen bei Änderung | Einpassen bei einer Karte ≤ 100 %; im Ruhezustand keine Frames | engine · P4-02 | Bildvergleich + Perf |
| L20 | Platzierung neuer Objekte | Mitte der Ansicht, auf Raster; belegt → je 32 px nach rechts unten (max. 10 Versuche) | fünfmal „Notiz hinzufügen“ = fünf sichtbare, nicht überlappende Karten | engine, contracts · P4-04 | Unit + e2e |

**Regel für Phasen-Gates:** Phase 4 bzw. 6 ist erst grün, wenn alle Einträge mit dieser Phase
auf „erfüllt“ stehen, jeweils mit Pfad zum Nachweis.

### 21.3 Automatische Prüfung: `tools/design-check` (P0-13)

Eigenes Node-Skript, CI-Gate `design-check` bei Änderungen unter `apps/`, `packages/ui-kit/`,
`packages/editor/`, `packages/engine/src/render/`.

| Regel | Prüfung | Fehler wenn |
| --- | --- | --- |
| §2 nur Tokens | CSS, CSS-Module, TSX-Styles, C++-Render-Code | Hex, `rgb(`/`rgba(`/`hsl(` ausserhalb von `tokens.json` |
| §3 4-px-Raster | `margin`, `padding`, `gap`, Positionen, Grössen | Wert nicht in {0, 4, 8, 12, 16, 24, 32, 48} bzw. kein Token |
| §3 Klickziele | Knöpfe mit Grössenangabe | < 32 px (bzw. < 44 px bei grober Zeigereingabe) |
| §3 Schatten | `box-shadow` | nicht `card-shadow` / `shadow` |
| §4 Schrift | `font-size`, `font-weight` | < 11 px; mehr als zwei Gewichte in einer Komponente (Warnung) |
| §5 Icons | Text in Knöpfen | `×`, `✓`, Pfeile, Emoji; `title=` auf Knöpfen; Icon-Knopf ohne `aria-label` oder Tooltip |
| §7 Bewegung | `transition`, `animation` | Dauer nicht in {120, 150, 180, 300} ms; animiertes Layout; keine `prefers-reduced-motion`-Regel |
| §8 Ebenen | `z-index` | > 10 ohne Eintrag in `layers.ts` |
| §13 Engine | C++ unter `render/`, `gesture/` | Zahl-Literale für geprüfte Design-Namen statt `tokens::…` |
| §14 Richtung | CSS der App | `margin-left/right`, `padding-left/right`, `left/right`, `text-align: left/right` |
| §11 Nachweis | PR mit UI-Pfaden | fehlende Screenshots vorher/nachher |

Ergänzend als Tests: Bildvergleich fester Szenen (Engine, beide Backends) und Seiten (1440×900,
390×844) – Referenzbilder ändern nur mit Owner-Freigabe; Zustands-Tests im `ui-kit`;
„Nichts springt“-Test (Positionen von drei Karten vor/nach Panel, Speichern, Hover: 0 px).

### 21.4 Ablauf für eine UI-Aufgabe und Tester-Skript

1. Brief nennt den Katalog-Eintrag (z. B. „L03“) und übernimmt Soll-Werte und Checkboxen
   wörtlich.
2. Screenshots vorher → bauen → Screenshots nachher.
3. Gates: `lint`, `typecheck`, `unit`, `design-check`, `language-check`, betroffene `e2e`
   (exklusiv); Engine zusätzlich `cpp-unit`, `visual`.
4. Ergebnis listet jede Checkbox und §11 einzeln (✓/✗).
5. Review prüft gegen Soll-Werte, nicht nach Geschmack.
6. Nach dem Merge: Katalog-Status „erfüllt“ mit Nachweis-Pfad.

**Tester-Skript** (nach jedem Paket der Phasen 4–6, je „klappt / hakt“ + ein Satz):

1. Neue Notiz anlegen, Titel im Panel ändern, Text schreiben.
2. Notiz in eine Zone ziehen und die Zone samt Notiz verschieben.
3. Checklisten-Punkt abhaken und umbenennen, ohne den Block zu verschieben.
4. Drei Karten auswählen, gemeinsam verschieben, rückgängig machen.
5. Reload: alles steht und heisst wie vorher, die Ansicht ist dieselbe.
6. (ab Phase 5) Zu zweit: beide bewegen Karten, beide sehen den Cursor des anderen, Undo nimmt
   nur eigene Schritte zurück.

---

## 22. Releases, Updates und Changelog – Bedienungsanleitung

Dieser Abschnitt wird im Repo 1:1 zu `RELEASING.md` (P0-17).

### 22.0 Grundsätze

- **Das Monorepo ist das GitHub-Repo** (privat). Es gibt keinen Export- oder Kopier-Ordner.
- **Der Release-Befehl erstellt nur den Release-PR**; Tag, Build, Tests und Ausrollen macht die
  CI. Nur committete, gemergte, geprüfte Arbeit kann live gehen.
- **Vorschau pro Pull Request** automatisch, plus benannte Vorschau-Stände.
- **Ein Änderungs-Eintrag pro Aufgabe** in `.changes/`; `CHANGELOG.md` schreibt nur der Release –
  so kollidieren parallele Aufgaben nie.

### 22.1 Versionen – ab `0.0.1` **[Entscheidung]**

**Vorschlag:** SemVer mit drei Zahlen, Start **`0.0.1`**, plus Buchstaben für kleine
Zwischenschritte.

- Paketmanager, Git-Tags und Container-Werkzeuge verstehen nur drei Zahlen
  (`MAJOR.MINOR.PATCH`). Vierstellig (`0.0.0.1`) ist in `package.json` ungültig.
- „Ganz klein anfangen“: `0.0.1` ist die allererste Version. Zwischenschritte sind
  Buchstaben-Einträge (`0.0.1a`, `0.0.1b` …), die nie veröffentlicht werden.
- Alternative (nicht empfohlen): vierstellig nur als Anzeige und Git-Tag, intern dreistellig –
  zwei Zählweisen führen zu Verwechslungen.

| Schritt | Wann | Beispiel |
| --- | --- | --- |
| Buchstabe | kleine Änderung – nicht veröffentlicht | `0.0.1a` |
| `patch` | kleines Release | `0.0.1` → `0.0.2` |
| `minor` | Phase abgeschlossen oder grössere Funktion | `0.0.9` → `0.1.0` |
| `major` | erste öffentliche Version, danach Brüche | `0.9.x` → `1.0.0` |

Phasen-Zuordnung: Phase 0 → `0.0.x`, Phase 1 → `0.1.x` … Phase 8 → `0.9.x`, Phase 9 → `1.0.0`.
**Eine Version für das ganze Produkt** bis v1; Einträge tragen einen Bereich (`web`, `engine`,
`sync`, `platform`, `auth`, `media`, `ai`, `contracts`, `infra`).

### 22.2 Einmalig: GitHub und CI verbinden

1. Repository `github.com/<owner>/project-air` (**privat**); Branch-Schutz `main`: nur PR,
   grüne CI, 1 Review, keine Force-Pushes.
2. Einmal verbinden und das Gerüst als `0.0.1` veröffentlichen:
   ```bash
   git remote add origin https://github.com/<owner>/project-air.git
   git push -u origin main
   npm run release -- patch "Projektgerüst"
   ```
3. In GitHub (nur Owner): Umgebungen `preview`, `staging`, `production` mit ihren Geheimnissen
   (Liste in `docs/runbooks/environments.md`); `production` mit Pflicht-Freigabe.
4. Hosting mit der CI verbinden [Entscheidung Hosting]; Deployments nur aus der CI.

Danach nie wieder nötig.

### 22.3 Changelog – Regeln

**Grundsatz:** Jede **Code**-Änderung bekommt sofort einen Eintrag. Fragen, Doku, Planung und
Changelog-Pflege nicht. Einträge auf **Englisch**, Release-Titel auf **Deutsch** (Owner).

```bash
npm run change -- web patch "Panel overlays the canvas instead of shrinking it"
```

- schreibt `.changes/<task-id>-<kurzname>.md` (Bereich, Art, Text);
- Agenten bearbeiten `CHANGELOG.md` **nie** direkt;
- Gate `changelog-entry` lehnt PRs ab, die Code unter `apps/`, `packages/`, `services/`,
  `tools/`, `infra/` ändern, aber keinen Eintrag haben (Ausnahme: Label `no-changelog`, Owner).

**Beim Release:** Einträge einsammeln → Version bestimmen (höchste Art gewinnt oder Vorgabe des
Owners) → neuer Abschnitt oben in `CHANGELOG.md`, gruppiert nach Bereich → Einträge löschen –
alles im Release-PR.

**Buchstaben-Einträge:** Nach jedem Merge auf `main` ergänzt die CI unter dem aktuellen
Abschnitt „Seit `0.0.3`: `0.0.3a` …, `0.0.3b` …“. `package.json` ändert sich dabei nicht.

```markdown
# Changelog

## 0.0.2 – 2027-01-14 · Werkzeugleiste und Ports

### web
- Canvas toolbar is a floating icon bar inside the canvas (0.0.1a)

### infra
- Port slots per worktree (0.0.1b)

## 0.0.1 – 2027-01-10 · Projektgerüst
- Initial monorepo scaffold
```

### 22.4 Release-Ablauf – der eine Befehl

**„Auf GitHub updaten / hochladen / veröffentlichen“ heisst immer:**

```bash
npm run release -- patch|minor|major "<kurz, was sich geändert hat, auf Deutsch>"
```

Der Befehl (nur Owner, nie Agenten):

1. prüft: auf `main`, Arbeitsordner **sauber**, lokal = `origin/main`, CI auf dem letzten Commit
   grün (Polier `release_check.py`). Sonst Abbruch mit Grund.
2. erstellt den **Release-PR** `release/vX.Y.Z` (Version, eingesammelte Einträge, Titel).
3. Nach Merge setzt die CI den Tag `vX.Y.Z`.
4. CI baut **aus dem Tag** alle Container + `engine.wasm`, testet, rollt nach **staging** aus,
   Smoke-Tests.
5. Owner gibt `production` frei → Migrationen → Ausrollen → Smoke-Tests → GitHub-Release mit
   Changelog-Abschnitt.

**Vorschau:** automatisch pro PR; benannt mit `npm run release -- preview "<was getestet
werden soll>"` (Tag `preview-<datum>-<kurz>`, kein Versionssprung, Live unberührt, immer
Vorschau-Datenbank). Nach jedem Vorschau-Deploy Smoke-Test.

**Testlauf:** `npm run release -- --dry` zeigt Version, Einträge und Prüfergebnisse, ändert nichts.

| Problem | Was tun |
| --- | --- |
| „Arbeitsordner nicht sauber“ | committen oder verwerfen, nie mit `--force` umgehen |
| CI rot nach Tag | nichts ist live; Fix als PR, dann neues `patch`-Release |
| staging ok, production-Smoke-Test rot | automatischer Rückweg auf den vorherigen Tag; Ursache als PR |
| nur der Push des Release-PR scheiterte | `git push -u origin release/vX.Y.Z` erneut, **nicht** neu releasen |
| falscher Text im Changelog | Korrektur als PR mit Label `no-changelog`; Tag bleibt |

### 22.5 Updates – Abhängigkeiten, Werkzeuge, Polier

- **Abhängigkeiten:** automatische, wöchentlich gebündelte Update-PRs pro Bereich (eingebaute
  Funktion des Repo-Hosts, keine neue Abhängigkeit). Jeder Update-PR durchläuft dieselbe CI;
  Major-Updates nur mit Owner-Freigabe und Eintrag in `docs/versions.md`.
- **Sicherheitsupdates:** Vorrang; Fix innerhalb von 7 Tagen, kritisch innerhalb von 48 h.
- **Polier:** `generator_version` in `board.json`; Update nur **zwischen Stufen**: Changelog
  lesen, Migration ausführen, `check.py` grün, eigener PR mit Eintrag (Bereich `infra`).
- **Laufzeiten und Toolchains** (Node.js, PostgreSQL, C++-Toolchain): Versionssprünge als eigene
  Aufgabe mit Brief und Gates.

### 22.6 Optional: KI-geschriebene Release-Notes **[Entscheidung]**

Ein CI-Workflow kann aus Commits und Einträgen einen lesbaren Text schreiben und als PR
vorschlagen. Beispiel-Vorlage des Owners (auf `main` angepasst):

```yaml
name: AI Changelog

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: write
  models: read
  pull-requests: write

jobs:
  changelog:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Generate changelog and open PR
        uses: decoded-cipher/auto-changelog@v1   # vor Einsatz prüfen und auf Commit-SHA pinnen
        with:
          output_path: CHANGELOG.md
          create_pr: true
          changelog_branch: auto/changelog
          base_branch: main
```

**Einsatz:**

- **Zusatz, kein Ersatz** für `.changes/`: die KI schreibt eine lesbare Zusammenfassung
  (z. B. deutsche Release-Notes für Tester), nicht die verbindliche Liste.
- Ziel-Datei `RELEASE-NOTES.md` oder Text des GitHub-Release – **nicht** `CHANGELOG.md`, sonst
  überschreiben sich Release-Befehl und Workflow.
- Auslöser beim Release-PR (`release/*`), nicht bei jedem Push.
- Fremde Actions auf **Commit-SHA pinnen**, Quelltext vorher ansehen, Rechte minimal; die
  Verarbeitung der Commit-Inhalte durch einen KI-Dienst im Datenschutzhinweis aufführen; Lizenz
  prüfen.
- Funktion nicht geprüft [UNVERIFIED]; P0-16 testet sie zuerst in einem Test-Repo.

### 22.7 Nur falls ein Teil öffentlich wird

Soll z. B. die Engine Open Source werden: eigener Workflow, der **aus einem Tag** nur
`packages/engine/` (+ Lizenz, eigenes README) in ein öffentliches Repo spiegelt; vorher Scan auf
Geheimnisse und interne Verweise. Nie von Hand kopieren.

### 22.8 Regeln für alle (Menschen und Agenten)

- „Auf GitHub updaten / hochladen / veröffentlichen“ heisst **immer** `npm run release …`
  (Owner). Nichts von Hand kopieren, keine ZIP, kein direkter Push auf `main`, kein Force-Push.
- **Agenten veröffentlichen nie.** Sie öffnen Pull Requests.
- Jede **Code**-Änderung bekommt **sofort** einen Eintrag: `npm run change -- <bereich> <art>
  "<English summary>"`. Fragen, Doku, Planung nicht.
- `CHANGELOG.md` schreibt nur der Release bzw. die CI.
- Releases nur aus sauberem, gemergtem Stand – der Befehl verweigert alles andere.
- Neue Umgebungsvariable = Eintrag in `docs/runbooks/environments.md` im selben PR.
- Scheitert nur das Hochladen: Push wiederholen, **nicht** neu releasen.
- Updates von Abhängigkeiten und Polier nur über PRs und zwischen Aufgaben.

---

## 23. Sprache und Übersetzung – Code Englisch, Webseite Deutsch, übersetzbar

**Grundsatz:** Alles, was Entwickler und Agenten lesen und schreiben, ist **Englisch**. Alles,
was Nutzer sehen, kommt aus **Übersetzungsdateien**; Deutsch ist die Startsprache, jede weitere
Sprache ist nur eine weitere Datei – ohne Code zu ändern.

### 23.1 Was ist Englisch, was Deutsch

| Bereich | Sprache | Beispiele |
| --- | --- | --- |
| Namen von Variablen, Funktionen, Klassen, Dateien, Ordnern | **Englisch** | `moveCards()`, `board-panel.tsx` |
| Kommentare, Docstrings | **Englisch** | `// Keep the viewport width stable while the panel opens.` |
| Datenbank: Tabellen, Spalten, Enums, Migrationsnamen | **Englisch** | `board_objects.parent_id` |
| Vertrag, API-Felder, Fehlercodes, Ereignisnamen | **Englisch** | `"op": "move"`, `ERR_BOARD_NOT_FOUND` |
| Logs, Metriken, interne Fehlermeldungen | **Englisch** | `sync: client reconnected after 3 attempts` |
| Tests: Namen, Beschreibungen, Fixtures | **Englisch** | `test("dragging a zone carries its notes")` |
| Commits, Branches, PR-Titel, Changelog-Einträge | **Englisch** | `P4-04: Add snap guides` |
| `AGENTS.md`, `ARCHITECTURE.md`, Briefs, Reviews, ADRs, technische Doku | **Englisch** | – |
| Owner-Dokumente (`docs/owner/`, Datenschutzhinweis, Release-Titel) | Deutsch erlaubt | – |
| **Alles, was Nutzer sehen** (Knöpfe, Menüs, Fehlermeldungen, Leerzustände, E-Mails, Vorlagen-Texte, Coach-Antworten, `aria-label`, Tooltips, Seitentitel) | **aus Übersetzungsdateien**, Start **Deutsch** | `t("canvas.toolbar.addNote")` → „Notiz hinzufügen“ |
| Inhalte der Nutzer (Notizen, Board-Namen) | wie geschrieben, nie übersetzt | – |

Ein deutscher Text im Code ist **immer** ein Fehler – er gehört als Schlüssel in
`messages/de.json`.

### 23.2 Aufbau der Übersetzung

```text
apps/web/messages/
├─ de.json          # Startsprache, vollständig
├─ en.json          # zweite Sprache, immer gleiche Schlüssel wie de.json
├─ en-XA.json       # Pseudo-Sprache, automatisch erzeugt (nur Tests)
└─ README.md        # Regeln für Schlüssel und Übersetzer
services/auth/messages/<locale>.json      # E-Mails
services/ai/messages/<locale>.json        # Coach-Vorgaben
packages/contracts/templates/*.json       # Vorlagen mit Texten pro Sprache
docs/i18n/
├─ glossary.md      # feste Begriffe je Sprache, nie zwei Wörter für ein Ding
└─ style-de.md      # Du-Form, Tonalität, Schreibweise (immer ss, nie ß; Sprachkennung de-DE)
```

**Schlüssel:** englisch, nach Ort und Zweck, nie der deutsche Text selbst.

```json
{
  "canvas": {
    "toolbar": { "addNote": "Notiz hinzufügen", "addZone": "Zone" },
    "selection": {
      "count": "{count, plural, one {# Element ausgewählt} other {# Elemente ausgewählt}}"
    },
    "save": {
      "saving": "Speichert …",
      "saved": "Gespeichert",
      "failed": "Nicht gespeichert – erneut versuchen"
    }
  },
  "errors": {
    "ERR_BOARD_NOT_FOUND": "Dieses Board gibt es nicht oder es gehört nicht zu deinem Konto."
  }
}
```

**Format:** ICU MessageFormat – benannte Platzhalter, Mehrzahl, Auswahl. Damit funktionieren
Sprachen mit anderen Mehrzahlregeln ohne Codeänderung.

**Bibliothek [Entscheidung]:** etablierte Open-Source-i18n-Bibliothek mit ICU-Unterstützung
und Server-Rendering **oder** eigene dünne Schicht auf `Intl.PluralRules` und den
`Intl`-Formatierern. Vorschlag: etablierte Bibliothek; Version pinnen, Lizenz prüfen.

### 23.3 Regeln für Code, der Text zeigt

1. **Nie** Text im Code: kein JSX-Text, kein `aria-label="…"`, kein `placeholder="…"`, keine
   Fehlermeldung als String. Immer `t("schlüssel")`.
2. **Nie** Sätze zusammenstückeln. Ein Satz = ein Schlüssel mit Platzhaltern.
3. **Nie** Zahlen, Daten, Zeiten, Listen selbst formatieren: `Intl.*` mit der Sprache der Person;
   Anzeige in `Europe/Zurich`, Speicherung UTC.
4. **Server liefert Codes, nicht Texte.** Die App übersetzt. Ausnahme: E-Mails und
   Coach-Antworten entstehen serverseitig in der Sprache der Person.
5. **Kein Text in Bildern.**
6. **Layout für längere Texte:** bis +40 %; Knöpfe wachsen oder kürzen mit Ellipse, nie
   abschneiden.
7. **Richtung:** nur logische CSS-Eigenschaften; die Engine bekommt eine Leserichtung als
   Einstellung.
8. **Engine:** keine eigenen Texte; Beschriftungen für A11y-Spiegel und Tooltips aus der App.
9. **Sprachwahl:** Kontoeinstellung → Browser-Sprache → Deutsch. URL-Präfix (`/de/…`, `/en/…`)
   für öffentliche Seiten; in der App ohne Präfix. `<html lang>` immer korrekt.
10. **Suche:** Volltext mit Sprachkonfiguration pro Workspace/Notiz (Standard Deutsch).

### 23.4 Automatische Prüfung: Gate `language-check`

Eigenes Node-Skript, läuft bei Änderungen unter `apps/`, `packages/`, `services/`, `tools/`,
`infra/migrations/`.

| Prüfung | Fehler wenn |
| --- | --- |
| Deutsch im Code | Umlaute/`ß` oder Wörter aus einer deutschen Wortliste in Namen, Kommentaren, Strings, Logs, Testnamen – ausser in `messages/*.json`, `templates/*.json` und markierten Nutzerinhalt-Fixtures |
| Sichtbarer Text ohne Übersetzung | JSX-Text oder `aria-label`/`placeholder`/`title`/`alt` mit Literal |
| Schlüssel-Gleichheit | Schlüssel fehlt in `de.json` (Fehler) oder `en.json` (Fehler ab v1, vorher Warnung) |
| Unbenutzte Schlüssel | Schlüssel nirgends verwendet (Warnung) |
| ICU-Syntax | ungültig oder Platzhalter je Sprache unterschiedlich |
| Zusammenstückeln | `t(…) +` oder Template-String mit zwei `t(…)` |
| Commits/PR-Titel | Umlaute oder deutsche Wortliste im Betreff |
| Schreibweise Deutsch | `ß` in `messages/de*.json`, `services/*/messages/de*.json` oder deutschen Vorlagen-Texten (Regel: immer `ss`) |

**Pseudo-Sprache `en-XA`:** aus `en.json` erzeugt – Akzente, +40 % Länge, in Klammern
(`[Ńöţé ĥîñžûƒûéñ·····]`). Ein nächtlicher e2e-Lauf in `en-XA` findet jeden hart codierten Text
(ohne Akzente) und jedes Layout, das bei längeren Texten bricht (abgeschnittene Klammer).

### 23.5 Ablauf, wenn neuer Text dazukommt

1. Schlüssel in **`de.json`** (nach `style-de.md` und `glossary.md`) **und** in **`en.json`**
   anlegen (im PR markiert `i18n: en needs review` bis zur Prüfung).
2. Code nutzt nur `t("…")`.
3. Gates: `language-check`, betroffene e2e, nachts `en-XA`.
4. Review prüft deutschen Text gegen Stil und Glossar, englischen mindestens auf Sinn.
5. Neue Sprache: `messages/<locale>.json` + `style-<locale>.md` + Glossar-Spalte, durch
   Übersetzer oder Dienst [Entscheidung]; kein Code; Freischalten per Konfiguration, sobald
   `language-check` für die Sprache grün ist.

### 23.6 Einordnung in die Phasen

| Wo | Was |
| --- | --- |
| P0-18 | Grundgerüst: Bibliothek, `de.json` + `en.json`, typisierte Schlüssel, Pseudo-Sprache, `language-check`, Glossar, `style-de.md` |
| P1-05 | Fehlercodes im Vertrag, je ein Schlüssel `errors.<CODE>` |
| P3-02 | E-Mail-Vorlagen von `auth` mehrsprachig |
| P6-01 | Sprachwahl in den Einstellungen, alle Seiten über Schlüssel |
| P7-03 | Coach antwortet in der Sprache der Person |
| P8-05 | Englisch-Review durch Muttersprachler [Entscheidung], `en-XA` ohne Befund |
| P9 | Start mit Deutsch; Englisch freischalten, wenn geprüft [Entscheidung] |

### 23.7 Offene Punkte dazu

- **Entschieden (2026-10-25): Deutsch immer mit `ss`, nie `ß`** („Schliessen“, „Grösse“,
  „gross“, „Strasse“). Es gibt **eine** deutsche Sprachdatei `messages/de.json` mit der
  Sprachkennung **`de-DE`** (`<html lang="de-DE">`, `Intl`-Formate für Datum und Zahlen nach
  `de-DE`, z. B. `1.234,5`); keine getrennte `de-CH`-Datei. Festgehalten in
  `docs/i18n/style-de.md` und im Glossar; `language-check` meldet jedes `ß` in `de.json`,
  E-Mail-Vorlagen und Vorlagen-Texten als Fehler.
- Englisch zum Start sichtbar oder nur vorbereitet?
- Wer übersetzt weitere Sprachen (Mensch, Dienst, KI mit menschlicher Prüfung)?
