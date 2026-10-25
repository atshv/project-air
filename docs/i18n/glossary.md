# Glossary (German / English)

One term per thing. Every German message value and every English key uses the term from this
table; a synonym in a message is a finding in review. Locale: `de-DE`, Du-Form, always `ss`
(never the German sharp-s character). Style rules: `docs/i18n/style-de.md`.

## Product objects

| German | English | Meaning |
| --- | --- | --- |
| Board | Board | a board that holds cards; the German word stays "Board" |
| Leinwand | Canvas | the visible surface of a board |
| Karte | Card | the placement of a note on a board (AD-4) |
| Notiz | Note | the content itself, independent of a board |
| Notizinhalt | Note content | the text inside a note |
| Zone | Zone | a named area on the canvas that can group cards |
| Block | Block | checklist, palette, columns, timeline or table |
| Checkliste | Checklist | block with items and a done state |
| Palette | Palette | block with named colours |
| Spalten | Columns | block with vertical columns |
| Zeitstrahl | Timeline | block with phases over time |
| Tabelle | Table | block with rows and columns |
| Quelle | Source | a linked external source |
| Bild | Image | an image card |
| Datei | File | an uploaded file card |
| Backlink | Backlink | a note that links to this note |
| Coach | Coach | the AI feature; the coach never writes user text (AD-6) |

## Canvas chrome and actions

| German | English | Meaning |
| --- | --- | --- |
| Werkzeugleiste | Toolbar | floating icon bar at the top centre |
| Ansicht steuern | View controls | zoom and fit controls |
| Alles anzeigen | Show all | fit the view to the board |
| Vergrössern | Zoom in | enlarge the view |
| Verkleinern | Zoom out | shrink the view |
| Seitenpanel | Side panel | panel on the right that overlaps the canvas |
| Auswahl | Selection | selected cards; the count comes from the ICU plural message |
| Verbinden | Connect | draw an edge between two cards |
| Hinzufügen | Add | create a new card or block |
| Entfernen | Remove | take a card or block off the board |
| Löschen | Delete | delete content after confirmation |
| Speichern | Save | write a change |
| Gespeichert | Saved | the server confirmed the write |
| Abbrechen | Cancel | close without a change |
| Schliessen | Close | close a panel, menu or dialog |

## States and messages

| German | English | Meaning |
| --- | --- | --- |
| Ruhe | Rest | no pointer, no focus |
| Hover | Hover | pointer over an element |
| Gedrückt | Pressed | pointer down |
| Fokus | Focus | keyboard focus; never removed |
| Ausgewählt | Selected | the person's own selection |
| Deaktiviert | Disabled | the element cannot be used |
| Speichert … | Saving … | a write is running |
| Nicht gespeichert | Not saved | a write failed; the person can retry |
| Fehler | Error | a failure with a next step |
| Hinweis | Hint | calm, non-blocking explanation |

## Typography rules for these terms

- Button labels: verb first, at most two words ("Notiz hinzufügen", "Alles anzeigen").
- Tooltips: at most three words.
- Error messages: one sentence plus the next step ("Speichern fehlgeschlagen. Bitte erneut
  versuchen.").
- No technical terms (node, block ID, payload); no exclamation marks; no "Ups".
- Never mix "Notiz" and "Karte" for the same thing: a note is the content, a card is its placement.
