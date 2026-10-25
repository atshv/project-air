/**
 * A deliberately small `node:http` router.
 *
 * Routes are exact `(method, pathname)` pairs with `:param` segments. The
 * router owns the request id (UUIDv7, echoed by the contract envelopes), the
 * JSON body limit, the JSON envelopes and the error mapping.
 *
 * A handler returns either a contract resource envelope in `body` (sent as-is)
 * or `data`, which is wrapped as `{requestId, data}` for the health endpoints.
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
import { errorEnvelope, sendJson } from "./responses.ts";

export const DEFAULT_JSON_BODY_LIMIT_BYTES = 64 * 1024;
export const REQUEST_ID_HEADER = "x-request-id";

const METHOD_PATTERN = /^[A-Z]+$/;
const PARAM_PATTERN = /^[A-Za-z0-9_]+$/;

export interface RouteResponse {
  /** HTTP status; defaults to 200. */
  readonly status?: number;
  /** Contract resource envelope, sent unchanged. */
  readonly body?: unknown;
  /** Payload wrapped as `{requestId, data}` (health endpoints). */
  readonly data?: unknown;
  /** Extra response headers. */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface RouteMatch {
  readonly params: Readonly<Record<string, string>>;
}

export type RouteHandler = (
  context: RequestContext,
  match: RouteMatch,
) => Promise<RouteResponse | undefined> | RouteResponse | undefined;

export interface RequestContext {
  readonly requestId: string;
  readonly method: string;
  readonly pathname: string;
  readonly query: URLSearchParams;
  readonly headers: IncomingHttpHeaders;
  /** Parses the body as JSON (lazy, size-limited). */
  readonly readJson: <T = unknown>() => Promise<T>;
  /**
   * Replaces the request id used for the response envelope (and the
   * `x-request-id` header) with the one the client sent in the request body.
   */
  readonly useRequestId: (requestId: string) => void;
}

export interface RouterOptions {
  readonly logger?: Logger;
  readonly jsonBodyLimitBytes?: number;
  readonly requestIdHeader?: string;
  readonly generateRequestId?: () => string;
}

interface Route {
  readonly method: string;
  readonly segments: readonly string[];
  readonly handler: RouteHandler;
}

function splitPath(pathname: string): readonly string[] {
  return pathname.split("/").filter((segment) => segment !== "");
}

export class Router {
  readonly #routes: Route[] = [];
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
    const segments = splitPath(pathname);
    for (const segment of segments) {
      if (segment.startsWith(":") && !PARAM_PATTERN.test(segment.slice(1))) {
        throw new Error(`invalid route parameter: ${segment}`);
      }
    }
    this.#routes.push({ method: normalizedMethod, segments, handler });
    return this;
  }

  get(pathname: string, handler: RouteHandler): this {
    return this.add("GET", pathname, handler);
  }

  post(pathname: string, handler: RouteHandler): this {
    return this.add("POST", pathname, handler);
  }

  patch(pathname: string, handler: RouteHandler): this {
    return this.add("PATCH", pathname, handler);
  }

  delete(pathname: string, handler: RouteHandler): this {
    return this.add("DELETE", pathname, handler);
  }

  /** Builds the `node:http` server; the caller decides on `listen`. */
  createServer(): Server {
    return createServer((request, response) => {
      void this.handle(request, response);
    });
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let requestId = this.#resolveRequestId(request);
    response.setHeader(this.#requestIdHeader, requestId);
    const useRequestId = (value: string): void => {
      requestId = value;
      response.setHeader(this.#requestIdHeader, value);
    };
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const pathSegments = splitPath(url.pathname);
      const matches = this.#routes
        .map((route) => ({ route, params: matchRoute(route.segments, pathSegments) }))
        .filter((candidate): candidate is { route: Route; params: Record<string, string> } => candidate.params !== null);

      if (matches.length === 0) {
        throw notFound();
      }
      const method = (request.method ?? "GET").toUpperCase();
      const matched = matches.find((candidate) => candidate.route.method === method);
      if (matched === undefined) {
        throw methodNotAllowed([...new Set(matches.map((candidate) => candidate.route.method))]);
      }
      const context: RequestContext = {
        requestId,
        method,
        pathname: url.pathname,
        query: url.searchParams,
        headers: request.headers,
        readJson: <T = unknown>() => this.#readJson(request).then((body) => body as T),
        useRequestId,
      };
      const result = await matched.route.handler(context, { params: matched.params });
      if (result === undefined) {
        response.writeHead(204);
        response.end();
        return;
      }
      const status = result.status ?? 200;
      if (result.body !== undefined) {
        sendJson(response, status, result.body, result.headers ?? {});
        return;
      }
      sendJson(response, status, { requestId, data: result.data }, result.headers ?? {});
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
      const errorRequestId = error.requestId ?? requestId;
      if (error.requestId !== undefined) {
        response.setHeader(this.#requestIdHeader, error.requestId);
      }
      sendJson(response, error.status, errorEnvelope(errorRequestId, error.code, error.details), error.headers);
      return;
    }
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    this.#logger?.error("unhandled request error", { requestId, error: detail });
    sendJson(response, 500, errorEnvelope(requestId, "INTERNAL"));
  }
}

function matchRoute(routeSegments: readonly string[], pathSegments: readonly string[]): Record<string, string> | null {
  if (routeSegments.length !== pathSegments.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let index = 0; index < routeSegments.length; index += 1) {
    const routeSegment = routeSegments[index] ?? "";
    const pathSegment = pathSegments[index] ?? "";
    if (routeSegment.startsWith(":")) {
      if (pathSegment === "") {
        return null;
      }
      try {
        params[routeSegment.slice(1)] = decodeURIComponent(pathSegment);
      } catch {
        // Malformed percent-encoding can never address a route.
        return null;
      }
      continue;
    }
    if (routeSegment !== pathSegment) {
      return null;
    }
  }
  return params;
}
