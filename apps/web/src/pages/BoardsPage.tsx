import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams, Navigate } from "react-router";

import { api } from "../auth/client.ts";
import { errorMessageKey } from "../auth/validation.ts";
import { sortBoards, formatUpdatedAt, normalizeTitle, readStoredWorkspaceId, persistWorkspaceId, selectWorkspace, titleErrors, workspaceNameErrors, visibilityKey, type FieldErrors } from "../boards/helpers.ts";
import { Button } from "../components/Button.tsx";
import { Dialog } from "../components/Dialog.tsx";
import type { Board, Workspace } from "../../../../packages/sdk/src/types.ts";

interface BoardsPageProps {
  readonly t: (key: string, values?: Readonly<Record<string, string | number>>) => string;
  readonly language: string;
  readonly accountId: string;
}

type DialogState = { readonly kind: "create" } | { readonly kind: "firstRun" } | { readonly kind: "rename"; readonly board: Board } | { readonly kind: "delete"; readonly board: Board } | null;
type RequestState = { readonly loading: boolean; readonly errorKey: string | null; readonly pending: boolean };

function storage() { try { return globalThis.localStorage; } catch { return null; } }

function errorKeyOf(error: unknown): string {
  const key = errorMessageKey(error);
  return key === "errors.generic" && error !== null && typeof error === "object" && "status" in error && error.status === 401 ? "boards.errors.session" : key;
}

function BoardDialogs({ t, dialog, workspaceId, onClose, onCreate, onRename, onDelete }: {
  readonly t: BoardsPageProps["t"]; readonly dialog: DialogState; readonly workspaceId: string | null;
  readonly onClose: () => void; readonly onCreate: (workspaceId: string | null, title: string) => Promise<void>;
  readonly onRename: (board: Board, title: string) => Promise<void>; readonly onDelete: (board: Board) => Promise<void>;
}) {
  const [title, setTitle] = useState(""); const [errors, setErrors] = useState<FieldErrors>({}); const [error, setError] = useState<string | null>(null); const [pending, setPending] = useState(false);
  useEffect(() => {
    if (dialog === null) return;
    setTitle(dialog.kind === "rename" ? dialog.board.title : ""); setErrors({}); setError(null); setPending(false);
  }, [dialog]);
  if (dialog === null) return null;
  if (dialog.kind === "delete") {
    return (
      <Dialog open title={t("boards.delete.title")} closeLabel={t("common.close")} onClose={onClose}>
        <p className="muted">{t("boards.delete.body", { title: dialog.board.title })}</p>
        <div className="button-row">
          <Button variant="danger" disabled={pending} onClick={() => { setPending(true); void onDelete(dialog.board).finally(() => setPending(false)); }}>{t("boards.delete.confirm")}</Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>{t("common.cancel")}</Button>
        </div>
      </Dialog>
    );
  }
  const firstRun = dialog.kind === "firstRun";
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(null);
    const found = firstRun ? workspaceNameErrors(title) : titleErrors(title); setErrors(found);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    try {
      if (dialog.kind === "rename") await onRename(dialog.board, normalizeTitle(title));
      else await onCreate(firstRun ? null : workspaceId, normalizeTitle(title));
      onClose();
    } catch (caught) { setError(t(errorKeyOf(caught))); } finally { setPending(false); }
  };
  return (
    <Dialog open title={firstRun ? t("boards.firstRun.title") : dialog.kind === "rename" ? t("boards.rename.title") : t("boards.create.title")} closeLabel={t("common.close")} onClose={onClose}>
      <form className="form" onSubmit={(event) => { void submit(event); }} noValidate>
        <p className="muted small">{firstRun ? t("boards.firstRun.body") : dialog.kind === "rename" ? t("boards.rename.body") : t("boards.create.body")}</p>
        <label className="field"><span>{firstRun ? t("boards.workspaceName") : t("boards.boardTitle")}</span>
          <input className="input" type="text" autoComplete="off" value={title} onChange={(event) => setTitle(event.target.value)} aria-invalid={Object.keys(errors).length > 0} />
        </label>
        {Object.values(errors).map((key) => <p key={key} className="field-error">{t(key)}</p>)}
        {error === null ? null : <p className="form-error" role="alert">{error}</p>}
        <div className="button-row">
          <Button type="submit" variant="primary" disabled={pending || (dialog.kind !== "rename" && workspaceId === null && !firstRun)}>{pending ? t("boards.saving") : firstRun ? t("boards.firstRun.submit") : t("boards.save")}</Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>{t("common.cancel")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function BoardsPage({ t, language, accountId }: BoardsPageProps) {
  const [workspaces, setWorkspaces] = useState<readonly Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [boards, setBoards] = useState<readonly Board[]>([]);
  const [request, setRequest] = useState<RequestState>({ loading: true, errorKey: null, pending: false });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [firstRun, setFirstRun] = useState(false);
  const activeWorkspace = useMemo(() => selectWorkspace(workspaces, workspaceId), [workspaces, workspaceId]);

  const loadBoards = useCallback(async (id: string) => {
    const page = await api.boards.list(id, { limit: 100 });
    setBoards(sortBoards(page.items));
  }, []);

  const load = useCallback(async () => {
    setRequest({ loading: true, errorKey: null, pending: false });
    try {
      const page = await api.workspaces.list({ limit: 100 });
      setWorkspaces(page.items);
      const selected = selectWorkspace(page.items, readStoredWorkspaceId(storage()));
      setWorkspaceId(selected?.id ?? null);
      setFirstRun(page.items.length === 0);
      if (selected === null) setBoards([]);
      else await loadBoards(selected.id);
      setRequest({ loading: false, errorKey: null, pending: false });
    } catch (error) {
      setRequest({ loading: false, errorKey: errorKeyOf(error), pending: false });
    }
  }, [loadBoards]);

  useEffect(() => { void load(); }, [load]);

  const selectWorkspaceById = (id: string) => {
    setWorkspaceId(id); persistWorkspaceId(storage(), id); setRequest({ loading: true, errorKey: null, pending: false });
    void loadBoards(id).then(() => setRequest({ loading: false, errorKey: null, pending: false })).catch((error) => setRequest({ loading: false, errorKey: errorKeyOf(error), pending: false }));
  };

  const createBoard = async (targetWorkspaceId: string | null, title: string) => {
    if (targetWorkspaceId === null) return;
    const board = await api.boards.create(targetWorkspaceId, { ownerId: accountId, title, visibility: "private" });
    setBoards((current) => sortBoards([...current, board]));
  };
  const renameBoard = async (board: Board, title: string) => {
    const updated = await api.boards.update(board.id, { title });
    setBoards((current) => sortBoards(current.map((entry) => (entry.id === board.id ? updated : entry))));
  };
  const deleteBoard = async (board: Board) => {
    await api.boards.delete(board.id);
    setBoards((current) => current.filter((entry) => entry.id !== board.id));
  };
  const createFirstRun = async (_targetWorkspaceId: string | null, name: string) => {
    const workspace = await api.workspaces.create({ name, ownerId: accountId });
    setWorkspaces((current) => [...current, workspace]);
    setWorkspaceId(workspace.id); persistWorkspaceId(storage(), workspace.id);
    const board = await api.boards.create(workspace.id, { ownerId: accountId, title: normalizeTitle(name), visibility: "private" });
    setBoards(sortBoards([board])); setFirstRun(false);
  };

  if (request.loading) {
    return <section className="page" aria-busy="true"><h1 className="page-title">{t("boards.title")}</h1><div className="skeleton" aria-hidden="true" /><div className="skeleton" aria-hidden="true" /><div className="skeleton" aria-hidden="true" /><p className="muted">{t("boards.loading")}</p></section>;
  }
  if (request.errorKey !== null) {
    return <section className="page"><h1 className="page-title">{t("boards.title")}</h1><p className="form-error" role="alert">{t(request.errorKey)}</p><Button variant="secondary" onClick={() => { void load(); }}>{t("boards.retry")}</Button></section>;
  }
  if (firstRun || activeWorkspace === null) {
    return (
      <section className="page">
        <p className="eyebrow">{t("nav.boards")}</p><h1 className="page-title">{t("boards.firstRun.title")}</h1>
        <p className="muted">{t("boards.firstRun.empty")}</p>
        <Button variant="primary" onClick={() => setDialog({ kind: "firstRun" })}>{t("boards.firstRun.action")}</Button>
        <BoardDialogs t={t} dialog={dialog} workspaceId={workspaceId} onClose={() => setDialog(null)} onCreate={createFirstRun} onRename={renameBoard} onDelete={deleteBoard} />
      </section>
    );
  }
  return (
    <section className="page boards-page">
      <div className="boards-header">
        <div>
          <p className="eyebrow">{t("nav.boards")}</p>
          <h1 className="page-title">{activeWorkspace.name}</h1>
          <p className="muted small">{t("boards.count", { count: boards.length })}</p>
        </div>
        <div className="button-row">
          {workspaces.length > 1 ? (
            <label className="field inline"><span>{t("boards.workspace")}</span>
              <select className="input" value={workspaceId ?? ""} onChange={(event) => selectWorkspaceById(event.target.value)}>
                {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
              </select>
            </label>
          ) : null}
          <Button variant="primary" onClick={() => setDialog({ kind: "create" })}>{t("boards.newBoard")}</Button>
        </div>
      </div>
      {boards.length === 0 ? (
        <div className="empty-state"><p className="muted">{t("boards.empty")}</p><Button variant="primary" onClick={() => setDialog({ kind: "create" })}>{t("boards.newBoard")}</Button></div>
      ) : (
        <ul className="board-list">
          {boards.map((board) => (
            <li key={board.id} className="board-card">
              <Link className="board-link" to={`/boards/${encodeURIComponent(board.id)}`}>{board.title}</Link>
              <span className="muted small">{t(visibilityKey(board.visibility))} · {formatUpdatedAt(board.updatedAt, language)}</span>
              <div className="button-row">
                <Button variant="ghost" size="card" onClick={() => setDialog({ kind: "rename", board })}>{t("boards.rename.action")}</Button>
                <Button variant="ghost" size="card" onClick={() => setDialog({ kind: "delete", board })}>{t("boards.delete.action")}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <BoardDialogs t={t} dialog={dialog} workspaceId={workspaceId} onClose={() => setDialog(null)} onCreate={createBoard} onRename={renameBoard} onDelete={deleteBoard} />
    </section>
  );
}

export function BoardPageGuard({ t }: { readonly t: BoardsPageProps["t"] }) {
  const { id } = useParams(); const [state, setState] = useState<{ loading: boolean; missing: boolean }>({ loading: true, missing: false });
  useEffect(() => {
    let active = true;
    if (id === undefined) { setState({ loading: false, missing: true }); return; }
    void api.boards.get(id).then(() => { if (active) setState({ loading: false, missing: false }); }).catch((error: unknown) => {
      if (active) setState({ loading: false, missing: error !== null && typeof error === "object" && "status" in error && (error.status === 404 || error.status === 403) });
    });
    return () => { active = false; };
  }, [id]);
  if (state.loading) return <section className="page" aria-busy="true"><p className="muted">{t("boards.loading")}</p></section>;
  if (state.missing) return <Navigate to="/boards" replace />;
  return <section className="page"><p className="eyebrow">{t("nav.boards")}</p><h1 className="page-title">{t("boards.boardPage.title")}</h1><p className="muted">{t("boards.boardPage.body")}</p><Link className="text-link" to="/boards">{t("boards.backToList")}</Link></section>;
}
