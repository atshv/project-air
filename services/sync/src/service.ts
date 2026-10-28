// P5-03: the sync service factory. Production adapters are wired in index.ts;
// tests inject fake authenticator/authorizer/store/documents and start the same
// service on the slot port, so the live socket path is exercised without
// monkey-patching.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { Duplex as DuplexStream } from "node:stream";

import { createLogger, type Logger } from "./log.ts";
import { createSyncSession, type BoardAuthorizer, type CreateSyncSessionOptions, type SessionAuthenticator, type SyncStore, type BoardDocumentFactory } from "./protocol.ts";
import { createWsConnection, handshakeResponse, isUpgradeRequest, type WsConnection } from "./ws.ts";
import { PresenceHub } from "./presence.ts";

export interface SyncServiceOptions {
  readonly host: string;
  readonly port: number;
  readonly authenticator: SessionAuthenticator;
  readonly authorizer: BoardAuthorizer;
  readonly store: SyncStore;
  readonly documents: BoardDocumentFactory;
  readonly logger?: Logger;
}

export interface RunningSyncService {
  readonly url: string;
  readonly port: number;
  readonly server: Server;
  connectionCount(): number;
  close(): Promise<void>;
}

interface ClientRecord {
  readonly connection: WsConnection;
  readonly session: ReturnType<typeof createSyncSession>;
}

export async function createSyncService(options: SyncServiceOptions): Promise<RunningSyncService> {
  const logger = options.logger ?? createLogger("info", () => undefined);
  const clients = new Set<ClientRecord>();
  const presence = new PresenceHub({
    broadcast: (boardId, message, exceptClientId) => {
      for (const record of clients) {
        if (record.session.clientId === exceptClientId) continue;
        if (record.session.joinedBoard !== boardId) continue;
        record.connection.sendJson(message);
      }
    },
  });
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok", service: "sync" }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });

  server.on("upgrade", (request: IncomingMessage, socket: DuplexStream) => {
    if (!isUpgradeRequest(request)) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    socket.write(handshakeResponse(String(request.headers["sec-websocket-key"])));
    const connection = createWsConnection(socket as Duplex, request.socket.remoteAddress ?? "");
    const sessionOptions: CreateSyncSessionOptions = {
      send: (message) => connection.sendJson(message),
      authenticator: options.authenticator,
      authorizer: options.authorizer,
      store: options.store,
      documents: options.documents,
      presence,
      broadcast: (boardId, message, exceptClientId) => {
        for (const record of clients) {
          if (record.session.clientId === exceptClientId) continue;
          if (record.session.joinedBoard !== boardId) continue;
          record.connection.sendJson(message);
        }
      },
    };
    const session = createSyncSession(sessionOptions);
    const record: ClientRecord = { connection, session };
    clients.add(record);
    // Messages are handled strictly in order per connection: the async hello
    // authentication must finish before joinBoard, and batches must not overlap.
    let chain: Promise<void> = Promise.resolve();
    connection.onMessage((text) => {
      chain = chain.then(() => session.receive(text)).then(() => undefined).catch((error: unknown) => {
        logger.error("sync.message_failed", { error: String((error as Error).message) });
        connection.close(1011, "internal error");
      });
    });
    connection.onClose(() => {
      if (session.joinedBoard !== null) presence.remove(session.joinedBoard, session.clientId);
      clients.delete(record);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => resolve());
  });
  const address = server.address();
  const actualPort = address !== null && typeof address === "object" ? address.port : options.port;
  logger.info("sync.listening", { host: options.host, port: actualPort });

  return {
    url: `ws://${options.host}:${actualPort}`,
    port: actualPort,
    server,
    connectionCount: () => clients.size,
    close: async () => {
      presence.clear();
      for (const record of clients) record.connection.close(1001, "shutdown");
      clients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
