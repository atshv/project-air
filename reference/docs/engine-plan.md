# Eigene Leinwand-Engine – C++ / WebAssembly / WebGPU

Stand 2026-10-25 · **Plan, nicht beschlossen** · ersetzt bei Umsetzung ADR-0001 (React Flow)
durch eine neue ADR-0008 · Bezug: [roadmap.md](roadmap.md) (E4 Echtzeit), [canvas-polish.md](canvas-polish.md)

> Ziel: Die Leinwand wird nicht mehr aus HTML-Elementen (React Flow) gebaut, sondern von einer
> eigenen Engine in C++ gezeichnet, die im Browser als WebAssembly läuft und über WebGPU
> (Fallback WebGL2) auf die Grafikkarte zeichnet – das Prinzip von Figma und Miro.

## 1. Kurzfazit vorweg

- **Machbar, aber gross.** Realistisch **25–35 Personenwochen Vollzeit** bis zur Parität mit
  dem heutigen Stand (React Flow + Polish-Plan). Bei wenigen Stunden pro Woche
  (`ARCHITECTURE.md`, „Zeit/Budget“) wären das **mehrere Jahre**.
- **Was es bringt:** 10.000+ Objekte flüssig, volle Kontrolle über jedes Pixel und jede Geste,
  Grundlage für Echtzeit-Zusammenarbeit mit vielen Cursorn, keine fremde Canvas-Bibliothek.
- **Was es kostet:** Text, Barrierefreiheit, Eingabefelder und Tests – heute vom Browser
  geschenkt – müssen selbst gelöst werden. Das ist der grösste Teil der Arbeit, nicht das
  Zeichnen.
- **Empfehlung:** React Flow für v1 behalten. Diesen Plan erst starten, wenn ein **Auslöser**
  (Abschnitt 3) eintritt – dann mit **Phase 0** (Spike, 2–3 Wochen) und harter
  Weiter/Stopp-Entscheidung.
- **Ab sofort sinnvoll (kostet fast nichts):** Leinwand-Logik als reine Funktionen in
  `src/logic/canvas/` schreiben (Snap, Gruppenverschieben, Kollision). Sie sind heute nutzbar
  und später die ausführbare Spezifikation für die C++-Engine (Abschnitt 10).

## 2. Ziele und Nicht-Ziele

**Messbare Ziele (Parität + Mehrwert):**

| Ziel | Heute (React Flow) | Engine-Ziel |
| --- | --- | --- |
| Objekte pro Board flüssig | 500 (D8) | **10.000** Karten + 1.000 Zonen |
| Frame-Zeit Pan/Zoom p95 | ≤ 25 ms bei 500 | **≤ 16,7 ms (60 fps)** bei 10.000 |
| Long Tasks beim Pan/Zoom | keine > 50 ms | keine > 16 ms |
| Start bis erstes Bild | – | ≤ 300 ms nach Seitenstart (Desktop, warm) |
| WASM-Download | 0 | **≤ 600 KB gzip** (Engine ohne Schriften) |
| Browser | aktuelle Desktop-Browser | gleiche; WebGPU wo vorhanden, sonst WebGL2 |

**Nicht-Ziele:** Zeichen-/Malwerkzeuge (Freihand, Formen-Editor), eigener Text-Editor für
Notizen (Tiptap bleibt im Panel), native Apps, Mobile-first, Echtzeit in den ersten Phasen.

## 3. Wann starten – Auslöser

Mindestens einer muss eintreten, sonst bleibt der Plan in der Schublade:

1. Boards mit **> 2.000 Objekten** sind ein echter Anwendungsfall und React Flow verfehlt D8
   (Benchmark nach ADR-0001).
2. **Echtzeit-Zusammenarbeit (E4)** soll mit vielen gleichzeitigen Personen laufen und der
   DOM-Ansatz wird messbar zum Engpass.
3. Ein Bedien- oder Darstellungsziel ist mit React Flow nachweislich nicht erreichbar
   (dokumentiert mit Versuch und Messung).
4. Es gibt Budget für mindestens **eine Person mit C++/Grafik-Erfahrung über 6+ Monate**.

## 4. Zielarchitektur

```text
┌──────────────────────────── Browser ─────────────────────────────┐
│ React / Next.js (src/ui)                                         │
│  ├─ Werkzeugleiste, Panel, Dialoge, Tiptap  (bleiben React/DOM)  │
│  ├─ DOM-Overlay: aktives Eingabefeld über dem bearbeiteten Block │
│  └─ A11y-/Test-Spiegel: unsichtbare DOM-Liste aller Objekte      │
│                     ▲ Ereignisse         │ Befehle               │
│ ┌───────────────────┴─ TS-Brücke ────────▼───────────────────┐   │
│ │ src/ui/canvas-engine/ (Laden, Eingaben, Befehlspuffer)     │   │
│ └───────────────────┬────────────────────▲───────────────────┘   │
│ ┌────────── C++ → WebAssembly (engine.wasm) ─────────────────┐   │
│ │ Dokument · Kamera · Raumindex · Treffertest · Gesten       │   │
│ │ Snap/Layout · Operationen {do, undo} · Render-Graph        │   │
│ │ Backends: WebGPU │ WebGL2                                  │   │
│ └────────────────────────────┬───────────────────────────────┘   │
│                         <canvas> (GPU)                           │
└──────────────────────────────────────────────────────────────────┘
   Schreiben/Lesen weiterhin über Server Actions → Logic → Data (Supabase)
```

**Grundsätze:**

- **Supabase bleibt die Wahrheit.** Die Engine hält nur eine Arbeitskopie des Boards im
  Speicher. Jede Geste erzeugt eine Operation `{do, undo}`; die TS-Brücke schickt sie über die
  bestehenden Server Actions. Schichtregel UI → Logic → Data bleibt: die Engine ist UI-Schicht
  (`src/ui/canvas-engine/`) und greift nie direkt auf Daten zu.
- **Brücke schmal und binär.** Eine kleine C-Schnittstelle (`extern "C"`) plus ein
  Befehlspuffer im WASM-Speicher (typisierte Arrays), kein Objekt-für-Objekt-Aufruf über die
  Grenze. Pro Frame höchstens ein Austausch in jede Richtung.
- **Eingaben kommen aus JS.** Pointer-, Wheel-, Touch- und Tastatur-Ereignisse werden in JS
  gesammelt, normalisiert (Trackpad vs. Mausrad) und als Puffer an die Engine gegeben. Die
  Gesten-Logik (Klick vs. Ziehen, Schwelle, Snap, Rahmenauswahl) lebt in C++.
- **Hybrid statt alles selbst:** Was der Browser gut kann, bleibt im Browser – Texteingabe,
  Panel, Dialoge, Menüs, Barrierefreiheit. Die Engine zeichnet die Fläche und alles darauf.

### 4.1 Module der Engine (C++)

| Modul | Aufgabe | Hinweise |
| --- | --- | --- |
| `doc` | Objekte (Karte, Zone, Block, Kante, Bild), IDs, Eltern-Beziehung (Zonen) | flache Arrays (Data-oriented), keine Objekt-Bäume |
| `camera` | Pan, Zoom, Umrechnung Bildschirm ↔ Welt, sanftes Zoomen | Zoom 0,1–4 |
| `spatial` | Raumindex für sichtbare Objekte und Treffertests | Grid-Hash oder R-Baum; Messung in Phase 0 |
| `hit` | Was liegt unter dem Zeiger, Griffzonen, Resize-Griffe | in Weltkoordinaten |
| `gesture` | Zustandsmaschine: Ruhe → Drücken → Ziehen/Klick → Loslassen | Schwelle 4 px, Shift frei, Pfeiltasten |
| `snap` | Raster 16 px, Einrastlinien, Gruppenverschieben | 1:1 aus `src/logic/canvas/` portiert |
| `ops` | Operationen `{do, undo}`, Verlauf (20 Schritte) | gleiche Semantik wie Polish C6 |
| `render` | Render-Graph: Hintergrund-Raster, Zonen, Kanten, Blöcke, Karten, Auswahl, Overlays | Ebenen nach `design-rules.md` §8 |
| `gpu/webgpu`, `gpu/webgl2` | zwei Backends hinter einer Schnittstelle | gleiche Shader-Logik, WGSL bzw. GLSL ES 3.0 |
| `text` | Glyphen-Atlas, Textlayout, Ellipse | siehe 4.3 |
| `image` | Bild-Texturen, Mipmaps, Detailstufen beim Zoom | lädt über signierte URLs (AD-9) |

### 4.2 Zeichnen

- **Karten und Blöcke:** instanzierte Rechtecke; Ecken-Radius, Rahmen und Schatten im Shader
  (Signed Distance Field) – ein Draw-Call für tausende Karten.
- **Kanten:** Bézier-Kurven, im Shader oder als feine Dreiecks-Streifen; Dicke unabhängig vom
  Zoom.
- **Raster:** ein Vollbild-Shader, blendet unter Zoom 0,5 aus.
- **Detailstufen (LOD):** weit herausgezoomt nur Flächen + Titelbalken, ganz nah volle Vorschau.
- **Nur zeichnen, wenn sich etwas ändert** (kein Dauer-Loop im Ruhezustand → Akku).

### 4.3 Text – der schwierigste Teil

| Option | Wie | Für | Gegen |
| --- | --- | --- | --- |
| **A (empfohlen für Start)** | Browser rastert Text per `OffscreenCanvas` in einen Atlas, Engine zeichnet Texturen | korrekte Schriften, Umlaute, Emoji, kein Zusatzcode | unscharf beim starken Zoom → Neu-Rastern pro Zoomstufe |
| B | MSDF-Schriftatlas + eigenes Layout (HarfBuzz für Shaping) | scharf in jeder Grösse, voll in C++ | grosse Abhängigkeiten, Emoji/Fallback-Schriften aufwendig |

Start mit A, B nur wenn A die Qualitätsziele verfehlt.

### 4.4 Bearbeiten, Barrierefreiheit, Tests

- **Bearbeiten:** Klick in ein Feld eines Blocks (Checkliste, Tabelle, Zonen-Titel) legt ein
  echtes HTML-Eingabefeld exakt über die Stelle (DOM-Overlay, folgt Kamera). Nach dem
  Verlassen zeichnet die Engine wieder selbst. Tiptap im Panel bleibt unverändert.
- **A11y-/Test-Spiegel:** Die Engine meldet sichtbare Objekte an eine unsichtbare DOM-Liste
  (Rolle, Name, Position, `data-kind`, `data-testid`). Screenreader und Tastatur nutzen sie;
  Playwright-Tests greifen darüber zu statt über `.react-flow__*`.
- **Bilder in Karten, Datei-Vorschauen:** Texturen; Vorschau-Panel bleibt React.

### 4.5 Werkzeuge und Auslieferung

- **Toolchain:** Emscripten + CMake. Ausgabe `public/engine/engine.<hash>.wasm` + kleines
  JS-Ladeskript, geladen nur im Client (`dynamic import`, kein SSR).
- **Build:** Vercel hat kein Emscripten. Optionen: (a) WASM in GitHub Actions bauen und als
  Artefakt einchecken (mit Prüfsumme), (b) Docker-emsdk im CI. → Owner-Entscheidung.
- **Threads:** brauchen `SharedArrayBuffer` und damit Cross-Origin-Isolation (COOP/COEP), was
  Supabase-Bilder und Fremd-Ressourcen erschwert. **Start ohne Threads.**
- **CSP:** heute keine; falls eingeführt, braucht WASM `'wasm-unsafe-eval'`.
- **Lizenzen:** nur MIT/OSS (`ARCHITECTURE.md`). Jede Bibliothek vor Aufnahme prüfen.

## 5. Phasen

Jede Phase endet mit einer **Weiter/Stopp-Entscheidung** des Owners. React Flow bleibt bis
Phase 4 die Standard-Leinwand; die Engine läuft hinter einem Schalter pro Board.

| Phase | Inhalt | Aufwand (Vollzeit) | Ende, wenn … |
| --- | --- | --- | --- |
| **0 Spike** | WASM laden, WebGPU + WebGL2 aufsetzen, 50.000 Rechtecke mit Pan/Zoom, Raumindex messen, Brücke messen | 2–3 Wo | 60 fps bei 50.000 Rechtecken auf einem Mittelklasse-Laptop, WASM ≤ 300 KB gzip, Bericht mit Zahlen |
| **1 Kern, nur lesen** | Kamera, Dokument, Raumindex, Treffertest, Karten/Zonen/Kanten/Raster zeichnen, echtes Board aus Supabase anzeigen (nur Ansicht) | 6–8 Wo | Vorlage „Design-Projekt“ sieht aus wie heute (Screenshot-Vergleich), 10.000 Karten flüssig |
| **2 Text und Bilder** | Text-Atlas (Option A), Titel/Vorschau mit Ellipse, Bilder mit LOD | 4–6 Wo | Text scharf bei Zoom 0,5–2, Umlaute/Emoji korrekt, keine Ruckler beim Nachladen |
| **3 Bearbeiten** | Gesten (Ziehen, Schwelle, Snap, Mehrfachauswahl, Grösse ändern), DOM-Overlay für Felder, Operationen + Undo, Schreiben über Server Actions | 6–8 Wo | Polish-Abnahmen C1, C7, C14, C15, C6 auf der Engine erfüllt |
| **4 Parität und Umstieg** | A11y-/Test-Spiegel, e2e-Specs auf den Spiegel umstellen (Freigabe nötig), Perf-Tests, Schalter → Standard, React Flow als Rückfall | 4–6 Wo | alle e2e und D8 grün auf der Engine; 2 Wochen Testerbetrieb ohne P0-Fehler |
| **5 Ausbau** | Echtzeit (E4: fremde Cursor, Live-Positionen), Threads, Option B Text | offen | eigene Pläne |

**Summe bis Parität (0–4): 22–31 Wochen Vollzeit**, plus Puffer für Unerwartetes ≈ 25–35.

## 6. Tests und Qualität

- **C++-Unit-Tests** für `camera`, `spatial`, `hit`, `gesture`, `snap`, `ops` (Test-Framework
  ist neue Abhängigkeit → Freigabe).
- **Gleiche Fälle wie TS:** Die Testfälle aus `tests/unit/canvas-*.test.ts` werden als
  gemeinsame JSON-Fixtures geführt und gegen TS- und C++-Implementierung geprüft.
- **Bild-Vergleichstests:** feste Szenen → Screenshot je Backend (WebGPU, WebGL2) gegen
  Referenzbilder, Toleranz in Pixeln.
- **Performance:** `npm run test:perf` erweitert um 10.000-Karten-Szene, Frame-Zeit p95.
- **Robustheit:** Gesten-Zustandsmaschine mit zufälligen Ereignisfolgen (Fuzzing).
- **GPU-Verlust:** Context-Lost/Device-Lost wird abgefangen und neu aufgebaut, ohne
  Datenverlust.

## 7. Risiken

| Risiko | Wirkung | Gegenmittel |
| --- | --- | --- |
| Text sieht schlechter aus als im Browser | Produkt wirkt billiger | Option A zuerst, früher Qualitätsvergleich in Phase 2 |
| Barrierefreiheit geht verloren | rechtliches und Nutzerproblem | A11y-Spiegel ist Pflicht in Phase 4, kein Umstieg ohne |
| WebGPU-Unterschiede zwischen Browsern | Fehler nur in Safari/Firefox | WebGL2-Rückfall, Bildvergleich je Backend |
| Zwei Leinwände parallel pflegen | doppelte Arbeit | Schalter nur bis Phase 4, Polish-Features nur noch in der Engine nach Phase 3 |
| Fehlende C++/Grafik-Erfahrung | Phasen dauern doppelt | Auslöser 4; Phase 0 als Eignungstest |
| Build-Kette (Emscripten) bricht | kein Deploy | gepinnte emsdk-Version, Artefakt mit Prüfsumme |
| Mobil/iPad-Gesten | schlechte Touch-Bedienung | Touch erst nach Parität am Desktop, eigene Abnahme |

## 8. Neue Abhängigkeiten (alle brauchen Freigabe, Lizenz vor Aufnahme prüfen)

| Werkzeug/Bibliothek | Zweck | Phase |
| --- | --- | --- |
| Emscripten (emsdk) | C++ → WebAssembly | 0 |
| CMake | Build | 0 |
| C++-Test-Framework (z. B. doctest) | Unit-Tests | 1 |
| msdfgen, HarfBuzz | nur bei Text-Option B | 5 |

WebGPU-Bindings kommen mit Emscripten; keine weitere Grafik-Bibliothek geplant.

## 9. Offene Entscheidungen für den Owner

1. **Starten überhaupt** – und welcher Auslöser (Abschnitt 3) ist erfüllt?
2. **Wer baut?** Eigene Person mit C++/Grafik-Erfahrung oder Agenten mit enger Führung?
3. **WASM-Build:** im CI bauen und einchecken oder Docker-emsdk?
4. **Text:** Option A (Browser-Atlas) zum Start bestätigen?
5. **e2e-Umbau** in Phase 4 freigeben (bestehende Specs greifen auf React Flow zu)?
6. **Mindest-Hardware** für das 60-fps-Ziel festlegen (z. B. MacBook Air M1, Mittelklasse-Windows-Laptop).

## 10. Was bis dahin passiert (kostet fast nichts, lohnt sich so oder so)

- Leinwand-Regeln (Snap, Gruppenverschieben, Kollision, Platzierung) als **reine Funktionen**
  in `src/logic/canvas/` mit Unit-Tests – nie in React-Komponenten vergraben.
- Alle Gesten als **Operationen `{do, undo}`** in `src/ui/canvas/interactions.ts` (Polish
  Querschnitt) – genau dieses Format übernimmt die Engine.
- Neue e2e-Tests über **`data-testid` und Rollen** schreiben, nicht über `.react-flow__*`-Klassen
  – dann überleben sie einen Engine-Wechsel.
- Performance-Messung (Polish C13) laufend führen – sie liefert den Auslöser 1 mit Zahlen.
