import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { createEngine, EngineError, type Engine, type EngineCamera, type EngineGeometry } from "../../../../packages/engine/src/bridge/engine.ts";
import { deviceKeyFor, parseViewRecord, storageKeyFor } from "../../../../packages/engine/src/bridge/view-persistence.ts";
import {
  createBoardSyncClient,
  createRequestId,
  type AutosaveEvent,
  type AutosaveStatus,
  type BoardSyncClient,
  type BoardSyncStatus,
  type RemoteParticipant,
} from "../../../../packages/sdk/src/index.ts";
import { LAYER_Z_INDEX } from "../../../../packages/ui-kit/layers.ts";
import { api } from "../auth/client.ts";
import {
  BROWSER_SESSION_TOKEN_REF,
  SAVED_VISIBLE_MS,
  connectionMessageKey,
  connectionPhase,
  cursorOpacity,
  cursorScreenPoint,
  isSessionExpired,
  presenceColor,
  presenceLabel,
  saveStatusView,
  savedStillVisible,
  selectionRects,
  syncUrl,
  worldToScreen,
} from "../board/realtime.ts";
import { toolGroups, type ToolId } from "../board/toolbar.ts";
import { createArrowBurst, arrowDelta, contextMenuModel, shortcutFor, suppressesShortcuts, undoHintKey, type FocusLike } from "../board/interactions.ts";
import { NOTE_CARD_HEIGHT, NOTE_CARD_WIDTH, buildCreateNoteCardOperation, buildDeleteOperation, buildDuplicateCardOperation, buildReorderOperation, nextCardZ } from "../board/operations.ts";
import { DEFAULT_CAMERA, backendChoice, clampCamera, zoomBy } from "../board/view.ts";
import { PANEL_PAN_MS, panelCameraForCard } from "../board/panel.ts";
import { resolveCardNote } from "../board/note.ts";
import { Button } from "../components/Button.tsx";
import { NotePanel } from "../components/NotePanel.tsx";
import { ToolbarButton } from "../components/ToolbarButton.tsx";
import sourceIcon from "../../../../packages/ui-kit/icons/source.svg";
import noteIcon from "../../../../packages/ui-kit/icons/note.svg";
import zoneIcon from "../../../../packages/ui-kit/icons/zone.svg";
import checklistIcon from "../../../../packages/ui-kit/icons/checklist.svg";
import columnsIcon from "../../../../packages/ui-kit/icons/columns.svg";
import type { Board } from "../../../../packages/sdk/src/types.ts";
import type { BoardContent } from "../../../../packages/contracts/generated/types.ts";

interface BoardPageProps { readonly t: (key: string, values?: Readonly<Record<string, string | number>>) => string; readonly language: string; readonly clientId: string; }

const ICONS: Record<string, string> = { source: sourceIcon, note: noteIcon, zone: zoneIcon, checklist: checklistIcon, columns: columnsIcon };
function projectContent(engine: Engine, content: BoardContent): void {
  const rectangles = [
    ...content.zones.map((zone) => ({ x: zone.x, y: zone.y, width: zone.width, height: zone.height, layer: "zones" as const, tone: "neutral" as const })),
    ...content.blocks.map((block) => ({ x: block.x, y: block.y, width: block.width, height: block.height, layer: "blocks" as const, tone: "neutral" as const })),
    ...content.cards.map((card) => ({ x: card.x, y: card.y, width: card.width, height: card.height, layer: "note-cards" as const, tone: "neutral" as const })),
  ];
  engine.loadRectangles(rectangles);
}
const EMPTY_CONTENT = (board: Board): BoardContent => ({ contractVersion: "0.4.0", board: { id: board.id, workspaceId: board.workspaceId, ownerId: board.ownerId, title: board.title, visibility: board.visibility, archived: board.archived, createdAt: board.createdAt, updatedAt: board.updatedAt }, zones: [], blocks: [], cards: [], notes: [], edges: [] });
function bounds(content: BoardContent): EngineGeometry {
  const objects = [...content.cards, ...content.zones, ...content.blocks];
  if (objects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const minX = Math.min(...objects.map((object) => object.x)); const minY = Math.min(...objects.map((object) => object.y));
  const maxX = Math.max(...objects.map((object) => object.x + object.width)); const maxY = Math.max(...objects.map((object) => object.y + object.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
const SAVE_DELAY_MS = 400;

export function BoardPage({ t, language, clientId }: BoardPageProps) {
  const { id } = useParams();
  const navigate = useNavigate();
  void language;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null); const syncRef = useRef<BoardSyncClient | null>(null); const cameraRef = useRef<EngineCamera>(DEFAULT_CAMERA); const saveTimer = useRef<number | null>(null); const contentRef = useRef<BoardContent | null>(null);
  const ackWaitersRef = useRef<Map<string, { resolve: () => void; reject: (error: unknown) => void }>>(new Map());
  const queuedWaitersRef = useRef<{ resolve: () => void; reject: (error: unknown) => void }[]>([]);
  const autosaveControlRef = useRef<{ retry: () => void } | null>(null);
  const selectedRef = useRef<{ kind: "card" | "zone" | "block"; id: string } | null>(null);
  // A card created by a gesture is selected once its document projection exists;
  // selecting immediately would target a card the content state does not carry yet.
  const pendingSelectionRef = useRef<string | null>(null);
  const lastPresenceCursor = useRef<{ x: number; y: number } | null>(null);
  const [state, setState] = useState<{ loading: boolean; errorKey: string | null; board: Board | null; backend: string | null; empty: boolean }>({ loading: true, errorKey: null, board: null, backend: null, empty: true });
  const [syncStatus, setSyncStatus] = useState<BoardSyncStatus>("idle");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [participants, setParticipants] = useState<readonly RemoteParticipant[]>([]);
  const [presenceSeen, setPresenceSeen] = useState<Readonly<Record<string, number>>>({});
  const [presenceNow, setPresenceNow] = useState(0);
  const [camera, setCamera] = useState<EngineCamera>(DEFAULT_CAMERA);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<ToolId>("select");
  const [selected, setSelected] = useState<{ kind: "card" | "zone" | "block"; id: string } | null>(null);
  selectedRef.current = selected;
  const [content, setContent] = useState<BoardContent | null>(null);
  const [panel, setPanel] = useState<{ cardId: string; open: boolean } | null>(null);
  const panelRef = useRef<{ cardId: string; open: boolean } | null>(null);
  panelRef.current = panel;
  const panFrameRef = useRef<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<number | null>(null);
  const burstRef = useRef<ReturnType<typeof createArrowBurst> | null>(null);

  const applyCamera = useCallback((camera: EngineCamera) => {
    const engine = engineRef.current;
    if (engine === null) return;
    cameraRef.current = clampCamera(camera);
    engine.setCamera(cameraRef.current);
    engine.visibleInstanceCount();
    setCamera(cameraRef.current);
  }, []);
  const persistCamera = useCallback(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      const boardId = id; const canvas = canvasRef.current;
      if (boardId === undefined || canvas === null) return;
      try {
        const deviceKey = deviceKeyFor(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio); void language;
        const record = { version: 1, boardId, deviceKey, ...cameraRef.current };
        window.localStorage.setItem(storageKeyFor(boardId, deviceKey), JSON.stringify(record));
      } catch { /* storage may be unavailable */ }
    }, SAVE_DELAY_MS);
  }, [id]);

  const cancelPanelPan = useCallback(() => {
    if (panFrameRef.current !== null) { window.cancelAnimationFrame(panFrameRef.current); panFrameRef.current = null; }
  }, []);
  const animateCameraTo = useCallback((target: EngineCamera, durationMs: number) => {
    cancelPanelPan();
    if (durationMs <= 0) { applyCamera(target); return; }
    const from = cameraRef.current; const startedAt = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = progress * progress * (3 - 2 * progress);
      applyCamera({ panX: from.panX + (target.panX - from.panX) * eased, panY: from.panY + (target.panY - from.panY) * eased, zoom: from.zoom + (target.zoom - from.zoom) * eased });
      panFrameRef.current = progress < 1 ? window.requestAnimationFrame(step) : null;
    };
    panFrameRef.current = window.requestAnimationFrame(step);
  }, [applyCamera, cancelPanelPan]);
  // User camera input wins over the transient L04 panel pan and is the only one persisted (L17).
  const userCamera = useCallback((camera: EngineCamera) => {
    cancelPanelPan();
    applyCamera(camera);
    persistCamera();
  }, [applyCamera, cancelPanelPan, persistCamera]);
  const closePanel = useCallback(() => {
    setPanel((current) => (current === null || !current.open ? current : { ...current, open: false }));
  }, []);
  const openPanelForCard = useCallback((cardId: string) => {
    const existing = contentRef.current?.cards.find((card) => card.id === cardId);
    if (existing === undefined) return;
    setPanel({ cardId, open: true });
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const target = panelCameraForCard({ camera: cameraRef.current, card: existing, viewportWidth: canvas.clientWidth });
    if (target === null) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    animateCameraTo(target, reduced ? 0 : PANEL_PAN_MS);
  }, [animateCameraTo]);
  /**
   * L05: one note save resolves only on the server ack of its batch. The SDK
   * queues the batch while offline (no ack yet); a reconnect flush acknowledges
   * it. A rejected batch or a lost connection rejects the save, so the panel
   * never reports "Saved" before the server confirmed (AD-2).
   */
  const sendNoteOperations = useCallback((operations: readonly Record<string, unknown>[]): Promise<void> => {
    if (operations.length === 0) return Promise.resolve();
    const sync = syncRef.current;
    if (sync === null) return Promise.reject(new Error("sync is not available"));
    const batchId = sync.sendOperations(operations);
    return new Promise<void>((resolve, reject) => {
      if (batchId === null) queuedWaitersRef.current.push({ resolve, reject });
      else ackWaitersRef.current.set(batchId, { resolve, reject });
    });
  }, []);

  const onAutosaveEvent = useCallback((event: AutosaveEvent): void => {
    if (event.type === "status") setAutosaveStatus(event.status);
    else if (event.type === "saved") {
      setAutosaveStatus("saved");
      setSavedAt(Date.now());
    } else if (event.type === "error") setAutosaveStatus("error");
  }, []);
  const onAutosaveReady = useCallback((control: { retry: () => void } | null): void => {
    autosaveControlRef.current = control;
  }, []);

  // "Saved" fades after the --motion-saved window (2 s), never before.
  useEffect(() => {
    if (savedAt === null) return undefined;
    const timer = window.setTimeout(() => setSavedAt(null), SAVED_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [savedAt]);

  // The 5 s cursor fade needs a heartbeat while remote participants exist.
  useEffect(() => {
    if (participants.length === 0) return undefined;
    const timer = window.setInterval(() => setPresenceNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [participants.length]);

  const retrySave = useCallback((): void => {
    if (sessionExpired) {
      // Terminal session expiry: re-check the session once, then reload into a
      // fresh handshake or go to the login page. No reconnect loop.
      void (async () => {
        try {
          await api.auth.getSession();
          window.location.reload();
        } catch {
          await navigate(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        }
      })();
      return;
    }
    autosaveControlRef.current?.retry();
  }, [sessionExpired, navigate]);

  // Presence: the SDK throttles outbound updates; the app only reports the world
  // cursor and the selected ids. The server derives name and colour.
  const onCanvasMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>): void => {
    const sync = syncRef.current;
    if (sync === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const zoom = cameraRef.current.zoom > 0 ? cameraRef.current.zoom : 1;
    const cursor = { x: (event.clientX - rect.left) / zoom + cameraRef.current.panX, y: (event.clientY - rect.top) / zoom + cameraRef.current.panY };
    lastPresenceCursor.current = cursor;
    sync.updatePresence({ cursor, selection: selectedRef.current === null ? [] : [selectedRef.current.id] });
  }, []);
  useEffect(() => {
    const sync = syncRef.current;
    const cursor = lastPresenceCursor.current;
    if (sync === null || cursor === null) return;
    sync.updatePresence({ cursor, selection: selected === null ? [] : [selected.id] });
  }, [selected]);

  useEffect(() => {
    const canvas = canvasRef.current; const boardId = id;
    if (canvas === null || boardId === undefined) return;
    let disposed = false; let observer: ResizeObserver | null = null; let engine: Engine | null = null; let sync: BoardSyncClient | null = null; let unsubscribePresence: (() => void) | null = null;
    {
      // A board switch starts a fresh session: clear the old board's presence
      // and save state immediately (no stale cursors, no stale status).
      setSyncStatus("connecting");
      setSessionExpired(false);
      setParticipants([]);
      setPresenceSeen({});
      setAutosaveStatus("idle");
      setSavedAt(null);
      // The previous board's retry control must never send to the new session.
      autosaveControlRef.current = null;
    }
    const rejectAcks = (error: unknown): void => {
      for (const waiter of ackWaitersRef.current.values()) waiter.reject(error);
      ackWaitersRef.current.clear();
    };
    const resolveAck = (batchId: string): void => {
      const waiter = ackWaitersRef.current.get(batchId);
      if (waiter !== undefined) {
        ackWaitersRef.current.delete(batchId);
        waiter.resolve();
      }
      // A reconnect flush sends the queued offline edits in one batch; that ack
      // confirms every save that was waiting on the offline queue.
      for (const queued of queuedWaitersRef.current.splice(0)) queued.resolve();
    };
    const start = async (): Promise<void> => {
      try {
        const board = await api.boards.get(boardId);
        if (disposed) return;
        setState((current) => ({ ...current, board }));
        const requested = import.meta.env["VITE_ENGINE_BACKEND"] === "auto" ? "auto" : import.meta.env["VITE_ENGINE_BACKEND"] === "webgpu" ? "webgpu" : "webgl2";
        const hasWebgpu = typeof navigator !== "undefined" && "gpu" in navigator;
        const backend = backendChoice(requested, hasWebgpu);
        engine = await createEngine(canvas, { backend });
        if (disposed) { engine.dispose(); return; }
        engineRef.current = engine;
        setState((current) => ({ ...current, backend: engine?.activeBackend ?? backend }));
        
        const resize = (): void => {
          const rect = canvas.getBoundingClientRect();
          engine?.resize(Math.max(1, rect.width), Math.max(1, rect.height), window.devicePixelRatio || 1);
          setViewport({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
          persistCamera();
        };
        resize(); observer = new ResizeObserver(resize); observer.observe(canvas);
        // Restore the L17 camera for this board/device, else fit the board.
        const deviceKey = deviceKeyFor(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio); void language;
        let stored: string | null = null; try { stored = window.localStorage.getItem(storageKeyFor(boardId, deviceKey)); } catch { stored = null; }
        const restored = parseViewRecord(stored, { boardId, deviceKey });
        const content = EMPTY_CONTENT(board); contentRef.current = content; setContent(content);
        const fitted = engine.fitView(bounds(content), { width: canvas.clientWidth, height: canvas.clientHeight });
        applyCamera(restored ?? fitted);
        const socketUrl = syncUrl(window.location);
        // The SDK owns the client document (real CRDT default, ADR-0012); the app
        // only projects the resulting board content to the engine.
        const project = (): void => {
          const active = syncRef.current; const activeEngine = engineRef.current;
          if (active === null || activeEngine === null) return;
          const snapshot = active.document().snapshot();
          contentRef.current = snapshot;
          setContent(snapshot);
          projectContent(activeEngine, snapshot);
          setState((current) => ({ ...current, empty: snapshot.cards.length + snapshot.zones.length + snapshot.blocks.length === 0 }));
        };
        // P6-09: the browser handshake. No token is read in JS: the same-origin
        // session cookie rides on the WebSocket upgrade and the tokenRef is only
        // the opaque contract reference the service ignores for cookie sessions.
        sync = createBoardSyncClient({
          createSocket: () => new WebSocket(socketUrl),
          boardId, tokenRef: BROWSER_SESSION_TOKEN_REF, clientId: clientId || createRequestId(),
          initialContent: content,
          onChange: (event) => {
            if (event.type === "status") {
              setSyncStatus(event.status);
              // Batches sent on a dropped connection are not acknowledged; the
              // save is not confirmed, so the L05 status must say so. Offline
              // queued edits stay queued and flush on the reconnect.
              if (event.status === "offline") rejectAcks(new Error("connection lost before the server confirmed the save"));
            } else if (event.type === "ack") {
              resolveAck(event.batchId);
              project();
            } else if (event.type === "snapshot" || event.type === "remote") {
              project();
            }
            if (event.type === "error") {
              if (isSessionExpired(event.error)) {
                // Terminal: the session is gone. Stop the client so the SDK does
                // not reconnect in a loop, and let the L05 region offer retry/login.
                setSessionExpired(true);
                setSyncStatus("closed");
                setParticipants([]);
                for (const waiter of ackWaitersRef.current.values()) waiter.reject(event.error);
                ackWaitersRef.current.clear();
                for (const waiter of queuedWaitersRef.current.splice(0)) waiter.reject(event.error);
                sync?.close();
              } else {
                rejectAcks(event.error);
              }
            }
          },
        });
        syncRef.current = sync;
        unsubscribePresence = sync.onPresence((list) => {
          const now = Date.now();
          setParticipants(list);
          setPresenceSeen((current) => {
            const next: Record<string, number> = { ...current };
            for (const participant of list) next[participant.clientId] = now;
            return next;
          });
        });
        sync.start();
        if (typeof navigator !== "undefined" && navigator.onLine === false) sync.goOffline();
        project();
        setState((current) => ({ ...current, loading: false }));
      } catch (error) {
        if (disposed) return;
        const status = error !== null && typeof error === "object" && "status" in error ? error.status : 0;
        if (status === 404 || status === 403) { void navigate("/boards", { replace: true }); return; }
        const messageKey = error instanceof EngineError ? "board.errors.engine" : "errors.generic";
        setSyncStatus("closed");
        setState({ loading: false, errorKey: messageKey, board: null, backend: null, empty: true });
      }
    };
    void start();
    return () => {
      disposed = true; if (saveTimer.current !== null) window.clearTimeout(saveTimer.current); cancelPanelPan(); observer?.disconnect(); unsubscribePresence?.(); sync?.close(); syncRef.current = null; engine?.dispose(); engineRef.current = null;
      // No save may stay pending forever after the board page closes.
      rejectAcks(new Error("board closed"));
      for (const waiter of queuedWaitersRef.current.splice(0)) waiter.reject(new Error("board closed"));
    };
  }, [id, clientId, navigate, applyCamera, persistCamera, cancelPanelPan]);

  const commitOperation = useCallback((operation: Record<string, unknown>) => {
    const sync = syncRef.current;
    if (sync === null || operation["inverse"] === undefined) return false;
    sync.sendOperations([operation]);
    return true;
  }, []);

  const showHint = useCallback((action: "undo" | "redo") => {
    setHint(t(undoHintKey(action)));
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 3000);
  }, [t]);
  const selectedObject = useCallback(() => {
    const content = contentRef.current; if (selected === null || content === null) return null;
    const list = selected.kind === "card" ? content.cards : selected.kind === "zone" ? content.zones : content.blocks;
    const found = (list as readonly { id: string; x: number; y: number; width?: number; height?: number; z?: string; noteId?: string; boardId?: string }[]).find((object) => object.id === selected.id);
    if (found === undefined) return null;
    return { ...found, boardId: found.boardId ?? state.board?.id ?? "" };
  }, [selected, state.board]);
  const deleteSelected = useCallback(() => {
    const object = selectedObject(); if (object === null || selected === null) return;
    if (commitOperation(buildDeleteOperation(selected.kind, object, clientId))) setSelected(null);
  }, [selectedObject, selected, clientId, commitOperation]);

  const duplicateSelected = useCallback(() => {
    const object = selectedObject();
    if (object === null || selected === null || selected.kind !== "card") return;
    if (state.board === null) return;
    const sourceNote = contentRef.current?.notes.find((note) => note.id === object.noteId);
    const noteId = object.noteId ?? createRequestId();
    const built = buildDuplicateCardOperation({ board: state.board, card: { ...object, boardId: object.boardId, noteId }, sourceNoteTitle: sourceNote?.title ?? t("board.duplicate.title"), actorId: clientId });
    if (commitOperation(built.operation)) pendingSelectionRef.current = built.cardId;
  }, [selectedObject, selected, clientId, commitOperation, t, state.board]);

  const reorderSelected = useCallback((direction: "forward" | "backward") => {
    const object = selectedObject(); if (object === null) return;
    commitOperation(buildReorderOperation(object, direction, clientId));
  }, [selectedObject, clientId, commitOperation]);

  useEffect(() => {
    const burst = createArrowBurst((delta) => {
      const object = selectedObject(); if (object === null) return;
      const moves = delta.dx * delta.dx + delta.dy * delta.dy === 0 ? null : { x: (object.x ?? 0) + delta.dx, y: (object.y ?? 0) + delta.dy };
      if (moves === null || selected === null) return;
      const operation = selected.kind === "card"
        ? { id: createRequestId(), boardId: object.boardId, actorId: clientId, createdAt: new Date().toISOString(), type: "moveCard", payload: { cardId: object.id, ...moves }, inverse: { boardId: object.boardId, type: "moveCard", payload: { cardId: object.id, x: object.x ?? 0, y: object.y ?? 0 } } }
        : selected.kind === "zone"
          ? { id: createRequestId(), boardId: object.boardId, actorId: clientId, createdAt: new Date().toISOString(), type: "moveZone", payload: { zoneId: object.id, ...moves }, inverse: { boardId: object.boardId, type: "moveZone", payload: { zoneId: object.id, x: object.x ?? 0, y: object.y ?? 0 } } }
          : { id: createRequestId(), boardId: object.boardId, actorId: clientId, createdAt: new Date().toISOString(), type: "moveBlock", payload: { blockId: object.id, ...moves }, inverse: { boardId: object.boardId, type: "moveBlock", payload: { blockId: object.id, x: object.x ?? 0, y: object.y ?? 0 } } };
      commitOperation(operation);
    });
    burstRef.current = burst;
    const onKey = (event: KeyboardEvent) => {
      // The panel owns its keys (L04 isolation): the aside closes on Escape and
      // the board shortcut layer never sees editor or title input.
      const eventElement = event.target instanceof Element ? event.target : null;
      if (eventElement !== null && eventElement.closest("[data-board-panel]") !== null) return;
      const target = event.target as unknown as FocusLike | null;
      if (suppressesShortcuts(target)) return;
      if (menu !== null && event.key === "Escape") { event.preventDefault(); setMenu(null); canvasRef.current?.focus(); return; }
      const action = shortcutFor(event);
      if (action === null) return;
      const sync = syncRef.current;
      if (action === "undo" || action === "redo") { event.preventDefault(); const used = action === "undo" ? sync?.undoOwn() : sync?.redoOwn(); if (used === true) showHint(action); return; }
      if (action === "escape") {
        event.preventDefault(); setMenu(null);
        if (panelRef.current?.open === true) closePanel(); else setSelected(null);
        return;
      }
      if (action === "delete") { event.preventDefault(); deleteSelected(); return; }
      if (action === "duplicate") { event.preventDefault(); duplicateSelected(); return; }
      const delta = arrowDelta(action, event.shiftKey === true);
      if (delta.dx !== 0 || delta.dy !== 0) { event.preventDefault(); burst.push(delta.dx, delta.dy); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu, selected, selectedObject, commitOperation, deleteSelected, duplicateSelected, showHint, closePanel]);

  // L04: a selected card opens the panel; any other selection or deletion closes
  // it. This runs on selection changes only: a later content projection (a save
  // ack, a remote edit) must not reopen a panel the user just closed.
  useEffect(() => {
    if (selected === null || selected.kind !== "card") {
      if (panelRef.current !== null && panelRef.current.open) closePanel();
      return;
    }
    if (panelRef.current?.cardId !== selected.id || panelRef.current?.open !== true) openPanelForCard(selected.id);
  }, [selected, closePanel, openPanelForCard]);

  // Select a newly created card as soon as the content projection carries it.
  useEffect(() => {
    const pendingId = pendingSelectionRef.current;
    if (pendingId === null || contentRef.current === null) return;
    if (!contentRef.current.cards.some((card) => card.id === pendingId)) return;
    pendingSelectionRef.current = null;
    setSelected({ kind: "card", id: pendingId });
  }, [content]);
  // A remotely deleted card closes the panel (the note-missing state stays for a live card).
  useEffect(() => {
    if (panel === null) return;
    if (resolveCardNote(content, panel.cardId) === null) closePanel();
  }, [content, panel, closePanel]);
  useEffect(() => () => { if (hintTimer.current !== null) window.clearTimeout(hintTimer.current); }, []);
  // P6-10: the browser's own offline/online events. A Chromium offline context
  // keeps an idle WebSocket half-open and silently drops frames, so the view
  // cannot rely on the socket close alone; the SDK closes it and keeps the
  // unacknowledged edits for the reconnect (L05 offline notice, flush on online).
  useEffect(() => {
    const goOffline = (): void => syncRef.current?.goOffline();
    const goOnline = (): void => syncRef.current?.goOnline();
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);
  const openMenu = (event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(event.clientX, window.innerWidth - 208); const y = Math.min(event.clientY, window.innerHeight - 200);
    setMenu({ x: Math.max(8, x), y: Math.max(8, y) }); void rect;
  };
  /**
   * L00 note creation (P6-10 in-scope fix): with the "Add note" tool active, a
   * canvas click creates one note card centred on the pointer through the same
   * sync path as every other authored gesture, selects it (the L04 panel opens)
   * and returns the toolbar to select.
   */
  const createNoteAt = (screenX: number, screenY: number) => {
    const board = state.board; const canvas = canvasRef.current;
    if (board === null || canvas === null) return false;
    const zoom = cameraRef.current.zoom > 0 ? cameraRef.current.zoom : 1;
    const worldX = screenX / zoom + cameraRef.current.panX;
    const worldY = screenY / zoom + cameraRef.current.panY;
    const built = buildCreateNoteCardOperation({
      board,
      actorId: clientId,
      title: t("note.newTitle"),
      x: worldX - NOTE_CARD_WIDTH / 2,
      y: worldY - NOTE_CARD_HEIGHT / 2,
      z: nextCardZ(contentRef.current?.cards ?? []),
    });
    if (!commitOperation(built.operation)) return false;
    pendingSelectionRef.current = built.cardId;
    setTool("select");
    return true;
  };
  const pickAt = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current; const canvas = event.currentTarget;
    if (engine === null) return;
    const rect = canvas.getBoundingClientRect();
    if (tool === "note") {
      createNoteAt(event.clientX - rect.left, event.clientY - rect.top);
      return;
    }
    const slot = engine.hitTest(event.clientX - rect.left, event.clientY - rect.top);
    if (slot < 0) { setSelected(null); setMenu(null); closePanel(); return; }
    const content = contentRef.current; if (content === null) return;
    const ordered = [...content.zones.map((zone) => ({ kind: "zone" as const, id: zone.id })), ...content.blocks.map((block) => ({ kind: "block" as const, id: block.id })), ...content.cards.map((card) => ({ kind: "card" as const, id: card.id }))];
    const hit = ordered[slot]; if (hit !== undefined) { setSelected(hit); if (hit.kind !== "card") closePanel(); }
  };
  if (state.errorKey !== null) return <section className="page"><h1 className="page-title">{t("board.errors.title")}</h1><p className="form-error" role="alert">{t(state.errorKey)}</p><Link className="text-link" to="/boards">{t("boards.backToList")}</Link></section>;
  const groups = toolGroups();
  const panelCard = panel === null ? null : resolveCardNote(content, panel.cardId);
  const saveView = saveStatusView({ autosave: autosaveStatus, sync: syncStatus, sessionExpired });
  // "Saved" is shown for the token window after the server confirmation only.
  const statusView = saveView.state === "saved" && !savedStillVisible(Date.now(), savedAt) ? { state: "hidden" as const, messageKey: "", retryable: false } : saveView;
  return (
    <section className="board-page" aria-busy={state.loading}>
      <header className="board-bar">
        <Link className="text-link" to="/boards" aria-label={t("boards.backToList")}>←</Link>
        <h1 className="board-title">{state.board?.title ?? t("board.untitled")}</h1>
        <span className="muted small" aria-live="polite">{t(connectionMessageKey(connectionPhase(syncStatus, sessionExpired)))}</span>
      </header>
      <div className="board-canvas-wrap">
        <canvas ref={canvasRef} className="board-canvas" tabIndex={-1} aria-label={t("board.canvasLabel")} onClick={pickAt} onContextMenu={openMenu} onMouseMove={onCanvasMouseMove} />
        {syncStatus === "joined" && !sessionExpired && participants.length > 0 ? (
          <div className="remote-cursors" aria-hidden="true">
            {participants.flatMap((participant) => {
              const nodes: ReactNode[] = [];
              const color = presenceColor(participant.colorRef);
              const label = presenceLabel(participant.nameRef);
              const cursor = cursorScreenPoint(camera, participant.cursor, viewport);
              if (cursor.visible) {
                nodes.push(
                  <span
                    key={`cursor:${participant.clientId}`}
                    className="remote-cursor"
                    data-remote-client={participant.clientId}
                    style={{ transform: `translate3d(${cursor.point.x}px, ${cursor.point.y}px, 0)`, "--remote-color": color, opacity: cursorOpacity(presenceSeen[participant.clientId] ?? 0, presenceNow) } as CSSProperties}
                  >
                    <svg className="remote-cursor-pointer" viewBox="0 0 16 16" focusable="false"><path d="M2 1 L14 8 L8.5 9.5 L6 15 Z" fill="currentColor" /></svg>
                    <span className="remote-cursor-label">{t("board.presence.label", { id: label })}</span>
                  </span>,
                );
              }
              selectionRects(content, participant.selection).forEach((rect, index) => {
                const topLeft = worldToScreen(camera, rect);
                nodes.push(
                  <span
                    key={`selection:${participant.clientId}:${index}`}
                    className="remote-selection"
                    style={{
                      transform: `translate3d(${topLeft.x}px, ${topLeft.y}px, 0)`,
                      width: `${rect.width * camera.zoom}px`,
                      height: `${rect.height * camera.zoom}px`,
                      "--remote-color": color,
                    } as CSSProperties}
                  />,
                );
              });
              return nodes;
            })}
          </div>
        ) : null}
        {state.loading ? <p className="board-empty muted" role="status">{t("board.loading")}</p> : null}
        {!state.loading && state.empty ? <p className="board-empty muted">{t("canvas.empty")}</p> : null}
      </div>
      <div className="toolbar" role="toolbar" aria-label={t("canvas.toolbar.label")}>
        {groups.map((group, index) => (
          <div className="toolbar-group" key={index}>
            {index > 0 ? <span className="toolbar-divider" aria-hidden="true" /> : null}
            {group.map((definition) => (
              <ToolbarButton key={definition.id} icon={ICONS[definition.icon] ?? sourceIcon} label={t(definition.labelKey)} pressed={definition.id === tool} onSelect={() => setTool(definition.id)} />
            ))}
          </div>
        ))}
      </div>
      <div className="zoom-controls" role="group" aria-label={t("canvas.zoom.label")}>
        <Button size="bar" variant="ghost" aria-label={t("canvas.zoom.out")} onClick={() => userCamera(zoomBy(cameraRef.current, 0.9))}>{t("canvas.zoom.out")}</Button>
        <Button size="bar" variant="ghost" aria-label={t("canvas.zoom.fit")} onClick={() => { const engine = engineRef.current; const canvas = canvasRef.current; const fallback = contentRef.current ?? (state.board !== null ? EMPTY_CONTENT(state.board) : null); if (engine !== null && canvas !== null && fallback !== null) userCamera(engine.fitView(bounds(fallback), { width: canvas.clientWidth, height: canvas.clientHeight })); }}>{t("canvas.zoom.fit")}</Button>
        <Button size="bar" variant="ghost" aria-label={t("canvas.zoom.in")} onClick={() => userCamera(zoomBy(cameraRef.current, 1.1))}>{t("canvas.zoom.in")}</Button>
      </div>
      {menu === null ? null : (
        <div className="context-menu" role="menu" aria-label={t("board.menu.label")} style={{ left: menu.x, top: menu.y, zIndex: LAYER_Z_INDEX["context-menu"] }}>
          {contextMenuModel({ hasSelection: selected !== null, multiSelection: false }).map((item) => (
            <button key={item.id} type="button" role="menuitem" className="context-menu-item" disabled={item.disabled} onClick={() => {
              setMenu(null); canvasRef.current?.focus();
              if (item.id === "open" && selected !== null && selected.kind === "card") openPanelForCard(selected.id);
              else if (item.id === "delete") deleteSelected();
              else if (item.id === "duplicate") duplicateSelected();
              else if (item.id === "bringForward") reorderSelected("forward");
              else if (item.id === "sendBackward") reorderSelected("backward");
            }}>
              <span>{item.disabled && item.disabledKey !== undefined ? t(item.disabledKey) : t(item.labelKey)}</span>
              <span className="context-menu-shortcut">{item.shortcut}</span>
            </button>
          ))}
        </div>
      )}
      {panel === null || panelCard === null ? null : (
        <NotePanel
          t={t}
          boardId={state.board?.id ?? id ?? ""}
          actorId={clientId}
          noteId={panelCard.card.noteId}
          note={panelCard.note}
          open={panel.open}
          onClose={closePanel}
          onClosed={() => setPanel(null)}
          sendOperations={sendNoteOperations}
          onAutosaveEvent={onAutosaveEvent}
          onAutosaveReady={onAutosaveReady}
        />
      )}
      <footer className="board-status" data-state={statusView.state} role="status" aria-live="polite">
        {statusView.retryable ? (
          <button type="button" className="board-status-retry" onClick={retrySave}>{t(statusView.messageKey)}</button>
        ) : (
          <span
            className="board-status-text"
            data-tone={statusView.state === "error" || statusView.state === "auth" ? "danger" : "muted"}
            style={{ opacity: statusView.state === "hidden" ? 0 : 1 }}
            aria-hidden={statusView.state === "hidden"}
          >
            {statusView.state === "hidden" ? "" : t(statusView.messageKey)}
          </span>
        )}
      </footer>
      {hint === null ? null : <p className="undo-hint" role="status" aria-live="polite">{hint}</p>}
      <span className="visually-hidden" data-commit-operation={String(commitOperation.length)} />
    </section>
  );
}
