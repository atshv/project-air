/**
 * Minimal `fetch` abstraction so the SDK needs no type package and can be used
 * in the browser and under Node (both provide a global `fetch`).
 */

export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export interface FetchRequest {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string | undefined;
  /** `"include"` for cookie-authenticated browser requests (same-origin proxy). */
  readonly credentials?: "include" | undefined;
}

export type FetchLike = (url: string, request: FetchRequest) => Promise<FetchResponse>;

export const defaultFetch: FetchLike = (url, request) => {
  const implementation = (
    globalThis as {
      fetch?: (url: string, init: FetchRequest) => Promise<FetchResponse>;
    }
  ).fetch;
  if (implementation === undefined) {
    throw new Error("the SDK needs a fetch implementation; pass options.fetch");
  }
  return implementation(url, request);
};
