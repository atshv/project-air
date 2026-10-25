# Leinwand-Feinschliff – Arbeitsaufträge

Stand 2026-10-25 · **Teil von v1** · Input für M25 (Testerrunde und Fixes) · Design-Regeln:
[design-rules.md](design-rules.md) (verbindlich)

> Testerfeedback des Owners: Zonen, Notizen, Paletten und Checklisten lassen sich noch nicht
> „sauber“ bewegen und bearbeiten. Jeder Punkt unten ist ein **fertiger Arbeitsauftrag** für
> einen Agenten: feste Werte, betroffene Dateien, Verbote, prüfbare Abnahme. Was hier nicht
> steht, wird nicht gebaut. Was unklar ist, kommt in `open_questions` – nicht raten.
> `C1` usw. sind Arbeitsnummern, keine Task-IDs; neue Punkte bekommen fortlaufende Nummern.

## So detailliert ist „Polish“ hier gemeint

Ein Punkt ist erst **auftragsreif**, wenn er alle sieben Felder hat. Fehlt eines, wird der
Punkt nicht vergeben.

| Feld | Inhalt | Beispiel |
| --- | --- | --- |
| **Ziel** | ein Satz, was die Person danach spürt | „Klicken öffnet, Ziehen bewegt – nie beides.“ |
| **Heute** | beobachtbarer Fehler, reproduzierbar | „Klick verschiebt Karte um 2–5 px.“ |
| **Soll (Werte)** | Zahlen statt Adjektive: px, ms, Tasten, Tokens | „Schwelle 4 px, Griffzeile 28 px.“ |
| **Zustände** | alle Zustände aus design-rules.md §6, die betroffen sind | Ruhe, Hover, Ziehen, Fokus |
| **Dateien** | abschliessende Liste; andere Dateien = fragen | `src/ui/blocks/blocks.module.css` |
| **Nicht tun** | die naheliegenden Fehlgriffe | „kein eigenes Drag-System bauen“ |
| **Abnahme** | Checkboxen, jede in < 1 min prüfbar, plus e2e-Spec | „□ Text markieren bewegt nichts“ |

**Zu grob** (verboten): „Snap verbessern“, „Ziehen fühlt sich besser an“, „schöner machen“.
**Richtig:** „Nach dem Loslassen sind `x` und `y` Vielfache von 16; mit `Shift` nicht.“

## Übersicht und Reihenfolge

Erst das, was beim ersten Anfassen kaputt wirkt (P0), dann Komfort (P1), dann Politur (P2).
Innerhalb einer Stufe in dieser Reihenfolge abarbeiten.

| # | ID | Punkt | Prio | Aufwand | Status |
| --- | --- | --- | --- | --- | --- |
| – | C0 | Werkzeugleiste als Icon-Leiste in der Leinwand | P0 | S | erledigt (0.2.9a), Nacharbeit in C19 |
| 1 | C13a | Performance-Basis messen | P0 | S | offen |
| 2 | C19 | Sichtbare Mängel beheben (Bestandsaufnahme) | P0 | S–M | offen |
| 3 | C14 | Ziehen und Bearbeiten sauber trennen | P0 | S–M | offen |
| 4 | C8 | Panel überlagert statt Leinwand zu stauchen | P0 | S | offen |
| 5 | C3 | Live-Speichern mit Status bei Inline-Feldern | P0 | M | umgesetzt (0.2.10), Feinschliff offen |
| 6 | C5 | Leere Notiz: Platzhalter und Fokus | P0 | S | umgesetzt (0.2.10a) |
| 7 | C1 | Snap-to-Grid und Einrastlinien | P0 | M | umgesetzt (0.2.10b), Live-Snap offen |
| 8 | C2 | Zonen als echte Container | P0 | L + ADR | wartet auf Owner |
| 9 | C4 | Notiz-Titel im Panel bearbeiten | P0 | S | offen |
| 10 | C7 | Mehrfachauswahl | P1 | S–M | offen |
| 11 | C6 | Undo/Redo | P1 | L | offen |
| 12 | C9 | Tastatur und Kontextmenü | P1 | M | offen |
| 13 | C10 | Ebenen und Überlappung | P1 | M | offen |
| 14 | C15 | Grösse ändern | P1 | M | offen |
| 15 | C16 | Trackpad und Touch | P1 | S | offen |
| 16 | C17 | Auto-Pan, Ansicht merken | P1 | S | offen |
| 17 | C11 | Inline-Komfort (Tab/Enter) | P2 | M | offen |
| 18 | C12 | Canvas-Feel | P2 | M | offen |
| 19 | C18 | Neue Elemente sinnvoll platzieren | P2 | S | offen |
| 20 | C13b | Performance-Beweis | P2 | S | offen |

Aufwand: **S** ≈ halber Tag, **M** ≈ 1–2 Tage, **L** ≈ 3–5 Tage.

## Querschnitt – gilt für jeden Punkt

- **React Flow statt Eigenbau.** `@xyflow/react` 12.12 hat: `snapToGrid`/`snapGrid` (C1),
  `parentId`/`extent: 'parent'` (C2), `nodeDragThreshold`/`dragHandle`/Klasse `nodrag` (C14),
  `selectionOnDrag`/`multiSelectionKeyCode` (C7), `NodeResizer` (C15), `panOnScroll`/
  `zoomOnPinch` (C16), `autoPanOnNodeDrag` (C17), `onlyRenderVisibleElements` (C13), `Panel`
  (C0). **NIE** eigene Drag-, Zoom- oder Auswahl-Logik schreiben, wenn es den Baustein gibt.
  Vor Einsatz Signatur in `node_modules/@xyflow/react/dist/esm/types` prüfen.
- **Umkehrbare Schreibaktionen ab C1.** Jede Geste wird als Operation `{do, undo}` in
  `src/ui/canvas/interactions.ts` gebaut. C6 ist dann nur noch ein Stapel darüber.
- **Ein Autosave-Hook.** C3 baut `useAutosave` (Verzögerung, Status, Fehler, Flush). C4, C11
  und jedes Inline-Feld nutzen ihn. **NIE** einen zweiten bauen.
- **Eine Geste = eine Schreibaktion.** Ziehen, Gruppenziehen, Grösse ändern, Pfeiltasten-Serie.
- **Bestehende Daten:** keine Migration alter Koordinaten; sie rasten beim nächsten Bewegen ein.
- **Tests:** jede Abnahme-Checkbox mit „(e2e)“ hat einen neuen Test in einer **neuen**
  Spec-Datei `tests/e2e/canvas-<id>.spec.ts`. Bestehende Specs werden nicht geändert.
- **Changelog:** `npm run changelog -- "<English summary>"` pro Punkt.

---

## P0 – wirkt beim ersten Anfassen kaputt

### C13a – Performance-Basis messen

- **Ziel:** Ab jetzt ist messbar, ob ein Punkt die Leinwand langsamer macht.
- **Soll:** `npm run test:perf` einmal auf dem heutigen Stand laufen lassen. Ergebnis
  (Long Tasks, max. Dauer, FPS beim Zoomen/Verschieben, 500 Karten, 50 Zonen) als
  `reviews/evidence/C13a-baseline-<datum>.json` ablegen und die Kernzahlen hier unten in
  „Messwerte“ eintragen.
- **Dateien:** nur `reviews/evidence/`, dieser Abschnitt.
- **Nicht tun:** Code ändern; Budgets anpassen.
- **Abnahme:** □ Datei liegt vor □ Zahlen stehen unter „Messwerte“.

### C19 – Sichtbare Mängel beheben (Bestandsaufnahme)

- **Ziel:** Nichts auf der Leinwand sieht abgeschnitten, doppelt oder zufällig aus.
- **Heute (beobachtet 2026-10-25, Vorlage „Design-Projekt“, 1440×900):**
  1. Zonen zeigen unter dem Titel ein abgeschnittenes Kürzel „F…“ (Feld-Label ragt unter die
     Notizkarte).
  2. Jede Karte und jeder Block zeigt dauerhaft ein „×“ oben rechts – zehn Löschknöpfe im Bild.
  3. Spalten-Block: Einträge abgeschnitten („Entwu“), horizontale Scrollleiste im Block.
  4. Zeitstrahl-Block: innere Scrollleiste, Phasen-Karten kleben am Rand.
  5. Zoom-Steuerung unten links ist bei 900 px Höhe teilweise abgeschnitten.
  6. „Alles anzeigen“ legt Zonen unter die Werkzeugleiste.
  7. Notizkarten in Zonen überdecken die Zonen-Kopfzeile.
  8. Werkzeugleiste (C0) nutzt eigene `rgba()`-Werte und `0.3rem`-Abstände (verstösst gegen
     design-rules §2/§3).
- **Soll:**
  1. Label entfernen oder in die Kopfzeile verlegen; Kopfzeile ist **40 px** hoch, Titel
     15 px/600, einzeilig mit Ellipse.
  2. „×“ durch Icon-Knopf 28 px (Icon 16 px, neues Icon `close` in `toolbar-icons.tsx`)
     ersetzen; in Ruhe `opacity: 0`, sichtbar bei Hover, Fokus innerhalb, Auswahl
     (design-rules §6).
  3. Spalten: Mindestbreite pro Spalte **176 px**; Einträge umbrechen statt abschneiden
     (`overflow-wrap: anywhere`); Block wächst in der Höhe, **keine** innere horizontale
     Scrollleiste.
  4. Zeitstrahl: Innenabstand **16 px**, Phasenabstand **12 px**, keine innere Scrollleiste;
     Block wächst in der Höhe.
  5. Leinwandhöhe so wählen, dass die Zoom-Steuerung mit **12 px** Abstand ganz sichtbar ist.
  6. `fitViewOptions.padding` so, dass oben ≥ **64 px** frei bleiben (Leiste 48 px + 16 px).
  7. Inhalt einer Zone beginnt unter der Kopfzeile (Innenabstand oben 40 px + 16 px).
  8. Leiste auf Tokens umstellen: Hintergrund `--surface`, Abstände 4/8 px; ggf. fehlendes
     Token als Frage stellen.
- **Zustände:** Ruhe, Hover, Fokus, Ausgewählt für Löschknopf und Kopfzeile.
- **Dateien:** `src/ui/canvas/card-node.tsx`, `src/ui/canvas/canvas.tsx`,
  `src/ui/canvas/canvas-toolbar.module.css`, `src/ui/canvas/toolbar-icons.tsx`,
  `src/ui/blocks/*.tsx`, `src/ui/blocks/blocks.module.css`, `src/ui/strings.de.ts`.
- **Nicht tun:** Blockgrössen in der Datenbank ändern; neue Farben; Löschen ohne Knopf (nur
  Tastatur) – der Knopf bleibt, er wird nur leise.
- **Abnahme:** □ 1–8 einzeln mit Vorher/Nachher-Screenshot belegt □ kein „×“-Zeichen mehr im
  Code der Leinwand □ Tab-Taste erreicht jeden Löschknopf und macht ihn sichtbar (e2e)
  □ keine innere Scrollleiste in Spalten/Zeitstrahl bei Vorlage „Design-Projekt“ (e2e).

### C14 – Ziehen und Bearbeiten sauber trennen

- **Ziel:** Klicken öffnet, Ziehen an der Griffzone bewegt, Klicken in Text bearbeitet – nie
  zwei davon gleichzeitig.
- **Heute:** In Checklisten, Tabellen, Paletten und Zonen-Titeln verschiebt ein Klick auf Text
  manchmal den Block oder markiert Text statt zu bewegen; ein Klick auf eine Karte verschiebt
  sie um einige Pixel.
- **Soll:**
  - `nodeDragThreshold={4}` auf `<ReactFlow>`; bestehendes `nodeClickDistance` bleibt.
  - **Notizkarten:** ganze Karte ist Griffzone (sie hat keine Inline-Felder).
  - **Blöcke und Zonen:** nur die **Kopfzeile (40 px)** ist Griffzone (`dragHandle`), Cursor
    `grab`/`grabbing`. Rest des Blocks: Cursor `default`, auf Feldern `text`.
  - Jedes `input`, `textarea`, `select`, `button`, `[contenteditable]` in Blöcken trägt
    `nodrag` (und `nowheel` bei scrollbaren Bereichen).
  - Hover auf Kopfzeile: Fläche `--faint`, 120 ms.
- **Zustände:** Ruhe, Hover Kopfzeile, Ziehen, Fokus im Feld.
- **Dateien:** `src/ui/canvas/canvas.tsx`, `src/ui/canvas/node-types.ts`,
  `src/ui/blocks/*.tsx`, `src/ui/blocks/blocks.module.css`.
- **Nicht tun:** eigenes Pointer-Handling; Griff-Icon („⋮⋮“) zusätzlich zur Kopfzeile;
  Doppelklick-zum-Bearbeiten-Modus.
- **Abnahme:** □ Text in Checkliste mit Maus markieren bewegt den Block nicht (e2e)
  □ Ziehen an der Kopfzeile bewegt ihn (e2e) □ Klick auf Karte ohne Bewegung > 4 px schreibt
  keine Position (e2e: keine Move-Anfrage) □ Ziehen im Block-Inneren (ausserhalb der Kopfzeile)
  bewegt nichts.

### C8 – Panel überlagert statt Leinwand zu stauchen

- **Ziel:** Beim Öffnen einer Notiz bleibt alles auf der Leinwand, wo es war.
- **Heute:** Das Panel nimmt Grid-Platz; die Leinwand wird schmaler, Karten rutschen unter dem
  Cursor weg.
- **Soll:** Panel `position: absolute` über der Leinwand, rechts, **400 px** breit (390 px
  Viewport: volle Breite), 12 px Abstand oben/rechts/unten, Hintergrund `--surface`, Rahmen
  `--border`, `--shadow`. Ein- und ausblenden: `transform: translateX(16px)` + `opacity`,
  180 ms ease-out. Die Leinwandbreite ändert sich **nie**. Liegt die angeklickte Karte nach dem
  Öffnen unter dem Panel, wird die Ansicht **sanft** (300 ms) nur so weit verschoben, dass die
  Karte 24 px links vom Panel steht – sonst keine Ansichtsänderung.
- **Zustände:** geschlossen, öffnend, offen, schliessend.
- **Dateien:** `src/app/(app)/b/[boardId]/page.tsx`, `src/ui/panel/panel.module.css`,
  `src/ui/panel/note-panel.tsx`, `src/ui/canvas/canvas.tsx`.
- **Nicht tun:** Leinwand neu einpassen (`fitView`) beim Öffnen/Schliessen; Panel als Modal mit
  Abdunkelung.
- **Abnahme:** □ Bildschirmposition einer sichtbaren Karte ändert sich beim Öffnen um 0 px,
  wenn sie nicht unter dem Panel liegt (e2e, `boundingBox` vorher/nachher) □ Schliessen ändert
  nichts (e2e) □ `Esc` schliesst das Panel.

### C3 – Live-Speichern mit Status bei Inline-Feldern

- **Ziel:** Man sieht immer, ob das Getippte gespeichert ist, und verliert nie etwas.
- **Heute:** Zonen-Titel, Checklisten-Punkte, Tabellenzellen, Farbnamen, Zeitplan-Felder
  speichern erst beim Verlassen des Feldes.
- **Soll:**
  - Hook `useAutosave(value, save, { delayMs: 400 })` in `src/ui/canvas/use-autosave.ts`.
  - Speichern 400 ms nach dem letzten Tastendruck; sofort bei Blur, Panel-Schliessen,
    Navigation, `visibilitychange` (hidden) und `pagehide`.
  - Jede Anfrage trägt eine fortlaufende Nummer; eine ältere Antwort überschreibt **nie** einen
    neueren lokalen Wert.
  - Status pro Block in der Kopfzeile rechts (fester Platz, 12 px, `--muted`): „Speichert …“
    → „Gespeichert“ (blendet nach 2 s aus) → bei Fehler „Nicht gespeichert – erneut versuchen“
    in `--danger`, klickbar, Eingabe bleibt.
  - Fokus und Cursorposition bleiben beim Speichern unverändert.
- **Zustände:** Ruhe, Tippen, Speichert, Gespeichert, Fehler.
- **Dateien:** `src/ui/canvas/use-autosave.ts` (neu), `src/ui/blocks/*.tsx`,
  `src/ui/blocks/blocks.module.css`, `src/ui/strings.de.ts`.
- **Nicht tun:** Speichern bei jedem Tastendruck; Spinner; Toast pro Speichervorgang;
  Statusanzeige, die Layout verschiebt.
- **Stand 2026-10-25 (0.2.10):** umgesetzt mit `useBlockDraft`
  (`src/ui/blocks/use-block-draft.ts`), `SaveHint` und `.saveHint` in `blocks.module.css`:
  450 ms Debounce, sofortiger Flush bei Blur und beim Unmount, Status „Speichert …“ →
  „Gespeichert“ (blendet nach 2 s aus) → „Nicht gespeichert“, Fokus und Cursor bleiben.
  Abgedeckt: Zonen-Titel/-Farbe, Checkliste, Palette, Spalten, Zeitstrahl, Tabelle;
  neue e2e `tests/e2e/blocks-live-save.spec.ts` (Tippen ohne Blur, Fokus, Reload).
  **Offen aus der Abnahme:** Flush bei `visibilitychange`/`pagehide`, klickbarer
  Fehler-Retry, Unit-Test für verzögerte Antworten, e2e-Fehlerfall mit `page.route`.
- **Abnahme:** □ Tippen ohne Fokuswechsel → nach ≤ 500 ms gespeichert, Reload zeigt Wert (e2e)
  □ Tippen und sofort wegnavigieren verliert nichts (e2e) □ verzögerte erste Antwort
  überschreibt die zweite Eingabe nicht (Unit-Test des Hooks) □ Fehler (Netz aus) zeigt
  deutschen Hinweis und behält Eingabe (e2e mit `page.route`) □ Cursor bleibt an Ort.

### C5 – Leere Notiz: Platzhalter und Fokus

- **Ziel:** Eine neue Notiz lädt sofort zum Schreiben ein.
- **Soll:** Beim Öffnen des Panels einer leeren Notiz: Fokus im Editor, Cursor am Anfang.
  Platzhalter „Schreib los …“ in `--muted`, 15 px, verschwindet beim ersten Zeichen.
  Umsetzung ohne neue Abhängigkeit per CSS auf den leeren ersten Absatz
  (`p.is-empty:first-child::before { content: attr(data-placeholder) }` o. ä.); geht das mit
  Tiptap 3.32 nicht zuverlässig → `open_questions` (Placeholder-Extension wäre neue
  Abhängigkeit).
- **Dateien:** `src/ui/editor/editor.tsx`, `src/ui/editor/editor.module.css`,
  `src/ui/strings.de.ts`.
- **Nicht tun:** Platzhalter als echter Inhalt; Fokus bei nicht-leeren Notizen erzwingen.
- **Abnahme:** □ neue Notiz zeigt Platzhalter und hat Fokus (e2e) □ erstes Zeichen blendet ihn
  aus (e2e) □ Reload einer leeren Notiz speichert keinen Platzhaltertext.
- **Stand 2026-10-25 (0.2.10a):** umgesetzt ohne neue Abhängigkeit: React-Overlay-Placeholder
  (`empty`-State aus Tiptap) statt CSS auf dem Absatz, `onCreate` setzt den Fokus auf den
  Anfang, `EDITOR.placeholder` in `strings.de.ts`. Neue e2e `tests/e2e/note-placeholder.spec.ts`
  (Platzhalter sichtbar, Fokus, erstes Zeichen, Reload ohne Platzhaltertext). **Offen:** keine.

### C1 – Snap-to-Grid und Einrastlinien

- **Ziel:** Alles steht automatisch ordentlich zueinander.
- **Soll:**
  - `snapToGrid` mit `snapGrid={[16, 16]}`; gehaltenes `Shift` beim Ziehen = frei.
  - Einrastlinien (Eigenbau, eine SVG-Ebene, design-rules §8 Ebene 7): beim Ziehen Kanten und
    Mitten des gezogenen Elements gegen Kanten und Mitten sichtbarer Nachbarn und Zonen
    prüfen; Toleranz **6 px** Bildschirm; Linie 1 px `--accent`, durchgehend über beide
    Elemente + 16 px. Einrasten auf eine Linie hat Vorrang vor dem Raster.
  - Gespeichert wird die gerastete Position, als `{do, undo}`-Operation.
- **Dateien:** `src/ui/canvas/canvas.tsx`, `src/ui/canvas/interactions.ts`,
  `src/ui/canvas/snap-guides.tsx` (neu), `src/logic/canvas/snap.ts` (neu, reine Funktion),
  `tests/unit/canvas-snap.test.ts` (neu).
- **Nicht tun:** Linien bei mehr als 3 Treffern gleichzeitig zeigen; Snap beim Zoomen/Pannen
  berechnen; alte Positionen migrieren.
- **Abnahme:** □ nach Loslassen `x`/`y` Vielfache von 16 (e2e) □ mit `Shift` freie Position
  (e2e) □ Linie sichtbar, solange eingerastet □ Unit-Tests der Snap-Funktion (Kante, Mitte,
  Toleranz, Vorrang) □ C13-Messung nicht schlechter als Basis + 10 %.
- **Stand 2026-10-25 (0.2.10b):** umgesetzt mit reiner Funktion `snapPosition`
  (`src/logic/canvas/snap.ts`, 7 Unit-Tests), Linien-Ebene `snap-guides.tsx` (ViewportPortal,
  eigenes State, re-rendert die Leinwand nicht) und den Drag-Handlern in `canvas.tsx`.
  16-px-Raster, Toleranz 6 px / Zoom, Kanten und Mitten, Linie gewinnt vor Raster, höchstens
  drei Linien, `Shift` = frei (Selection-Key von React Flow abgeschaltet). Neue e2e
  `tests/e2e/canvas-snap.spec.ts` (Raster nach Drop + Reload, Shift frei, Linie sichtbar).
  **Abweichung zum Soll:** Das Element folgt beim Ziehen frei; die gerastete Position wird
  beim Loslassen gesetzt (Linien zeigen die Ausrichtung vorher). Live-Einrasten während des
  Ziehens und die C13-Perf-Messung sind offen.

### C2 – Zonen als echte Container *(wartet auf Owner-Entscheidung 1)*

- **Ziel:** Was in einer Zone liegt, gehört zu ihr – sichtbar, gespeichert, verlässlich.
- **Soll (nach Freigabe):** `ADR-0007 Zonen als Container`; Migration `parent_item_id` in
  `board_items` (nullable, FK auf Zone, RLS wie Eltern-Board); React Flow `parentId` +
  `extent: 'parent'`. Ablegen mit Mittelpunkt in einer Zone = Zugehörigkeit; Zone wird dabei
  1 s mit Rahmen `--accent-line` hervorgehoben. Herausziehen (Mittelpunkt ausserhalb) löst sie.
  Zone löschen → Dialog „Inhalt behalten“ (Standard) / „Inhalt mitlöschen“. Zone verkleinern
  geht nicht kleiner als ihr Inhalt + 16 px.
- **Dateien:** werden in der ADR festgelegt.
- **Nicht tun:** vor Freigabe anfangen; verschachtelte Zonen (Zone in Zone) – nicht in v1.
- **Abnahme:** □ Zugehörigkeit übersteht Reload (e2e) □ Zone ziehen = eine Schreibaktion
  (e2e) □ Löschen fragt nach (e2e) □ DB-/RLS-Test für die Spalte □ ADR abgenommen.

### C4 – Notiz-Titel im Panel bearbeiten

- **Ziel:** Titel dort ändern, wo man die Notiz liest.
- **Soll:** Panel-Titel wird ein Eingabefeld im gleichen Look (Serif 24 px, ohne Rahmen in
  Ruhe, Unterlinie `--border-strong` bei Hover/Fokus). Speichern über `useAutosave`. Gleiche
  Validierung wie Bibliothek; Fehler darunter 12 px `--danger`, alter Titel bleibt
  gespeichert. `Enter` springt in den Editor.
- **Dateien:** `src/ui/panel/note-panel.tsx`, `src/ui/panel/panel.module.css`,
  `src/ui/strings.de.ts`.
- **Nicht tun:** eigene Validierung; zweiter Speicherweg.
- **Abnahme:** □ Titel ändern → Karte und Bibliothek nach Reload aktuell (e2e) □ leer/zu lang
  zeigt Fehler und schreibt nichts (e2e) □ `Enter` setzt Fokus in den Editor.

## P1 – Komfort, der täglich fehlt

### C7 – Mehrfachauswahl

- **Soll:** `Shift`-Klick fügt hinzu/entfernt; Rahmenauswahl durch Ziehen auf leerer Fläche
  mit gehaltenem `Shift` (ohne `Shift` verschiebt Ziehen weiterhin die Ansicht); Auswahlrahmen
  1 px `--accent`, Fläche `--accent-soft`. Gemeinsames Ziehen = eine Schreibaktion. Über der
  Auswahl erscheint eine kleine Leiste (Anzahl „3 ausgewählt“, Löschen). `Esc` hebt auf.
- **Dateien:** `src/ui/canvas/canvas.tsx`, `src/ui/canvas/interactions.ts`,
  `src/ui/strings.de.ts`.
- **Abnahme:** □ drei Karten gemeinsam ziehen = genau eine Anfrage (e2e) □ Auswahl bleibt nach
  dem Ziehen □ `Esc` hebt auf (e2e).

### C6 – Undo/Redo

- **Soll:** Stapel der `{do, undo}`-Operationen, Tiefe **20**, pro Sitzung. `Cmd/Ctrl+Z` /
  `Shift+Cmd/Ctrl+Z`. Hinweis unten Mitte (design-rules §9) „Rückgängig: Verschoben“ für 3 s.
  Steht der Fokus in einem Feld oder im Editor, gehört `Cmd/Ctrl+Z` dem Feld.
- **Dateien:** `src/ui/canvas/history.ts` (neu), `src/ui/canvas/canvas.tsx`,
  `src/ui/canvas/interactions.ts`, `src/ui/strings.de.ts`, `tests/unit/canvas-history.test.ts`.
- **Abnahme:** □ 20 Schritte zurück □ ein Undo = genau eine Gegen-Anfrage (e2e) □ Undo nach
  Löschen stellt Karte wieder her (e2e) □ `Cmd+Z` im Textfeld ändert nichts auf dem Board (e2e).

### C9 – Tastatur und Kontextmenü

- **Soll:** `Cmd/Ctrl+D` duplizieren (+16/+16 versetzt), `Entf`/`Backspace` löschen,
  `Esc` Panel/Auswahl schliessen, Pfeiltasten 16 px (`Shift` 160 px; eine Schreibaktion
  300 ms nach der letzten Taste). Rechtsklick: Menü (Öffnen, Duplizieren, Nach vorne, Nach
  hinten, Löschen), 200 px breit, Einträge 32 px, Kürzel rechts in `--muted`. Kürzel wirken
  **nie**, wenn der Fokus in einem Feld liegt.
- **Dateien:** `src/ui/canvas/canvas.tsx`, `src/ui/canvas/context-menu.tsx` (neu),
  `src/ui/strings.de.ts`.
- **Abnahme:** □ Duplizieren und Löschen per Tastatur (e2e) □ Pfeiltasten landen auf Raster
  (e2e) □ Kürzel im Textfeld wirken nicht (e2e) □ Menü per Tastatur bedienbar.

### C10 – Ebenen und Überlappung

- **Soll:** z-Reihenfolge exakt nach design-rules §8. Zuletzt bewegtes Element liegt in seiner
  Ebene oben (gespeichert über bestehendes `z`). Kollision: nur auf Owner-Entscheidung 4.
- **Abnahme:** □ Notizkarte liegt immer über Blöcken □ zuletzt bewegte Karte oben nach Reload
  (e2e).

### C15 – Grösse ändern

- **Soll:** `NodeResizer` bei Auswahl; Griffe 8 px, Farbe `--accent`; Grösse rastet auf 16 px
  (`Shift` frei). Mindestgrössen: Notiz 176×80, Checkliste 224×128, Tabelle 288×160, Zone
  256×192, Spalten 368×192, Zeitstrahl 320×160, Palette 224×128.
- **Abnahme:** □ Breite/Höhe Vielfache von 16 (e2e) □ Mindestgrösse greift □ eine Geste = eine
  Anfrage □ übersteht Reload (e2e).

### C16 – Trackpad und Touch *(Owner-Entscheidung 7)*

- **Soll (Vorschlag):** `panOnScroll`, `zoomOnPinch`, `zoomActivationKeyCode` = `Meta`/
  `Control`. Touch: ein Finger auf Element zieht es, ein Finger auf leerer Fläche oder zwei
  Finger verschieben die Ansicht.
- **Abnahme:** □ Zwei-Finger-Wischen verschiebt ohne Zoom □ Pinch zoomt um Fingermitte
  □ Touch-Ziehen eines Elements bewegt nicht die Ansicht (manuell auf iPad, Notiz im Ergebnis).

### C17 – Auto-Pan und Ansicht merken

- **Soll:** `autoPanOnNodeDrag`. Zoom und Position pro Board in `localStorage`
  (`calm.viewport.<boardId>`, try/catch), beim Öffnen wiederherstellen; ohne Eintrag „Alles
  anzeigen“.
- **Abnahme:** □ Reload zeigt denselben Ausschnitt (e2e) □ neues Board startet eingepasst.

## P2 – Politur und Beweis

### C11 – Inline-Komfort

- **Soll:** Checkliste/Spalten/Tabelle: `Enter` = neuer Eintrag darunter mit Fokus, `Tab` /
  `Shift+Tab` = nächstes/vorheriges Feld, `Backspace` im leeren Eintrag = löschen, Fokus auf
  den vorherigen. Palette: Farbwähler als 24-px-Farbfeld statt nativem Riesen-Knopf.
- **Abnahme:** □ drei Punkte nur mit Tastatur anlegen (e2e) □ leeren Punkt mit `Backspace`
  löschen (e2e).

### C12 – Canvas-Feel

- **Soll:** „Alles anzeigen“ höchstens Zoom 1.0 und Padding nach C19; Punktraster blendet unter
  Zoom 0.5 aus. Mini-Map und Aufräumen **nicht** in v1 (eigene Entscheidung, falls gewünscht).
- **Abnahme:** □ „Alles anzeigen“ bei einer Karte zoomt nicht über 100 %.

### C18 – Neue Elemente sinnvoll platzieren

- **Soll:** neues Element in der Mitte der Ansicht, auf Raster; ist der Platz belegt, um je
  32 px nach rechts unten versetzen (max. 10 Versuche).
- **Abnahme:** □ fünfmal „Notiz hinzufügen“ = fünf sichtbare, nicht überlappende Karten (e2e).

### C13b – Performance-Beweis

- **Soll:** `npm run test:perf` nach C1, C2, C3 und am Ende; 500 Karten + 50 Zonen ohne Long
  Task > 50 ms beim Zoomen und Verschieben (`docs/quality.md`, M24-Budgets);
  `onlyRenderVisibleElements` prüfen.
- **Abnahme:** □ alle Läufe unter Budget □ Vergleich zur Basis (C13a) im Ergebnis.

## Messwerte

| Lauf | Datum | Long Tasks > 50 ms | max. Long Task | Notiz |
| --- | --- | --- | --- | --- |
| Basis (C13a) | – | – | – | noch nicht gemessen |

## Erweiterungen (kommen dazu)

Früher ausgeschlossen, jetzt geplant: freies Drag-to-Connect, Teilen-Links,
Kanban-Automation, Echtzeit-Zusammenarbeit, Offline und native Apps. Reihenfolge, Aufwand,
Abhängigkeiten und offene Entscheidungen stehen in [roadmap.md](roadmap.md).

Nicht in v1 bleiben: Datenbank-Ansichten, Zahlungen, Kontoverwaltung, Uploads ausser
PDF/XLSX, eigene Vorlagen (`ARCHITECTURE.md`, „Nicht-Ziele“).

## Offene Entscheidungen für den Owner

1. **Zonen als echte Container** (C2): ja/nein — wenn ja, `ADR-0007` + Migration.
2. **Rasterweite** (C1): 16 px; `Shift` frei.
3. **Undo-Tiefe** (C6): 20 Schritte pro Sitzung.
4. **Überlappung** (C10): nur klare Ebenen (Vorschlag) oder zusätzlich sanftes Ausweichen?
5. **Platzhalter** (C5): CSS-Lösung (Vorschlag) oder Placeholder-Extension als neue
   Abhängigkeit?
6. **Zwei offene Tabs** (C3): „letzte Eingabe gewinnt“ (Vorschlag) oder Konflikthinweis?
7. **Trackpad** (C16): zwei Finger verschieben, Pinch zoomt (Vorschlag) oder Scrollen zoomt?

## Prozess

- Jeder Punkt: eigene Aufgabe, ein Commit `Mxx: <titel>` bzw. Changelog-Buchstabe, Tests,
  unabhängiges Review nach `docs/quality.md`. Der Reviewer prüft **jede** Abnahme-Checkbox und
  design-rules §11.
- **Testskript für den Tester** (nach jedem P0/P1-Paket, je „klappt / hakt“ + ein Satz):
  1. Neue Notiz anlegen, Titel im Panel ändern, Text schreiben.
  2. Notiz in eine Zone ziehen und die Zone samt Notiz verschieben.
  3. Checklisten-Punkt abhaken und umbenennen, ohne den Block zu verschieben.
  4. Drei Karten auswählen, gemeinsam verschieben, rückgängig machen.
  5. Reload: alles steht und heisst wie vorher, die Ansicht ist dieselbe.

## Auftragstext für den Agenten (zum Kopieren)

```text
Du setzt genau EINEN Punkt aus docs/canvas-polish.md um: <ID>.
Lies zuerst: AGENTS.md, ARCHITECTURE.md, docs/design-rules.md, in canvas-polish.md den
Abschnitt "Querschnitt" und den Punkt <ID>, dann jede Datei unter "Dateien".
Regeln:
- Ändere NUR die Dateien unter "Dateien". Brauchst du eine andere: STOPP, frag.
- Halte jede Zahl aus "Soll" exakt ein. Keine eigenen Werte, keine eigenen Farben.
- Halte jede Regel aus docs/design-rules.md ein. "NIE" ist nie.
- Keine neue Abhängigkeit. Keine bestehenden Tests ändern. Keine TODOs.
- Unklar? Schreib es in open_questions und bau es NICHT.
Liefere:
1. Code + neue Tests (tests/e2e/canvas-<id>.spec.ts, ggf. Unit-Tests).
2. Vorher/Nachher-Screenshots 1440x900 und 390x844 unter reviews/evidence/.
3. Ausgabe von: npm run lint && npm run typecheck && npm run test:unit und der neuen e2e-Spec.
4. Jede Abnahme-Checkbox des Punkts und design-rules §11 einzeln: ✓/✗ + ein Satz.
5. Changelog: npm run changelog -- "<English summary>".
6. open_questions (oder "keine").
```
