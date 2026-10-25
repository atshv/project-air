# Design-Gesetz – Leinwand und App

Stand 2026-10-25 · verbindlich für jeden Agenten (DeepSeek, Claude, andere), der UI-Code
anfasst · gehört zu [canvas-polish.md](canvas-polish.md)

> Dieses Dokument ist kein Vorschlag. **MUSS** heisst muss, **NIE** heisst nie. Wer davon
> abweichen will, schreibt die Frage in `open_questions` und baut **nicht**. Im Zweifel:
> weniger Elemente, weniger Farbe, weniger Bewegung.

## 0. Leitbild in drei Sätzen

1. **Inhalt zuerst, Werkzeug leise.** Die Notizen der Person sind das Hellste auf dem
   Bildschirm; Leisten, Rahmen und Knöpfe treten zurück (Vorbild: Figma, FigJam, tldraw).
2. **Ruhig statt bunt.** Dunkles Grün-Grau, ein Akzent (`--accent`, Salbei), sonst Grautöne.
3. **Nichts springt.** Kein Element ändert seine Position, Grösse oder seinen Text, ohne dass
   die Person es ausgelöst hat.

## 1. Arbeitsregeln für den Agenten

- **MUSS** vor dem ersten Code lesen: `AGENTS.md`, `ARCHITECTURE.md`, dieses Dokument,
  `docs/canvas-polish.md` (nur den eigenen Punkt + „Querschnitt“), die Dateien unter
  „Dateien“ im eigenen Punkt.
- **MUSS** genau **einen** Punkt (z. B. `C14`) pro Aufgabe umsetzen. Nichts „nebenbei
  mitverbessern“.
- **MUSS** jede Abnahme-Checkbox des Punktes selbst prüfen und im Ergebnis einzeln abhaken
  (✓ / ✗ + ein Satz).
- **MUSS** Screenshots **vorher und nachher** bei 1440×900 und 390×844 ablegen
  (`reviews/evidence/<ID>-before-*.png`, `…-after-*.png`).
- **MUSS** `npm run lint && npm run typecheck && npm run test:unit` grün haben und die im Punkt
  genannten e2e-Specs laufen lassen.
- **NIE** neue Abhängigkeit, **NIE** bestehende Tests ändern oder löschen, **NIE** Dateien
  ausserhalb der Liste „Dateien“ ändern. Braucht es eine weitere Datei: fragen.
- **NIE** raten. Unklar = `open_questions`, Punkt nicht als erledigt melden.
- **NIE** „TODO“, „später“, Platzhalter-Texte oder auskommentierten Code abliefern.

## 2. Farben

- **MUSS** ausschliesslich Tokens aus `src/app/globals.css` verwenden (`var(--…)`).
- **NIE** neue Hex- oder `rgba()`-Werte in Komponenten oder CSS-Modulen. Fehlt ein Ton: Frage
  stellen; neue Tokens nur in `globals.css` und nur mit Freigabe.

| Zweck | Token |
| --- | --- |
| Seitenhintergrund | `--bg` |
| Leinwandfläche | `--canvas` |
| Panels, Leisten, Menüs | `--surface` |
| Karten und Blöcke | `--card` |
| Haupttext | `--fg` |
| Nebentext, inaktive Icons | `--muted` |
| Trennlinien, Ruhe-Rahmen | `--border` |
| Hover-Rahmen, Eingabefelder | `--border-strong` |
| Hover-Fläche auf Icon-Knöpfen | `--faint` |
| Auswahl, Fokus, aktive Werkzeuge | `--accent`, `--accent-soft`, `--accent-line` |
| Fehler | `--danger` |
| Zonen-/Paletten-Töne | `--tone-a` … `--tone-e` (nur Zonen, Paletten, Kanten) |

- **Akzent sparsam:** pro Bildschirm höchstens **ein** gefüllter Akzent-Knopf (die
  Hauptaktion). Akzent sonst nur für Auswahl, Fokus und Einrastlinien.

## 3. Abstände, Grössen, Radien

- **Raster 4 px.** Erlaubte Abstände: `4, 8, 12, 16, 24, 32, 48` px. **NIE** 5, 7, 10, 13 …
- **Leinwand-Raster 16 px** (Snap, Grössen, Positionen).
- **Klickziele:** mindestens **32 × 32 px** (Maus), **44 × 44 px** bei `pointer: coarse`.

| Element | Radius | Rahmen | Schatten |
| --- | --- | --- | --- |
| Notizkarte | `--radius-md` (14) | 1 px `--border-strong` | `--card-shadow` |
| Block / Zone | `--radius-lg` (20) | 1 px `--border-strong` | `--card-shadow` |
| Icon-Knopf, Eingabefeld, Menüeintrag | `--radius-sm` (10) | – / 1 px `--border-strong` | – |
| Leiste, Menü, Tooltip | `--radius-md` / 6 px Tooltip | 1 px `--border` | `--card-shadow` |
| Text-Knopf ausserhalb der Leinwand | `--radius-pill` | 1 px `--border-strong` | – |

- **NIE** Pillen-Knöpfe **innerhalb** von Karten oder Blöcken. Dort: Icon-Knopf oder
  Textlink in `--muted`.
- **NIE** andere Schatten als `--card-shadow` und `--shadow`.

## 4. Schrift

| Rolle | Schrift | Grösse | Gewicht | Farbe |
| --- | --- | --- | --- | --- |
| Board-Titel, Panel-Titel, Leerzustand | `--font-serif` | 28 / 24 / 22 px | 400 | `--fg` |
| Karten-Titel, Block-Titel | `--font-sans` | 15 px | 600 | `--fg` |
| Fliesstext in Karten/Blöcken | `--font-sans` | 13 px, Zeilenhöhe 1.4 | 400 | `--fg` |
| Typ-Label („NOTIZ“) | `--font-sans` | 11 px, VERSALIEN, +0.1em | 600 | `--accent` |
| Status, Hinweise | `--font-sans` | 12 px | 400 | `--muted` |
| Tooltip | `--font-sans` | 12 px | 500 | `--fg` |

- **NIE** Text unter 11 px. **NIE** mehr als zwei Gewichte in einer Karte.
- Lange Titel: eine Zeile, Ellipse (`text-overflow: ellipsis`), voller Titel im Tooltip.
- **NIE** abgeschnittener Text ohne Ellipse (heute z. B. „Entwu“ in Spalten, „F…“ in Zonen).

## 5. Icons

- **MUSS** aus `src/ui/canvas/toolbar-icons.tsx` kommen (eigene SVGs, 24er Raster,
  Strich 1.6, `currentColor`, runde Enden). Neues Icon = neuer Eintrag dort, gleicher Stil.
- Icon **20 px** in einem Knopf von **36 px** (Leiste) bzw. **16 px** in **28 px** (in Karten).
- **NIE** Emoji, Unicode-Zeichen als Icon (×, ✓, →) oder Icon-Bibliotheken. Das heutige „×“
  wird durch ein Icon ersetzt.
- Icon-Knöpfe **MUSS** `aria-label` (Text aus `strings.de.ts`) und `data-label` (Tooltip)
  haben. **NIE** das native `title`-Attribut als Tooltip.

## 6. Zustände – jedes interaktive Element hat alle

| Zustand | Aussehen |
| --- | --- |
| Ruhe | wie oben definiert |
| Hover | Fläche `--faint` oder Rahmen `--border-strong`; Icon `--muted` → `--fg` |
| Gedrückt | wie Hover, zusätzlich `transform: scale(0.97)` |
| Fokus (Tastatur) | `outline: 2px solid var(--accent); outline-offset: 2px` – **NIE** entfernen |
| Ausgewählt (Karte/Block) | Rahmen 1.5 px `--accent`, äusserer Ring `0 0 0 3px var(--accent-soft)` |
| Wird gezogen | Schatten `--shadow`, Cursor `grabbing`, Deckkraft 1 (**NIE** halbtransparent) |
| Deaktiviert | Deckkraft 0.4, Cursor `default`, kein Hover |
| Speichert | Text „Speichert …“ 12 px `--muted` im Statusplatz |
| Gespeichert | „Gespeichert“ 12 px `--muted`, blendet nach 2 s auf 0 aus |
| Fehler | Text 12 px `--danger`, bleibt stehen, Eingabe bleibt erhalten |

- Bedien-Elemente **in** Karten und Blöcken (Löschen, „Punkt hinzufügen“, Farb-Knöpfe) sind
  in Ruhe **unsichtbar** (`opacity: 0`) und erscheinen bei Hover, Fokus innerhalb oder
  Auswahl. Sie bleiben per Tastatur erreichbar. Auf Touch-Geräten sind sie bei Auswahl
  sichtbar.
- Der Statusplatz hat eine **feste Höhe**, damit „Speichert …“ nichts verschiebt.

## 7. Bewegung

- Hover/Farbe: **120 ms ease**. Ein-/Ausblenden (Tooltip, Menü): **150 ms**. Panel: **180 ms
  ease-out**, nur `transform` und `opacity`.
- Tooltip erscheint nach **300 ms** Verweilen, sofort bei Tastaturfokus.
- **NIE** Bounce, Federn, Wackeln, Konfetti, animierte Zahlen.
- **NIE** Layout-Eigenschaften animieren (`width`, `height`, `top`, `left`, `margin`).
- `@media (prefers-reduced-motion: reduce)`: alle Übergänge auf 0 ms.

## 8. Ebenen (z-Reihenfolge, von unten nach oben)

1. Leinwand-Hintergrund (Punkte-Raster)
2. Zonen
3. Kanten (Verbindungen)
4. Blöcke (Checkliste, Palette, Spalten, Zeitstrahl, Tabelle)
5. Notizkarten
6. Gerade gezogenes oder ausgewähltes Element (temporär ganz oben in seiner Ebene)
7. Einrast-Hilfslinien, Auswahlrahmen
8. Leinwand-Chrome: Werkzeugleiste, Zoom-Steuerung
9. Seitenpanel
10. Kontextmenü, Tooltip
11. Dialoge, Toasts

**NIE** `z-index` > 10 in Komponenten ohne Eintrag in dieser Liste.

## 9. Leinwand-Chrome – fester Ort für alles

| Element | Ort | Abstand zum Rand |
| --- | --- | --- |
| Werkzeugleiste (Icons) | oben Mitte, schwebend | 12 px |
| Zoom-Steuerung (+, −, Alles anzeigen) | unten links, schwebend | 12 px |
| Speicher-/Fehlerhinweis der Leinwand | unten Mitte, schwebend | 12 px |
| Seitenpanel (Notiz) | rechts, **überlagert** die Leinwand, 400 px breit | 12 px |
| „Gedanken erfassen“ | bleibt, wo es ist (globale Aktion) | – |

- **NIE** weitere schwebende Elemente. **NIE** Knopfreihen über der Leinwand.
- „Alles anzeigen“ hält oben mindestens **64 px** frei, damit die Leiste keine Karte verdeckt.
- Die Zoom-Steuerung ist **vollständig sichtbar** (heute bei 900 px Höhe abgeschnitten).

## 10. Texte

- **MUSS** in `src/ui/strings.de.ts`. Du-Form. Kurz: Knopf ≤ 2 Wörter, Tooltip ≤ 3 Wörter,
  Fehlermeldung ≤ 1 Satz + was die Person tun kann.
- **NIE** Ausrufezeichen, **NIE** „Ups“, **NIE** Fachbegriffe (Node, Block-ID, Payload).
- Rechtschreibung und Begriffe wie im Bestand von `strings.de.ts` (z. B. „Schließen“,
  „Notiz“, „Zone“). **NIE** für dasselbe Ding zwei Wörter.

## 11. Abnahme jedes UI-Punkts (zusätzlich zu den Checkboxen im Punkt)

- [ ] Keine neuen Hex-/`rgba()`-Werte (`git diff | grep -E "#[0-9a-f]{3,6}|rgba\("` leer,
      ausser in `globals.css` mit Freigabe).
- [ ] Alle Abstände aus der 4-px-Reihe.
- [ ] Alle Zustände aus Abschnitt 6 vorhanden und per Tastatur erreichbar.
- [ ] Kein Text abgeschnitten ohne Ellipse; kein Text unter 11 px.
- [ ] Nichts springt beim Hover, Speichern, Öffnen oder Schliessen.
- [ ] 390 px breit: nichts ragt horizontal heraus, alles bedienbar.
- [ ] Vorher-/Nachher-Screenshots liegen unter `reviews/evidence/`.
