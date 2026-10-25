export const PLACEHOLDER = {
  headline: "Project air",
  sentence:
    "Notizen auf einer ruhigen Leinwand – mit einem Coach, der Fragen stellt.",
  description: "Notizen auf einer ruhigen Leinwand.",
} as const;

export const AUTH = {
  loginTitle: "Anmelden – Project air",
  signupTitle: "Konto erstellen",
  emailLabel: "E-Mail",
  passwordLabel: "Passwort",
  loginButton: "Anmelden",
  signupButton: "Konto erstellen",
  toSignup: "Noch kein Konto? Registrieren",
  toLogin: "Bereits ein Konto? Anmelden",
  invalidCredentials:
    "Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.",
  emailTaken: "Für diese E-Mail existiert bereits ein Konto.",
  emptyFields: "Bitte E-Mail und Passwort eingeben.",
  genericError: "Etwas ist schiefgelaufen. Bitte erneut versuchen.",
  passwordConfirmLabel: "Passwort bestätigen",
  passwordHint: "Mindestens 8 Zeichen.",
  emptySignupFields: "Bitte E-Mail und beide Passwortfelder ausfüllen.",
  passwordTooShort: "Das Passwort muss mindestens 8 Zeichen lang sein.",
  passwordMismatch: "Die Passwörter stimmen nicht überein.",
  weakPassword: "Dieses Passwort ist zu schwach. Bitte wähle ein anderes.",
  rememberLabel: "Angemeldet bleiben",
  checkEmailTitle: "Bestätige deine E-Mail",
  checkEmailBefore: "Wir haben einen Bestätigungslink an ",
  checkEmailAfter:
    " geschickt. Öffne ihn, um dein Konto zu aktivieren. Schau auch im Spam-Ordner nach.",
  resendButton: "E-Mail erneut senden",
  resendDone: "Wir haben dir eine neue E-Mail geschickt.",
  resendError:
    "Die E-Mail konnte nicht gesendet werden. Bitte warte kurz und versuche es erneut.",
  emailNotConfirmed:
    "Bitte bestätige zuerst deine E-Mail-Adresse. Den Link findest du in deinem Postfach.",
  confirmFailed:
    "Der Bestätigungslink ist ungültig oder abgelaufen. Falls du die E-Mail schon bestätigt hast, melde dich einfach an.",
  forgotLink: "Passwort vergessen?",
  forgotTitle: "Passwort zurücksetzen",
  forgotText:
    "Gib die E-Mail-Adresse deines Kontos ein. Wir schicken dir einen Link, mit dem du ein neues Passwort festlegst.",
  forgotButton: "Link senden",
  forgotEmpty: "Bitte gib deine E-Mail-Adresse ein.",
  forgotSentBefore: "Falls ein Konto für ",
  forgotSentAfter:
    " existiert, haben wir dir einen Link zum Zurücksetzen geschickt. Schau auch im Spam-Ordner nach.",
  forgotError:
    "Die E-Mail konnte nicht gesendet werden. Bitte warte kurz und versuche es erneut.",
  resetTitle: "Neues Passwort festlegen",
  newPasswordLabel: "Neues Passwort",
  resetButton: "Passwort speichern",
  samePassword: "Das neue Passwort muss sich vom bisherigen unterscheiden.",
  resetFailed:
    "Der Link zum Zurücksetzen ist ungültig oder abgelaufen. Fordere einfach einen neuen an.",
} as const;

export const LIBRARY = {
  pageTitle: "Bibliothek",
  pageHint: "Deine Notizen an einem Ort – durchsuche sie nach Titel.",
  createTitle: "Neue Notiz",
  titleLabel: "Notiz-Titel",
  titlePlaceholder: "Zum Beispiel: Karteikarten",
  createButton: "Notiz erstellen",
  searchLabel: "Notizen suchen",
  searchPlaceholder: "Titel durchsuchen",
  listHeading: "Deine Notizen",
  empty: "Noch keine Notizen",
  emptyHint: "Erstelle deine erste Notiz.",
  noMatches: "Keine Notizen gefunden.",
  rename: "Umbenennen",
  renameLabel: "Neuer Titel",
  renameSave: "Speichern",
  cancel: "Abbrechen",
  delete: "Löschen",
  deleteConfirm: "Notiz wirklich löschen?",
  deleteWarning:
    "Der Inhalt der Notiz wird entfernt. Boards bleiben unverändert.",
  deleteConfirmButton: "Ja, löschen",
  errors: {
    emptyTitle: "Bitte einen Titel eingeben.",
    tooLong: "Der Titel darf höchstens 120 Zeichen lang sein.",
    notFound: "Die Notiz wurde nicht gefunden.",
    generic: "Etwas ist schiefgelaufen. Bitte erneut versuchen.",
  },
} as const;

export const BOARDS = {
  pageTitle: "Boards",
  pageHint: "Sammle Notizen auf Boards – an einem ruhigen Ort.",
  createTitle: "Neues Board",
  titleLabel: "Board-Titel",
  titlePlaceholder: "Zum Beispiel: Lernen im Herbst",
  createButton: "Board erstellen",
  listHeading: "Deine Boards",
  empty: "Noch keine Boards",
  emptyHint: "Erstelle dein erstes Board, um Notizen zu sammeln.",
  rename: "Umbenennen",
  renameLabel: "Neuer Titel",
  renameSave: "Speichern",
  cancel: "Abbrechen",
  delete: "Löschen",
  deleteConfirm: "Board wirklich löschen?",
  deleteWarning:
    "Das Board und seine Karten werden entfernt. Deine Notizen bleiben erhalten.",
  deleteConfirmButton: "Ja, löschen",
  errors: {
    emptyTitle: "Bitte einen Titel eingeben.",
    tooLong: "Der Titel darf höchstens 120 Zeichen lang sein.",
    notFound: "Das Board wurde nicht gefunden.",
    generic: "Etwas ist schiefgelaufen. Bitte erneut versuchen.",
  },
} as const;

export const SHELL = {
  brand: "Project air",
  boards: "Boards",
  boardsEmpty: "Noch keine Boards",
  newBoard: "Board erstellen",
  manageBoards: "Boards verwalten",
  areas: "Bereiche",
  templates: "Vorlagen",
  library: "Bibliothek",
  startWithTemplate: "Mit Vorlage starten",
  openBoard: "Leinwand öffnen",
  coach: "Coach",
  logout: "Abmelden",
  drawerToggle: "Boards öffnen und schließen",
  headline: "Deine Leinwand ist bereit.",
  hint: "Öffne oder erstelle ein Board, um Notizen zu sammeln.",
  account: "Konto",
  search: {
    open: "Suche öffnen",
    dialogLabel: "Suche",
    inputLabel: "Notizen durchsuchen",
    placeholder: "Suchen",
    resultsLabel: "Suchergebnisse",
    hint: "Tippe, um Notizen zu durchsuchen.",
    keyboardHint: "↑/↓ wählen · Enter öffnen · Esc schließen",
    pending: "Suche …",
    empty: "Keine Notizen gefunden.",
    error: "Die Suche ist fehlgeschlagen. Bitte erneut versuchen.",
    noCard: "Nicht auf einem Board",
    untitled: "Ohne Titel",
  },
} as const;

export const COACH = {
  close: "Schließen",
  noCard: "Öffne eine Notiz auf einem Board, um sie prüfen zu lassen.",
  reviewButton: "Diese Notiz prüfen",
  pending: "Der Coach prüft deine Notiz …",
  worksWell: "Das gelingt dir",
  gaps: "Fragen und Lücken",
  tip: "Lerntipp",
  reviewLabel: "Coach-Prüfung",
  limit:
    "Das Tageslimit für Coach-Anfragen ist erreicht. Bitte morgen erneut versuchen.",
  notFound: "Die Notiz wurde nicht gefunden.",
  error: "Der Coach konnte die Notiz nicht prüfen. Bitte erneut versuchen.",
  connections: {
    heading: "Verbindungen",
    findButton: "Verbindungen finden",
    pending: "Der Coach sucht Verbindungen …",
    empty: "Keine Verbindungen gefunden.",
    noCandidates: "Es gibt noch keine anderen Notizen zum Verknüpfen.",
    limit:
      "Das Tageslimit für Coach-Anfragen ist erreicht. Bitte morgen erneut versuchen.",
    notFound: "Die Notiz wurde nicht gefunden.",
    error: "Der Coach konnte keine Verbindungen finden. Bitte erneut versuchen.",
    accept: "Link einfügen",
    accepting: "Wird eingefügt …",
    accepted: "Link eingefügt",
    success: "Link eingefügt.",
    acceptFailed: "Der Link konnte nicht eingefügt werden. Bitte erneut versuchen.",
    acceptNotFound: "Die Notiz wurde nicht gefunden.",
  },
  starter: {
    heading: "Startkarten",
    topicLabel: "Thema",
    topicPlaceholder: "Zum Beispiel: Prüfungsvorbereitung",
    suggestButton: "Startkarten vorschlagen",
    pending: "Der Coach schlägt Startkarten vor …",
    empty: "Alle Vorschläge wurden behalten.",
    limit:
      "Das Tageslimit für Coach-Anfragen ist erreicht. Bitte morgen erneut versuchen.",
    notFound: "Das Board wurde nicht gefunden.",
    error:
      "Der Coach konnte keine Startkarten vorschlagen. Bitte erneut versuchen.",
    topicEmpty: "Bitte gib ein Thema ein.",
    topicTooLong: "Das Thema darf höchstens 120 Zeichen lang sein.",
    invalidTopic: "Bitte prüfe das Thema (1–120 Zeichen).",
    questionsLabel: "Leitfragen",
    keep: "Behalten",
    keeping: "Wird behalten …",
    success: "Startkarte behalten.",
    acceptFailed:
      "Die Startkarte konnte nicht behalten werden. Bitte erneut versuchen.",
    acceptNotFound: "Das Board wurde nicht gefunden.",
  },
  proposals: {
    summaryHeading: "Zusammenfassung",
    summariseButton: "Zusammenfassen",
    summarising: "Der Coach fasst die Notiz zusammen …",
    summaryLabel: "Zusammenfassungs-Vorschlag",
    groupHeading: "Themen",
    groupButton: "Themen gruppieren",
    grouping: "Der Coach gruppiert die Notizen …",
    groupLabel: "Gruppen-Vorschlag",
    draftMarker: "KI-Entwurf",
    accept: "Annehmen",
    discard: "Verwerfen",
    accepting: "Wird angenommen …",
    discarding: "Wird verworfen …",
    accepted: "Angenommen",
    discarded: "Verworfen",
    successAccepted: "Vorschlag angenommen.",
    successDiscarded: "Vorschlag verworfen.",
    summaryLimit:
      "Das Tageslimit für Coach-Anfragen ist erreicht. Zusammenfassen ist gerade nicht möglich. Bitte morgen erneut versuchen.",
    groupLimit:
      "Das Tageslimit für Coach-Anfragen ist erreicht. Themen gruppieren ist gerade nicht möglich. Bitte morgen erneut versuchen.",
    notFound: "Board oder Notiz wurde nicht gefunden.",
    error:
      "Der Coach konnte keinen Vorschlag erstellen. Bitte erneut versuchen.",
    decideFailed:
      "Der Vorschlag konnte nicht bearbeitet werden. Bitte erneut versuchen.",
    noDecision: "Der Vorschlag ist nicht mehr offen.",
  },
  limits: {
    label: "Coach-Limits",
    loading: "Limits werden geladen …",
    requests: "Noch {remaining} von {cap} Anfragen",
    budget: "{remainingUsd} von {capUsd} USD übrig",
    error:
      "Die Limits konnten nicht geladen werden. Du kannst den Coach weiter nutzen.",
    blockedDaily:
      "Das Tageslimit von {cap} Coach-Anfragen ist erreicht. Bitte morgen erneut versuchen.",
    blockedGlobal:
      "Das Monatsbudget von {capUsd} USD ist erreicht. Bitte nächsten Monat erneut versuchen.",
  },
  template: {
    heading: "Vorlagen-Leitfaden",
    openingLabel: "Einstiegsfrage",
    stepsLabel: "Zone für Zone",
    zoneLabel: "Zone",
    suggestionsLabel: "Vorschläge",
    questionsLabel: "Fragen",
    suggestionsOnly: "Nur Vorschläge – du entscheidest, was du notierst.",
    loading: "Der Coach öffnet den Leitfaden …",
    limit:
      "Das Tageslimit für Coach-Anfragen ist erreicht. Der Leitfaden ist gerade nicht verfügbar. Bitte morgen erneut versuchen.",
    error:
      "Der Coach konnte den Leitfaden nicht öffnen. Bitte erneut versuchen.",
    retry: "Erneut versuchen",
  },
} as const;

export const EXPORT = {
  sectionLabel: "Daten",
  export: "Exportieren",
  exportHint: "Alle Notizen als Markdown-ZIP herunterladen.",
  import: "Importieren",
  importHint: "Eine Project air-ZIP importieren.",
  pending: "Wird importiert …",
  success: "Import abgeschlossen.",
  errors: {
    unauthorized: "Bitte melde dich erneut an.",
    invalid: "Die Datei ist keine gültige Project air-ZIP.",
    too_large: "Die Datei ist zu groß (max. 20 MB).",
    failed: "Der Import ist fehlgeschlagen. Bitte erneut versuchen.",
  },
} as const;

export const CANVAS = {
  canvasLabel: "Leinwand",
  toolbarLabel: "Werkzeuge",
  connectionLabel: "Verbindung",
  empty: "Dieses Board ist noch leer.",
  emptyHint: "Füge über „Notiz hinzufügen“ deine erste Karte hinzu.",
  notFoundTitle: "Board nicht gefunden",
  notFoundHint: "Dieses Board gibt es nicht oder es gehört nicht zu deinem Konto.",
  backToBoards: "Zu deinen Boards",
  untitled: "Ohne Titel",
  kind: {
    note: "Notiz",
    source: "Quelle",
    image: "Bild",
  },
  controls: {
    zoomIn: "Vergrößern",
    zoomOut: "Verkleinern",
    fitView: "Alles anzeigen",
    interactive: "Bearbeiten ein- oder ausschalten",
    controlsLabel: "Ansicht steuern",
  },
  newCardTitle: "Neue Notiz",
  addCard: "Notiz hinzufügen",
  removeCard: "Karte entfernen",
  errors: {
    positionInvalid: "Die Position ist ungültig.",
    createFailed:
      "Die Karte konnte nicht erstellt werden. Bitte erneut versuchen.",
    moveFailed:
      "Die Position konnte nicht gespeichert werden. Bitte erneut versuchen.",
    removeFailed:
      "Die Karte konnte nicht entfernt werden. Bitte erneut versuchen.",
    notFound: "Die Karte wurde nicht gefunden.",
    boardNotFound: "Das Board wurde nicht gefunden.",
  },
  errorGeneric: "Das Board konnte nicht geladen werden. Bitte erneut versuchen.",
} as const;

export const CAPTURE = {
  trigger: "Gedanken erfassen",
  dialogLabel: "Gedanken erfassen",
  inputLabel: "Dein Gedanke",
  placeholder: "Was möchtest du festhalten?",
  hint: "Cmd/Ctrl+Enter speichern · Escape schließen",
  submit: "Notiz anlegen",
  cancel: "Abbrechen",
  pending: "Wird gespeichert …",
  success: "Notiz auf dem Board abgelegt.",
  errors: {
    empty: "Bitte einen Gedanken eingeben.",
    tooLong: "Der Gedanke darf höchstens 2000 Zeichen lang sein.",
    notFound: "Das Board wurde nicht gefunden.",
    generic: "Der Gedanke konnte nicht gespeichert werden. Bitte erneut versuchen.",
  },
} as const;

export const CARDS = {
  addSource: "Quelle",
  addImage: "Bild",
  source: {
    title: "Quelle hinzufügen",
    urlLabel: "Link",
    urlPlaceholder: "https://…",
    titleLabel: "Titel",
    titlePlaceholder: "Worum geht es?",
    quoteLabel: "Zitat",
    quotePlaceholder: "Wichtige Stelle …",
    submit: "Quelle anlegen",
    cancel: "Abbrechen",
    pending: "Wird gespeichert …",
    hint: "Nur http/https-Links · Titel max. 120 · Zitat max. 500 Zeichen",
    errors: {
      invalid:
        "Bitte einen gültigen http/https-Link und höchstens 120/500 Zeichen eingeben.",
      notFound: "Das Board wurde nicht gefunden.",
      generic:
        "Die Quelle konnte nicht gespeichert werden. Bitte erneut versuchen.",
    },
  },
  image: {
    title: "Bild hinzufügen",
    fileLabel: "Bilddatei",
    altLabel: "Alternativtext",
    altPlaceholder: "Was zeigt das Bild?",
    submit: "Bild hochladen",
    cancel: "Abbrechen",
    pending: "Wird hochgeladen …",
    hint: "PNG, JPEG oder WebP, höchstens 5 MB",
    noFile: "Bitte eine Bilddatei wählen.",
    errors: {
      unauthorized: "Bitte melde dich erneut an.",
      invalid: "Die Bilddatei ist ungültig.",
      wrong_type: "Nur PNG, JPEG oder WebP sind erlaubt.",
      too_large: "Das Bild ist zu groß (max. 5 MB).",
      not_found: "Das Board wurde nicht gefunden.",
      failed: "Das Bild konnte nicht gespeichert werden. Bitte erneut versuchen.",
    },
  },
} as const;

export const LANDING = {
  skipToContent: "Zum Inhalt springen",
  meta: {
    title: "Project air – Notizen, Dateien und Ideen auf einer Leinwand",
    description:
      "Project air sammelt Notizen, Dateien und Ideen auf einer ruhigen Leinwand. Claude hilft beim Ordnen, wenn du es willst.",
  },
  nav: {
    logo: "Project air",
    links: [
      { label: "Funktionen", href: "#funktionen" },
      { label: "Vorlagen", href: "#vorlagen" },
      { label: "Für wen", href: "#fuer-wen" },
      { label: "Preise", href: "#preise" },
      { label: "Fragen", href: "#fragen" },
    ],
    login: "Anmelden",
    signup: "Kostenlos starten",
    menuOpen: "Menü öffnen",
    menuClose: "Menü schließen",
    menuLabel: "Hauptmenü",
  },
  hero: {
    title: "Notizen, Dateien und Ideen auf einer Leinwand.",
    subline:
      "Alles, was du sammelst, landet an einem ruhigen Ort: Notizen, PDFs, Excel-Dateien und Quellen. Verknüpfe sie zu deinem eigenen Wiki, und lass dir von Claude helfen, wenn du willst.",
    cta: "Kostenlos starten",
    secondaryCta: "So funktioniert es",
    trust: ["Kostenlos in der Testphase", "Daten in Zürich gespeichert", "Keine Kreditkarte"],
  },
  preview: {
    label: "Produktvorschau",
    tablistLabel: "Vorlage für die Vorschau",
    dropLabels: { file: "Datei", source: "Quelle", note: "Notiz" },
    connectionsHint: "passt zu",
    aiTitle: "KI-Hilfe",
    aiModel: "Claude",
    aiQuestion: "Frage an dich",
    aiConnection: "Verbindung",
    tools: {
      select: "Auswählen",
      note: "Notiz",
      source: "Quelle",
      image: "Bild",
      file: "Datei",
      connect: "Verbinden",
      zone: "Zone",
    },
    templates: {
      studium: {
        tab: "Studium",
        name: "Prüfungsvorbereitung",
        drops: { file: "Skript Kapitel 1–4.pdf", source: "Campbell Biologie, S. 214", note: "Genetik nochmals laut erklären" },
        cards: [
          { kind: "note", title: "Mitose", text: "Prophase, Metaphase, Anaphase, Telophase.", x: 9, y: 8 },
          { kind: "note", title: "Zellzyklus", text: "G1, S, G2 und M. Wo passt die Mitose hinein?", x: 42, y: 5 },
          { kind: "source", title: "Vorlesung Woche 12", host: "lernplattform.uni.ch", x: 72, y: 22 },
          { kind: "image", title: "Wandtafel Vorlesung", x: 16, y: 52 },
          { kind: "note", title: "Enzyme", text: "Senken die Aktivierungsenergie.", x: 50, y: 58 },
        ],
        review: {
          good: "Die vier Phasen sind vollständig und in der richtigen Reihenfolge.",
          gap: "Was passiert mit den Chromosomen in der Anaphase?",
          tip: "Erkläre die Phasen einmal laut, ohne auf die Notiz zu schauen.",
        },
        connection: { from: "Mitose", to: "Zellzyklus" },
      },
      unternehmen: {
        tab: "Unternehmen",
        name: "Projektplan",
        drops: { file: "Offerte Lieferant.pdf", source: "Protokoll Kickoff", note: "Beta-Termin mit Team klären" },
        cards: [
          { kind: "note", title: "Ziel", text: "Kundenportal ist im dritten Quartal live.", x: 9, y: 8 },
          { kind: "note", title: "Meilensteine", text: "Kickoff 12.04. · Beta 30.06. · Launch 15.09.", x: 42, y: 5 },
          { kind: "source", title: "Pflichtenheft v2", host: "intranet.firma.ch", x: 72, y: 22 },
          { kind: "image", title: "Whiteboard Kickoff", x: 16, y: 52 },
          { kind: "note", title: "Risiken", text: "Im Sommer fehlen zwei Leute im Team.", x: 50, y: 58 },
        ],
        review: {
          good: "Ziel und Termine sind klar und messbar.",
          gap: "Wer entscheidet, wenn die Beta später kommt?",
          tip: "Schreib zu jedem Risiko eine Gegenmassnahme.",
        },
        connection: { from: "Risiken", to: "Meilensteine" },
      },
      design: {
        tab: "Design",
        name: "Marken-Board",
        drops: { file: "Logo Entwürfe.pdf", source: "Referenz: Farbstudie", note: "Wirkt die Palette ruhig genug?" },
        cards: [
          { kind: "note", title: "Mission", text: "Wissen ruhig ordnen, ohne Druck.", x: 9, y: 8 },
          { kind: "note", title: "Tonalität", text: "Ruhig, klar, aufmerksam. Nie laut.", x: 42, y: 5 },
          { kind: "source", title: "Farbstudie Papier", host: "referenzen.studio", x: 72, y: 22 },
          { kind: "image", title: "Moodboard Material", x: 16, y: 52 },
          { kind: "note", title: "Schrift", text: "Serif für Titel, Inter für Text.", x: 50, y: 58 },
        ],
        review: {
          good: "Mission und Tonalität erzählen dieselbe Geschichte.",
          gap: "Woran erkennt man die Marke ohne Logo?",
          tip: "Teste die Palette einmal in Schwarzweiss.",
        },
        connection: { from: "Tonalität", to: "Schrift" },
      },
      architektur: {
        tab: "Architektur",
        name: "Projektbriefing",
        drops: { file: "Grundriss EG.pdf", source: "Zonenplan Stadt Zürich", note: "Nordlicht im Atelier prüfen" },
        cards: [
          { kind: "note", title: "Bauherrenziele", text: "Wohnen und Arbeiten unter einem Dach.", x: 9, y: 8 },
          { kind: "note", title: "Raumprogramm", text: "4.5 Zimmer, Atelier mit eigenem Zugang.", x: 42, y: 5 },
          { kind: "source", title: "Bau- und Zonenordnung", host: "stadt-zuerich.ch", x: 72, y: 22 },
          { kind: "image", title: "Grundstück Nordseite", x: 16, y: 52 },
          { kind: "note", title: "Konzept", text: "Licht von Norden ins Atelier.", x: 50, y: 58 },
        ],
        review: {
          good: "Ziele und Raumprogramm sind konkret.",
          gap: "Wie viel Budget ist für das Atelier vorgesehen?",
          tip: "Ordne jede Anforderung einer SIA-Phase zu.",
        },
        connection: { from: "Bauherrenziele", to: "Konzept" },
      },
    },
  },
  steps: {
    title: "So startest du",
    items: [
      {
        number: "01",
        title: "Vorlage wählen",
        body: "Starte mit einer von 42 Vorlagen statt mit einer leeren Seite. Zonen und Karten geben dir sofort Struktur.",
      },
      {
        number: "02",
        title: "Sammeln und verknüpfen",
        body: "Lege Notizen, Quellen und Dateien ab und verbinde sie mit [[Links]]. So entsteht dein Wiki, ohne Ordner zu pflegen.",
      },
      {
        number: "03",
        title: "Board wächst mit dir",
        body: "Du sammelst, verknüpfst und bearbeitest weiter. Alles bleibt an einem Ort und wird mit der Zeit zu deinem Wissensnetz.",
      },
    ],
  },
  features: {
    title: "Alles an einem Ort",
    tablistLabel: "Funktionen",
    prev: "Vorherige Funktion",
    next: "Nächste Funktion",
    items: [
      {
        tab: "Sammeln",
        title: "Ein Ort für alles",
        body: "Notizen, PDFs, Excel-Dateien, Bilder und Quellen landen als Karten auf der Leinwand. Du entscheidest, was wichtig ist, und legst es dort ab, wo es später gebraucht wird.",
        illustration: "collect",
      },
      {
        tab: "Verknüpfen",
        title: "Ein Wiki aus deinen Notizen",
        body: "[[Titel]] verbindet Notizen zu einem Wiki mit Backlinks. So siehst du, was zusammengehört, ohne Ordner zu pflegen.",
        illustration: "link",
      },
      {
        tab: "Suchen",
        title: "Finden statt suchen",
        body: "Die Volltextsuche findet Begriffe in Notizen und Dateien. Treffer zeigen dir den Kontext, statt nur eine Liste von Titeln.",
        illustration: "search",
      },
      {
        tab: "Dateien",
        title: "Unterlagen, die mitdenken",
        body: "PDFs und Excel-Dateien werden zu Karten mit Vorschau. Der Textauszug bleibt durchsuchbar, damit deine Unterlagen nicht im Ordner verschwinden.",
        illustration: "file",
      },
      {
        tab: "KI",
        title: "KI, wenn du sie brauchst",
        body: "Claude von Anthropic liest auf Wunsch mit, stellt Fragen und schlägt Verbindungen vor. Vorschläge übernimmst du nur, wenn du sie annimmst.",
        illustration: "coach",
      },
      {
        tab: "Exportieren",
        title: "Deine Inhalte bleiben deine",
        body: "Exportiere alle Notizen als Markdown-ZIP. Deine Inhalte gehören dir und lassen sich jederzeit mitnehmen.",
        illustration: "export",
      },
    ],
  },
  templatesSection: {
    title: "42 Vorlagen für deinen Start",
    subline:
      "Studium, Unternehmen, Design, Architektur: Jede Vorlage bringt Zonen und Karten mit, die du frei ändern kannst.",
    filterLabel: "Zielgruppe filtern",
    allLabel: "Alle",
    groups: [
      { value: "studium", label: "Studium" },
      { value: "unternehmen", label: "Unternehmen" },
      { value: "design", label: "Design" },
      { value: "architektur", label: "Architektur" },
    ],
    cards: [
      { name: "Prüfungsvorbereitung", group: "studium", line: "Stoffliste, Rückwärtsplan und Lernkarten für die Prüfung.", zones: ["Stoffliste", "Rückwärtsplan", "Lernkarten"] },
      { name: "Semesterplaner", group: "studium", line: "Module, Abgaben und Prüfungstermine auf einen Blick.", zones: ["Module", "Abgaben", "Termine"] },
      { name: "Projektplan", group: "unternehmen", line: "Ziel, Phasen, Meilensteine und Risiken.", zones: ["Ziel", "Phasen", "Status"] },
      { name: "Wiki-Startseite", group: "unternehmen", line: "Seitenbaum, verlinkte Karten und Rückverweise.", zones: ["Bereiche", "Links", "Rückverweise"] },
      { name: "Marken-Board", group: "design", line: "Mission, Positionierung, Palette und Schrift.", zones: ["Mission", "Palette", "Schrift"] },
      { name: "Projektbriefing", group: "architektur", line: "Bauherrenziele, Ort, Raumprogramm und Budget.", zones: ["Ziele", "Ort", "Budget"] },
    ],
    empty: "Für diese Zielgruppe sind bald weitere Vorlagen da.",
    cta: "Alle Vorlagen ansehen",
  },
  coach: {
    title: "Der Coach schreibt nicht für dich. Er bringt dich weiter.",
    body: "Der Coach liest deine Notizen wie eine aufmerksame Lernpartnerin: Er fragt nach, was fehlt, und zeigt dir, wo zwei Gedanken zusammengehören. Den Text schreibst du selbst – der Coach bringt dich weiter.",
    bullets: [
      "Stellt Fragen, die Lücken sichtbar machen.",
      "Findet Verbindungen zwischen deinen Notizen.",
      "Gibt Lerntipps, die zu deinem Thema passen.",
    ],
    cardTitle: "Coach-Feedback",
    cardWellDone: "Gut gelungen",
    cardWellDoneBody: "Du hast die Phasen der Mitose korrekt beschrieben.",
    cardQuestions: "Fragen an dich",
    cardQuestionOne: "Was passiert mit den Chromosomen in der Anaphase?",
    cardTip: "Lerntipp",
    cardTipBody: "Erkläre die Phasen einmal laut, ohne auf die Notiz zu schauen.",
  },
  comparison: {
    title: "Warum nicht einfach eine andere App?",
    intro: "Ein ehrlicher Vergleich: Was Project air kann, und wo andere Werkzeuge ihre Stärken haben.",
    featureLabel: "Funktion",
    columns: ["Project air", "Notiz-Apps", "Whiteboards", "KI-Chats"],
    rows: [
      { label: "Visuelle Leinwand für alle Inhalte", values: [true, false, true, false] },
      { label: "Wiki-Links mit Backlinks", values: [true, false, false, false] },
      { label: "PDFs und Excel durchsuchbar", values: [true, false, false, false] },
      { label: "Vorlagen mit Anleitung", values: [true, false, false, false] },
      { label: "Coach, der nie fremdschreibt", values: [true, false, false, false] },
      { label: "Daten in der Schweiz gespeichert", values: [true, false, false, false] },
    ],
    yes: "Ja",
    no: "Nein",
  },
  audience: {
    title: "Für wen ist Project air?",
    templatesLabel: "Passende Vorlagen",
    cards: [
      { title: "Studierende", body: "Prüfungsvorbereitung, Vorlesungsnotizen und Literatur an einem Ort – Claude fragt ab, statt zusammenzufassen.", templates: ["Prüfungsvorbereitung", "Semesterplaner", "Karteikarten"] },
      { title: "Unternehmen und Technik", body: "Projektdossiers, Anleitungen und Störungssuche: Wissen bleibt auffindbar, auch wenn Kolleg:innen wechseln.", templates: ["Projektplan", "Störungssuche", "Wiki-Startseite"] },
      { title: "Designer", body: "Briefing, Referenzen, Palette und Feedback-Runden, ohne dass der rote Faden verloren geht.", templates: ["Marken-Board", "Logo-Projekt", "Feedback-Runde"] },
      { title: "Architekten", body: "Projektbriefing, SIA-Phasen und Materiallisten – mit PDFs und Excel-Dateien direkt auf dem Board.", templates: ["Projektbriefing", "SIA-Phasen", "Baustellenprotokoll"] },
    ],
  },
  pricing: {
    title: "Kostenlos während der Testphase",
    badge: "Testphase",
    cardTitle: "Alles inklusive",
    subline: "Keine Kreditkarte, keine Zahlung. Die Testphase ist offen für alle.",
    items: [
      "Unbegrenzte Notizen und Boards",
      "42 Vorlagen mit Anleitung",
      "KI-Hilfe mit Claude",
      "PDF- und Excel-Karten mit Volltextsuche",
      "Wiki-Links mit Backlinks",
      "Markdown-Export deiner Inhalte",
    ],
    cta: "Kostenlos starten",
  },
  faq: {
    title: "Häufige Fragen",
    items: [
      { question: "Was ist Project air?", answer: "Eine ruhige Browser-App, in der Notizen, Dateien und Ideen als Karten auf einer Leinwand liegen und jede Notiz zugleich eine durchsuchbare Wiki-Seite ist." },
      { question: "Wie schnell kann ich starten?", answer: "Sofort: Konto erstellen, Vorlage wählen, loslegen. Die Vorlage zeigt dir, wo du anfängst." },
      { question: "Welche KI steckt dahinter?", answer: "Claude von Anthropic. Die KI ist ein Werkzeug unter vielen: Du rufst sie auf, wenn du willst, und entscheidest selbst, was du übernimmst." },
      { question: "Schreibt die KI meine Notizen?", answer: "Nein. Claude stellt Fragen, findet Verbindungen und schlägt Zusammenfassungen vor. Deinen Text ändert die KI nie ohne dich." },
      { question: "Wo liegen meine Daten?", answer: "Deine Notizen und Dateien liegen auf Servern in Zürich. Nur wenn du Claude fragst, geht der betroffene Text an den KI-Anbieter Anthropic in den US." },
      { question: "Kann ich PDFs und Excel hochladen?", answer: "Ja, PDF- und Excel-Dateien bis 20 MB werden zu Karten mit Vorschau und durchsuchbarem Textauszug." },
      { question: "Welche Vorlagen gibt es?", answer: "42 Vorlagen aus Studium, Unternehmen, Design und Architektur – jede mit Zonen und einer kurzen Anleitung." },
      { question: "Kann ich meine Daten exportieren?", answer: "Ja, alle Notizen und Links als Markdown-ZIP." },
      { question: "Kostet es etwas?", answer: "Während der Testphase ist Project air kostenlos." },
    ],
  },
  finalCta: {
    title: "Ruhig planen statt suchen.",
    subline: "Sammle dein Wissen an einem Ort. Die KI hilft, wenn du sie fragst.",
    cta: "Kostenlos starten",
  },
  footer: {
    brandText: "Notizen, Dateien und Ideen an einem ruhigen Ort.",
    columns: [
      {
        title: "Produkt",
        links: [
          { label: "Funktionen", href: "#funktionen" },
          { label: "Vorlagen", href: "#vorlagen" },
          { label: "Preise", href: "#preise" },
          { label: "Fragen", href: "#fragen" },
        ],
      },
      {
        title: "Für wen",
        links: [
          { label: "Studierende", href: "#fuer-wen" },
          { label: "Unternehmen und Technik", href: "#fuer-wen" },
          { label: "Designer", href: "#fuer-wen" },
          { label: "Architekten", href: "#fuer-wen" },
        ],
      },
      {
        title: "Rechtliches",
        links: [
          { label: "Datenschutz", href: "#" },
          { label: "Impressum", href: "#" },
          { label: "AGB", href: "#" },
        ],
      },
    ],
    copyright: "© 2026 Project air",
    residency: "Daten gespeichert in Zürich",
  },
} as const;

export const PANEL = {
  label: "Notiz",
  eyebrow: "Notiz",
  untitled: "Ohne Titel",
  close: "Schließen",
  source: {
    label: "Quelle",
    eyebrow: "Quelle",
    urlLabel: "Link",
    titleLabel: "Titel",
    quoteLabel: "Zitat",
    emptyQuote: "Kein Zitat.",
  },
  image: {
    label: "Bild",
    eyebrow: "Bild",
    altLabel: "Alternativtext",
    noAlt: "Ohne Alternativtext",
    previewFailed: "Vorschau nicht verfügbar.",
  },
  backlinks: {
    title: "Backlinks",
    empty: "Noch keine Backlinks.",
    listLabel: "Verweisende Notizen",
  },
  addToBoard: {
    title: "Auf ein anderes Board legen",
    selectLabel: "Board",
    button: "Auf Board legen",
    pending: "Wird gelegt …",
    success: "Notiz auf „{board}“ gelegt.",
    noBoards: "Erstelle zuerst ein weiteres Board, um diese Notiz zu teilen.",
    noBoardsLink: "Zu deinen Boards",
    errors: {
      duplicate: "Die Notiz liegt bereits auf diesem Board.",
      notFound: "Board oder Notiz wurde nicht gefunden.",
      generic: "Die Notiz konnte nicht gelegt werden. Bitte erneut versuchen.",
    },
  },
} as const;

export const EDITOR = {
  editorLabel: "Notizinhalt",
  placeholder: "Schreib los …",
  statusIdle: "Änderungen werden automatisch gespeichert.",
  statusSaving: "Speichert …",
  statusSaved: "Gespeichert",
  statusError: "Speichern fehlgeschlagen. Bitte erneut versuchen.",
  wikilink: {
    listLabel: "Notizen vorschlagen",
    hint: "↑/↓ wählen · Enter einfügen · Esc schließen",
    noCandidates: "Keine Notiz gefunden.",
  },
  errors: {
    invalidContent: "Der Inhalt konnte nicht gespeichert werden.",
    tooLarge: "Der Inhalt ist zu groß.",
    notFound: "Die Notiz wurde nicht gefunden.",
    saveFailed: "Speichern fehlgeschlagen. Bitte erneut versuchen.",
  },
} as const;

export const BLOCKS = {
  label: "Block",
  remove: "Block entfernen",
  buttons: {
    zone: "Zone",
    checklist: "Checkliste",
    palette: "Palette",
    columns: "Spalten",
    timeline: "Zeitstrahl",
    table: "Tabelle",
  },
  zone: {
    titleLabel: "Titel der Zone",
    toneLabel: "Farbe",
    tones: {
      neutral: "Neutral",
      sage: "Salbei",
      sand: "Sand",
      sky: "Himmel",
    },
  },
  checklist: {
    titleLabel: "Titel der Checkliste",
    titlePlaceholder: "Titel (optional)",
    itemLabel: "Punkt",
    addItem: "Punkt hinzufügen",
    defaultItem: "Neuer Punkt",
    doneLabel: "Erledigt",
  },
  palette: {
    nameLabel: "Farbname",
    hexLabel: "Farbe",
    addColor: "Farbe hinzufügen",
    removeColor: "Farbe entfernen",
    defaultName: "Neue Farbe",
    defaultColor: "#8fbfaf",
  },
  columns: {
    columnLabel: "Spalte",
    itemLabel: "Eintrag",
    addItem: "Eintrag hinzufügen",
    defaultItem: "Neuer Eintrag",
    moveLeft: "Nach links",
    moveRight: "Nach rechts",
  },
  timeline: {
    phaseTitleLabel: "Phase",
    periodLabel: "Zeitraum",
    noteLabel: "Notiz",
    addNote: "Notiz hinzufügen",
    defaultNote: "Neue Notiz",
  },
  table: {
    columnLabel: "Spaltentitel",
    cellLabel: "Zelle",
    addRow: "Zeile hinzufügen",
  },
  errors: {
    invalid: "Die Blockdaten sind ungültig.",
    notFound: "Der Block wurde nicht gefunden.",
    generic: "Der Block konnte nicht gespeichert werden. Bitte erneut versuchen.",
    createFailed:
      "Der Block konnte nicht erstellt werden. Bitte erneut versuchen.",
    removeFailed:
      "Der Block konnte nicht entfernt werden. Bitte erneut versuchen.",
    resizeFailed:
      "Die Größe konnte nicht gespeichert werden. Bitte erneut versuchen.",
    moveFailed:
      "Die Position konnte nicht gespeichert werden. Bitte erneut versuchen.",
  },
  save: {
    saving: "Speichert …",
    saved: "Gespeichert",
    error: "Nicht gespeichert",
  },
} as const;

export const FILES = {
  addFile: "Datei",
  kind: "Datei",
  open: "Datei öffnen",
  signedUrlFailed: "Die Datei konnte nicht geladen werden.",
  hint: "PDF oder XLSX, höchstens 20 MB",
  types: {
    pdf: "PDF",
    xlsx: "Excel",
  },
  panel: {
    label: "Datei",
    eyebrow: "Datei",
    nameLabel: "Dateiname",
    typeLabel: "Typ",
    sizeLabel: "Größe",
    untitled: "Ohne Titel",
  },
  preview: {
    heading: "Textauszug",
    empty: "Kein Textauszug vorhanden.",
  },
  searchKind: "Datei",
  errors: {
    unauthorized: "Bitte melde dich erneut an.",
    invalid: "Die Datei ist ungültig. Bitte prüfe Name und Inhalt.",
    wrong_type: "Nur PDF und XLSX sind erlaubt.",
    too_large: "Die Datei ist zu groß (max. 20 MB).",
    not_found: "Das Board wurde nicht gefunden.",
    failed: "Die Datei konnte nicht hochgeladen werden. Bitte erneut versuchen.",
  },
} as const;

export const TEMPLATES = {
  pageTitle: "Vorlagen",
  pageHint:
    "Starte mit einer fertigen Struktur: Zonen, Checklisten und Notizen als ruhiger Anfang.",
  skipped:
    "{count} Vorlage(n) konnten nicht geladen werden und werden übersprungen.",
  empty:
    "Noch keine Vorlagen verfügbar. Neue Vorlagen erscheinen hier, sobald sie bereitstehen.",
  noResults: "Keine Vorlage passt zu deiner Auswahl.",
  filterLabel: "Zielgruppe",
  allGroups: "Alle",
  searchLabel: "Vorlagen durchsuchen",
  searchPlaceholder: "Vorlage suchen …",
  count: "{count} von {total} Vorlagen",
  reset: "Filter zurücksetzen",
  wave: "Welle {wave}",
  zones: "{count} Zonen",
  apply: "Vorlage verwenden",
  applying: "Wird angelegt …",
  groups: {
    studium: "Studium",
    unternehmen: "Unternehmen",
    design: "Design",
    architektur: "Architektur",
  },
  errors: {
    invalid: "Die Vorlage ist ungültig.",
    notFound: "Diese Vorlage wurde nicht gefunden.",
    unauthorized: "Bitte melde dich erneut an.",
    generic: "Das Board konnte nicht angelegt werden. Bitte erneut versuchen.",
  },
} as const;
