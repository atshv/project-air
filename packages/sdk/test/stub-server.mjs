/**
 * In-process stub of the platform API for the SDK tests: contract envelopes,
 * session headers, validation/conflict/not-found errors, cursor pagination.
 * No database, no platform process.
 */

import { once } from "node:events";
import { createServer } from "node:http";

const TEST_SESSION_HEADERS = { "x-test-session": "test-session" };
const COOKIE_HEADER = "cookie";

let counter = 0;

function nextId() {
  counter += 1;
  return `0192f0b0-7000-7000-8000-${String(counter).padStart(12, "0")}`;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function startStubServer() {
  const state = {
    workspaces: new Map(),
    boards: new Map(),
    notes: new Map(),
    cards: new Map(),
    malformedList: false,
  };
  const requests = [];

  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      let body;
      try {
        body = rawBody === "" ? undefined : JSON.parse(rawBody);
      } catch {
        body = undefined;
      }
      requests.push({ method: request.method, url: request.url, headers: request.headers, body });
      handle(request, response, body);
    });
  });

  function send(response, status, payload) {
    const text = JSON.stringify(payload);
    response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
    response.end(text);
  }

  function errorEnvelope(target, requestId, status, code, messageKey, fields) {
    const envelope = { requestId, code, messageKey };
    if (fields !== undefined) {
      envelope.details = { fields };
    }
    return send(target, status, envelope);
  }

  function authenticated(request) {
    return (
      request.headers["x-test-session"] === TEST_SESSION_HEADERS["x-test-session"] ||
      typeof request.headers[COOKIE_HEADER] === "string"
    );
  }

  function requestIdOf(request, body, url) {
    if (isRecord(body) && typeof body.requestId === "string") {
      return body.requestId;
    }
    const fromQuery = url.searchParams.get("requestId");
    if (fromQuery !== null) {
      return fromQuery;
    }
    return "0192f0b0-7000-7000-8000-000000000000";
  }

  function handle(request, response, body) {
    const url = new URL(request.url ?? "/", "http://stub");
    const segments = url.pathname.split("/").filter((segment) => segment !== "");
    const requestId = requestIdOf(request, body, url);
    const method = request.method ?? "GET";

    if (request.headers["accept"] !== "application/json") {
      response.writeHead(400);
      response.end("missing accept header");
      return;
    }
    if (!authenticated(request)) {
      errorEnvelope(response, requestId, 401, "AUTH_REQUIRED", "errors.authRequired");
      return;
    }

    // GET /v1/workspaces
    if (segments.length === 2 && segments[0] === "v1" && segments[1] === "workspaces" && method === "GET") {
      if (state.malformedList) {
        send(response, 200, { requestId });
        return;
      }
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const offset = Number((url.searchParams.get("cursor") ?? "cursor-0").replace("cursor-", ""));
      const all = [...state.workspaces.values()];
      const page = all.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      send(response, 200, {
        requestId,
        items: page,
        nextCursor: nextOffset < all.length ? `cursor-${nextOffset}` : null,
      });
      return;
    }

    // POST /v1/workspaces
    if (segments.length === 2 && segments[1] === "workspaces" && method === "POST") {
      const workspace = isRecord(body) ? body.workspace : undefined;
      if (!isRecord(workspace) || typeof workspace.name !== "string" || workspace.name === "") {
        errorEnvelope(response, requestId, 400, "VALIDATION", "errors.validation", ["workspace.name"]);
        return;
      }
      if (workspace.name === "conflict") {
        errorEnvelope(response, requestId, 409, "CONFLICT", "errors.conflict");
        return;
      }
      const created = {
        id: nextId(),
        name: workspace.name,
        ownerId: String(workspace.ownerId),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      state.workspaces.set(created.id, created);
      send(response, 201, { requestId, workspace: created });
      return;
    }

    // GET/PATCH/DELETE /v1/workspaces/:id
    if (segments.length === 3 && segments[1] === "workspaces" && segments[2] !== undefined) {
      const workspace = state.workspaces.get(segments[2]);
      if (workspace === undefined) {
        errorEnvelope(response, requestId, 404, "NOT_FOUND", "errors.notFound");
        return;
      }
      if (method === "GET") {
        send(response, 200, { requestId, workspace });
        return;
      }
      if (method === "PATCH") {
        if (!isRecord(body) || !isRecord(body.changes) || body.changes.name === undefined) {
          errorEnvelope(response, requestId, 400, "VALIDATION", "errors.validation", ["changes"]);
          return;
        }
        workspace.name = String(body.changes.name);
        workspace.updatedAt = new Date().toISOString();
        send(response, 200, { requestId, workspace });
        return;
      }
      if (method === "DELETE") {
        state.workspaces.delete(segments[2]);
        send(response, 200, { requestId, deletedId: segments[2] });
        return;
      }
    }

    // boards under /v1/workspaces/:id/boards
    if (segments[1] === "workspaces" && segments[3] === "boards") {
      const workspaceId = segments[2];
      if (method === "POST") {
        const input = isRecord(body) ? body.board : undefined;
        if (!isRecord(input) || input.title === "") {
          errorEnvelope(response, requestId, 400, "VALIDATION", "errors.validation", ["board.title"]);
          return;
        }
        const board = {
          id: nextId(),
          workspaceId,
          ownerId: String(input.ownerId),
          title: String(input.title),
          visibility: String(input.visibility ?? "private"),
          archived: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        state.boards.set(board.id, board);
        send(response, 201, { requestId, board });
        return;
      }
      if (method === "GET") {
        send(response, 200, {
          requestId,
          items: [...state.boards.values()].filter((board) => board.workspaceId === workspaceId),
          nextCursor: null,
        });
        return;
      }
    }

    // notes under /v1/workspaces/:id/notes
    if (segments[1] === "workspaces" && segments[3] === "notes") {
      const workspaceId = segments[2];
      if (method === "POST") {
        const input = isRecord(body) ? body.note : undefined;
        if (!isRecord(input)) {
          errorEnvelope(response, requestId, 400, "VALIDATION", "errors.validation", ["note"]);
          return;
        }
        const note = {
          id: nextId(),
          workspaceId,
          title: String(input.title ?? ""),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        state.notes.set(note.id, note);
        send(response, 201, { requestId, note });
        return;
      }
      if (method === "GET") {
        send(response, 200, {
          requestId,
          items: [...state.notes.values()].filter((note) => note.workspaceId === workspaceId),
          nextCursor: null,
        });
        return;
      }
    }

    // board and note items
    if (segments.length === 3 && (segments[1] === "boards" || segments[1] === "notes")) {
      const collection = segments[1] === "boards" ? state.boards : state.notes;
      const key = segments[1] === "boards" ? "board" : "note";
      const item = collection.get(segments[2]);
      if (item === undefined) {
        errorEnvelope(response, requestId, 404, "NOT_FOUND", "errors.notFound");
        return;
      }
      if (method === "GET") {
        send(response, 200, { requestId, [key]: item });
        return;
      }
      if (method === "PATCH") {
        const changes = isRecord(body) ? body.changes : undefined;
        if (isRecord(changes)) {
          const record = item;
          for (const [field, value] of Object.entries(changes)) {
            record[field] = value;
          }
          record.updatedAt = new Date().toISOString();
        }
        send(response, 200, { requestId, [key]: item });
        return;
      }
      if (method === "DELETE") {
        collection.delete(segments[2]);
        send(response, 200, { requestId, deletedId: segments[2] });
        return;
      }
    }

    // cards under /v1/boards/:id/cards
    if (segments[1] === "boards" && segments[3] === "cards") {
      const boardId = segments[2];
      if (method === "POST") {
        const input = isRecord(body) ? body.card : undefined;
        if (!isRecord(input) || input.width < 176 || input.height < 80) {
          errorEnvelope(response, requestId, 400, "VALIDATION", "errors.validation", ["card.width"]);
          return;
        }
        const card = {
          id: nextId(),
          boardId,
          noteId: String(input.noteId),
          zoneId: input.zoneId ?? null,
          x: Number(input.x),
          y: Number(input.y),
          width: Number(input.width),
          height: Number(input.height),
          z: String(input.z),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        state.cards.set(card.id, card);
        send(response, 201, { requestId, card });
        return;
      }
      if (method === "GET") {
        send(response, 200, {
          requestId,
          items: [...state.cards.values()].filter((card) => card.boardId === boardId),
          nextCursor: null,
        });
        return;
      }
    }

    // /v1/cards/:id
    if (segments.length === 3 && segments[1] === "cards") {
      const card = state.cards.get(segments[2]);
      if (card === undefined) {
        errorEnvelope(response, requestId, 404, "NOT_FOUND", "errors.notFound");
        return;
      }
      if (method === "GET") {
        send(response, 200, { requestId, card });
        return;
      }
      if (method === "PATCH") {
        if (isRecord(body) && isRecord(body.changes)) {
          Object.assign(card, body.changes);
          card.updatedAt = new Date().toISOString();
        }
        send(response, 200, { requestId, card });
        return;
      }
      if (method === "DELETE") {
        state.cards.delete(segments[2]);
        send(response, 200, { requestId, deletedId: segments[2] });
        return;
      }
    }

    errorEnvelope(response, requestId, 404, "NOT_FOUND", "errors.notFound");
  }

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    state,
    async close() {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}
