/**
 * A deliberately small `node:http` router.
 *
 * Routes are exact `(method, pathname)` pairs; there are no parameters yet.
 * The router owns the request id (UUIDv7 for the contract error envelope), the
 * JSON body limit, the JSON envelopes and the error mapping, so every response
 * of the service has the same shape.
 */

import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { Logger } from "../log.ts";
import {
  HttpError,
  methodNotAllowed,
  notFound,
  payloadTooLarge,
  unsupportedMediaType,
  validationFailed,
} from "./errors.ts";
import { createRequestId, isRequestId } from "./request-id.ts";
import { errorEnvelope, sendJson, successEnvelope } from "./responses.ts";

export const DEFAULT_JSON_BODY_LIMIT_BYTES = 64 * 1024;
export const REQUEST_ID_HEADER = "x-request-id";

const METHOD_PATTERN = /^[A-Z]+$/;

export interface RouteResponse {
  /** HTTP status; defaults to 200. */
  readonly status?: number;
  /** Success payload, wrapped in the success envelope. */
  readonly data?: unknown;
  /** Extra response headers. */
  readonly headers?: Readonly<Record<string, string>>;
}

export type RouteHandler = (context: RequestContext) => Promise<RouteResponse | undefined> | RouteResponse | undefined;

export interface RequestContext {
  readonly requestId: string;
  readonly method: string;
  readonly pathname: string;
  readonly query: URLSearchParams;
  readonly headers: IncomingHttpHeaders;
  /** Parses the body as JSON (lazy, size-limited). */
  readonly readJson: <T = unknown>() => Promise<T>;
}

export interface RouterOptions {
  readonly logger?: Logger;
  readonly jsonBodyLimitBytes?: number;
  readonly requestIdHeader?: string;
  readonly generateRequestId?: () => string;
}

export class Router {
  readonly #routes = new Map<string, Map<string, RouteHandler>>();
  readonly #logger: Logger | undefined;
  readonly #jsonBodyLimitBytes: number;
  readonly #requestIdHeader: string;
  readonly #generateRequestId: () => string;

  constructor(options: RouterOptions = {}) {
    this.#logger = options.logger;
    this.#jsonBodyLimitBytes = options.jsonBodyLimitBytes ?? DEFAULT_JSON_BODY_LIMIT_BYTES;
    if (!Number.isInteger(this.#jsonBodyLimitBytes) || this.#jsonBodyLimitBytes < 1) {
      throw new Error("jsonBodyLimitBytes must be a positive integer");
    }
    this.#requestIdHeader = (options.requestIdHeader ?? REQUEST_ID_HEADER).toLowerCase();
    this.#generateRequestId = options.generateRequestId ?? createRequestId;
  }

  add(method: string, pathname: string, handler: RouteHandler): this {
    const normalizedMethod = method.toUpperCase();
    if (!METHOD_PATTERN.test(normalizedMethod)) {
      throw new Error(`invalid HTTP method: ${method}`);
    }
    if (!pathname.startsWith("/") || pathname.includes("?")) {
      throw new Error(`a route path must start with "/" and contain no query: ${pathname}`);
    }
    const methods = this.#routes.get(pathname) ?? new Map<string, RouteHandler>();
    methods.set(normalizedMethod, handler);
    this.#routes.set(pathname, methods);
    return this;
  }

  get(pathname: string, handler: RouteHandler): this {
    return this.add("GET", pathname, handler);
  }

  post(pathname: string, handler: RouteHandler): this {
    return this.add("POST", pathname, handler);
  }

  /** Builds the `node:http` server; the caller decides on `listen`. */
  createServer(): Server {
    return createServer((request, response) => {
      void this.handle(request, response);
    });
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = this.#resolveRequestId(request);
    response.setHeader(this.#requestIdHeader, requestId);
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const methods = this.#routes.get(url.pathname);
      if (methods === undefined) {
        throw notFound();
      }
      const method = (request.method ?? "GET").toUpperCase();
      const handler = methods.get(method);
      if (handler === undefined) {
        throw methodNotAllowed([...methods.keys()]);
      }
      const context: RequestContext = {
        requestId,
        method,
        pathname: url.pathname,
        query: url.searchParams,
        headers: request.headers,
        readJson: <T = unknown>() => this.#readJson(request).then((body) => body as T),
      };
      const result = await handler(context);
      if (result === undefined) {
        response.writeHead(204);
        response.end();
        return;
      }
      sendJson(response, result.status ?? 200, successEnvelope(requestId, result.data), result.headers ?? {});
    } catch (error) {
      this.#handleError(requestId, response, error);
    }
  }

  #resolveRequestId(request: IncomingMessage): string {
    const headerValue = request.headers[this.#requestIdHeader];
    const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (isRequestId(candidate)) {
      return candidate;
    }
    return this.#generateRequestId();
  }

  async #readJson(request: IncomingMessage): Promise<unknown> {
    const contentType = request.headers["content-type"];
    const mediaType = (typeof contentType === "string" ? contentType : "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (mediaType !== "application/json") {
      throw unsupportedMediaType();
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      totalBytes += buffer.byteLength;
      if (totalBytes > this.#jsonBodyLimitBytes) {
        throw payloadTooLarge(this.#jsonBodyLimitBytes);
      }
      chunks.push(buffer);
    }

    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (text === "") {
      throw validationFailed([], "the request body must be JSON");
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw validationFailed([], "the request body is not valid JSON");
    }
  }

  #handleError(requestId: string, response: ServerResponse, error: unknown): void {
    if (error instanceof HttpError) {
      sendJson(response, error.status, errorEnvelope(requestId, error.code, error.details), error.headers);
      return;
    }
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    this.#logger?.error("unhandled request error", { requestId, error: detail });
    sendJson(response, 500, errorEnvelope(requestId, "INTERNAL"));
  }
}
