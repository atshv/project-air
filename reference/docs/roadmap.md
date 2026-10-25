# Erweiterungen – was dazukommt

Stand 2026-10-25 · **Owner-Entscheid:** Diese Punkte waren v1-Nicht-Ziele in
`ARCHITECTURE.md` und kommen dazu. Die Reihenfolge unten ist der Vorschlag; ob etwas noch
in v1 soll oder direkt danach, entscheidet der Owner (offene Punkte am Ende).

## Überblick

| ID | Erweiterung | Phase | Aufwand | Braucht vorher |
| --- | --- | --- | --- | --- |
| E1 | Freies Drag-to-Connect (Kanten per Ziehen zwischen Karten) | A | M | ADR, Migration, RLS |
| E2 | Teilen-Links (Board lesen, optional kommentieren) | A | M–L | ADR, Share-Token + enge Lese-Policy, Datenschutznotiz |
| E3 | Kanban-Automation (Spalten/Status, Regeln) | A | M | ADR, Konzept, evtl. Karten-Daten erweitern |
| E4 | Echtzeit-Zusammenarbeit (mehrere Personen, Presence) | B | L | ADR, Supabase Realtime, Konfliktstrategie |
| E5 | Offline (lokale Queue, Sync, Konflikte) | B | L | ADR, PWA/IndexedDB, Sync-Queue, RLS-Fragen |
| E6 | Native Apps (iOS/Android) | C | XL | API-first-Entscheid, App-Store-Prozess, Budget |

Aufwand: **M** ≈ 1–2 Tage, **L** ≈ 3–5 Tage, **XL** = eigenes Projekt. Phasen:
**A** = direkt nach v1 (lokal begrenzt, grosse Wirkung), **B** = v2 (ändert das Grundmodell),
**C** = späterer Produktzweig.

## Die einzelnen Punkte

### E1 – Freies Drag-to-Connect

- **Heute:** Linien entstehen nur aus `[[Links]]` im Notiztext (M12).
- **Wird:** Zwei Karten per Ziehen von einem Anker verbinden; die Verbindung wird gespeichert,
  beschriftbar (z. B. „gehört zu“, „widerspricht“), löschbar. Wiki-Links bleiben der
  inhaltliche Weg, freie Kanten sind der visuelle.
- **Braucht:** ADR (Kanten sind ein eigenes Objekt, nicht aus Text abgeleitet), Migration
  `canvas_edges` mit `user_id`/`board_id`, RLS, Tests mit fremden Boards.

### E2 – Teilen-Links

- **Heute:** Boards sind strikt privat; es gibt keinen Weg, jemandem einen Blick zu geben.
- **Wird:** Ein Board per Link teilen: standardmässig **nur lesen**, mit Ablaufdatum und
  Widerruf; optional später Kommentare. Kein Konto nötig, aber kein Schreibzugriff ohne
  Einladung.
- **Braucht:** ADR, Tabelle `share_links` (opakes Token, `board_id`, Ablauf, widerrufen),
  eine enge Lese-Policy statt Service-Role (AD-5 bleibt), Datenschutznotiz (M23), keine
  Secrets in der URL.
- **Risiko:** Eine Share-Policy darf nie versehentlich Schreibzugriff oder andere Boards
  öffnen; Cross-Tenant-Tests sind Pflicht.

### E3 – Kanban-Automation

- **Heute:** Spalten sind ein Block zum Ablegen von Einträgen (M28); keine Regeln.
- **Wird:** Karten/Notizen als Karten in Spalten mit Status; einfache Regeln beim Verschieben
  (Status setzen, Checkliste abhaken, Datum/Fälligkeit). Bewusst wenige, ruhige Regeln statt
  eines Regel-Studios.
- **Braucht:** ADR + UX-Konzept (widerspricht sonst dem „ruhigen“ Anspruch), Entscheidung, ob
  Status an Karten oder an Spalten hängt, Tests für Regel-Auslösung.

### E4 – Echtzeit-Zusammenarbeit

- **Heute:** Ein Konto pro Person, eine Sitzung, alles serverseitig gespeichert.
- **Wird:** Mehrere Personen sehen Änderungen live, mit Presence (wer ist da, wo arbeitet
  jemand) und klaren Konfliktregeln.
- **Braucht:** ADR (Konfliktstrategie: Last-Write-Wins mit Warnung oder CRDT), Supabase
  Realtime, Anpassung der Schreibpfade, Tests mit zwei Clients, neue Grenzen bei
  Coach-Budget und Limits.

### E5 – Offline

- **Heute:** „nur online“ (ARCHITECTURE Randbedingung); jede Änderung geht direkt zur DB.
- **Wird:** Die App lädt zuletzt gesehene Boards offline; Änderungen landen in einer lokalen
  Queue und synchronisieren later. Konflikte werden sichtbar gemacht, nie still überschrieben.
- **Braucht:** ADR, PWA/Service Worker, IndexedDB, Sync-Queue, Konfliktprotokoll,
  Entscheidung „offline nur lesen“ oder „auch schreiben“ (Empfehlung: zuerst nur lesen).

### E6 – Native Apps

- **Heute:** Nur Web, aktuelle Desktop-Browser.
- **Wird:** iPhone/iPad/Android-Apps mit den Kernwegen (Erfassen, Leinwand, Coach).
- **Braucht:** API-first-Entscheid (die Web-App als Client einer öffentlichen API), App-Store-
  Prozess, eigenes Budget; erst sinnvoll, wenn E4/E5 stehen.

## Warum diese Reihenfolge

1. **E1–E3** sind lokal begrenzt, passen zur bestehenden Architektur (Supabase, RLS, Next) und
   bringen sofort sichtbaren Nutzen.
2. **E4–E5** ändern das Grundmodell (mehrere Clients, Quelle der Wahrheit, Konflikte) und
   brauchen eine stabile Datenbasis sowie die ADRs aus E1–E3 als Vorarbeit.
3. **E6** ist ein eigener Produktzweig und hängt an einer API-/Client-Entscheidung.

## Auswirkungen auf bestehende Festlegungen

- `ARCHITECTURE.md` „Nicht-Ziele“: diese sechs Punkte sind dort entfernt und hierher verwiesen.
- Die Randbedingung „nur online“ gilt für v1 weiter; E5 hebt sie erst mit eigenem ADR auf.
- AD-5/AD-9 (RLS, private Dateien) bleiben: E2 bekommt eine eigene, enge Lese-Policy statt
  Service-Role; geteilte Boards bleiben privat, nur das Token öffnet den Leseblick.
- AD-1 (eine Notiz, ein Inhalt) bleibt; E4/E5 definieren Konflikte auf Notizinhalte im ADR.
- Termin/Budget (v1: 16–20 Wochen, wenige Stunden/Woche): Wenn E1–E3 noch in v1 sollen,
  verschiebt sich der v1-Termin. Empfehlung: v1 wie geplant abschliessen, E1–E3 direkt danach.

## Offene Entscheidungen für den Owner

1. Sollen **E1–E3 noch in v1** oder direkt nach v1? (Empfehlung: danach.)
2. **E4:** Konfliktstrategie einfach (Last-Write-Wins mit Warnung) oder CRDT? Wie viele
   gleichzeitige Personen müssen es sein?
3. **E5:** Offline zuerst nur lesen oder auch schreiben (Queue)?
4. **E6:** wirklich native Apps oder zuerst eine installierbare PWA?
5. **E2:** Teilen nur lesen oder auch bearbeiten? Ablaufdatum Standard (z. B. 7 Tage)?

## Prozess

- Jede Erweiterung braucht vor dem Code ein ADR und die Owner-Freigabe.
- Danach wie jede Aufgabe: Brief, Migration + RLS-Tests, Unit-/E2E-Tests, Review,
  Changelog-Buchstabe.
- Nach v1 werden die Punkte als Aufgaben im Board geplant (Reihenfolge E1 → E2 → E3 → …).

## Referenzen

- Leinwand-Feinschliff: `docs/canvas-polish.md` (C1–C13)
- Architektur und Nicht-Ziele: `ARCHITECTURE.md`
- Entscheidungen: `docs/adr/`
