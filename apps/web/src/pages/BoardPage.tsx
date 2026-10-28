import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { createEngine, EngineError, type Engine, type EngineCamera, type EngineGeometry } from "../../../../packages/engine/src/bridge/engine.ts";
import { deviceKeyFor, parseViewRecord, storageKeyFor } from "../../../../packages/engine/src/bridge/view-persistence.ts";
import { createBoardSyncClient, createRequestId, type BoardSyncClient } from "../../../../packages/sdk/src/index.ts";
import { api } from "../auth/client.ts";
import { toolGroups, type ToolId } from "../board/toolbar.ts";
import { DEFAULT_CAMERA, backendChoice, clampCamera, zoomBy } from "../board/view.ts";
import { Button } from "../components/Button.tsx";
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
const EMPTY_CONTENT = (board: Board): BoardContent => ({ contractVersion: "0.3.0", board: { id: board.id, workspaceId: board.workspaceId, ownerId: board.ownerId, title: board.title, visibility: board.visibility, archived: board.archived, createdAt: board.createdAt, updatedAt: board.updatedAt }, zones: [], blocks: [], cards: [], notes: [], edges: [] });
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
  const [state, setState] = useState<{ loading: boolean; errorKey: string | null; board: Board | null; backend: string | null; empty: boolean; syncStatus: string }>({ loading: true, errorKey: null, board: null, backend: null, empty: true, syncStatus: "idle" });
  const [tool, setTool] = useState<ToolId>("select");

  const applyCamera = useCallback((camera: EngineCamera) => { const engine = engineRef.current; if (engine === null) return; cameraRef.current = clampCamera(camera); engine.setCamera(cameraRef.current); engine.visibleInstanceCount(); }, []);
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

  useEffect(() => {
    const canvas = canvasRef.current; const boardId = id;
    if (canvas === null || boardId === undefined) return;
    let disposed = false; let observer: ResizeObserver | null = null; let engine: Engine | null = null; let sync: BoardSyncClient | null = null;
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
        
        const resize = (): void => { const rect = canvas.getBoundingClientRect(); engine?.resize(Math.max(1, rect.width), Math.max(1, rect.height), window.devicePixelRatio || 1); persistCamera(); };
        resize(); observer = new ResizeObserver(resize); observer.observe(canvas);
        // Restore the L17 camera for this board/device, else fit the board.
        const deviceKey = deviceKeyFor(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio); void language;
        let stored: string | null = null; try { stored = window.localStorage.getItem(storageKeyFor(boardId, deviceKey)); } catch { stored = null; }
        const restored = parseViewRecord(stored, { boardId, deviceKey });
        const content = EMPTY_CONTENT(board); contentRef.current = content;
        const fitted = engine.fitView(bounds(content), { width: canvas.clientWidth, height: canvas.clientHeight });
        applyCamera(restored ?? fitted);
        const syncUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/v1/sync`;
        // The SDK owns the client document (real CRDT default, ADR-0012); the app
        // only projects the resulting board content to the engine.
        const project = (): void => {
          const active = syncRef.current; const activeEngine = engineRef.current;
          if (active === null || activeEngine === null) return;
          const snapshot = active.document().snapshot() as BoardContent;
          contentRef.current = snapshot;
          projectContent(activeEngine, snapshot);
          setState((current) => ({ ...current, empty: snapshot.cards.length + snapshot.zones.length + snapshot.blocks.length === 0 }));
        };
        sync = createBoardSyncClient({
          createSocket: () => new WebSocket(syncUrl),
          boardId, tokenRef: "session", clientId: clientId || createRequestId(),
          initialContent: content,
          onChange: (event) => {
            if (event.type === "status") setState((current) => ({ ...current, syncStatus: event.status }));
            if (event.type === "snapshot" || event.type === "remote" || event.type === "ack") project();
          },
        });
        syncRef.current = sync;
        sync.start(); project();
        setState((current) => ({ ...current, loading: false }));
      } catch (error) {
        if (disposed) return;
        const status = error !== null && typeof error === "object" && "status" in error ? error.status : 0;
        if (status === 404 || status === 403) { navigate("/boards", { replace: true }); return; }
        const messageKey = error instanceof EngineError ? "board.errors.engine" : "errors.generic";
        setState({ loading: false, errorKey: messageKey, board: null, backend: null, empty: true, syncStatus: "error" });
      }
    };
    void start();
    return () => {
      disposed = true; if (saveTimer.current !== null) window.clearTimeout(saveTimer.current); observer?.disconnect(); sync?.close(); syncRef.current = null; engine?.dispose(); engineRef.current = null;
    };
  }, [id, clientId, navigate, applyCamera, persistCamera]);

  const commitOperation = useCallback((operation: Record<string, unknown>) => {
    const sync = syncRef.current;
    if (sync === null || operation["inverse"] === undefined) return false;
    sync.sendOperations([operation]);
    return true;
  }, []);

  if (state.loading) return <section className="page" aria-busy="true"><p className="muted">{t("board.loading")}</p></section>;
  if (state.errorKey !== null) return <section className="page"><h1 className="page-title">{t("board.errors.title")}</h1><p className="form-error" role="alert">{t(state.errorKey)}</p><Link className="text-link" to="/boards">{t("boards.backToList")}</Link></section>;
  const groups = toolGroups();
  return (
    <section className="board-page">
      <header className="board-bar">
        <Link className="text-link" to="/boards" aria-label={t("boards.backToList")}>←</Link>
        <h1 className="board-title">{state.board?.title ?? t("board.untitled")}</h1>
        <span className="muted small" aria-live="polite">{t("board.sync." + state.syncStatus)}</span>
      </header>
      <div className="board-canvas-wrap">
        <canvas ref={canvasRef} className="board-canvas" aria-label={t("board.canvasLabel")} />
        {state.empty ? <p className="board-empty muted">{t("canvas.empty")}</p> : null}
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
        <Button size="bar" variant="ghost" aria-label={t("canvas.zoom.out")} onClick={() => applyCamera(zoomBy(cameraRef.current, 0.9))}>{t("canvas.zoom.out")}</Button>
        <Button size="bar" variant="ghost" aria-label={t("canvas.zoom.fit")} onClick={() => { const engine = engineRef.current; const canvas = canvasRef.current; if (engine !== null && canvas !== null) applyCamera(engine.fitView(bounds(contentRef.current ?? emptyContentFor(id ?? "")), { width: canvas.clientWidth, height: canvas.clientHeight })); }}>{t("canvas.zoom.fit")}</Button>
        <Button size="bar" variant="ghost" aria-label={t("canvas.zoom.in")} onClick={() => applyCamera(zoomBy(cameraRef.current, 1.1))}>{t("canvas.zoom.in")}</Button>
      </div>
      <span className="visually-hidden" data-commit-operation={String(commitOperation.length)} />
    </section>
  );
}
function emptyContentFor(boardId: string): BoardContent { return { contractVersion: "0.3.0", board: { id: boardId, workspaceId: "", ownerId: "", title: "", visibility: "private", archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, zones: [], blocks: [], cards: [], notes: [], edges: [] }; }
