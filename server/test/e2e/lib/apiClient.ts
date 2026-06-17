/**
 * Thin HTTP client for hitting the live backend during E2E. Mirrors the
 * client/src/api/requests.ts contract (Bearer auth, JSON) but adds:
 *  - a hard per-request timeout (AbortController) so a hung request can never
 *    jam the terminal,
 *  - multipart/form-data uploads for frames / video chunks / archives.
 */

import { API_BASE_URL, BUDGETS } from "./config.js";

export interface ApiResponse<T = any> {
  ok: boolean;
  status: number;
  body: T;
  rawText: string;
}

export class ApiClient {
  constructor(
    private baseUrl: string = API_BASE_URL,
    private token: string | null = null
  ) {}

  withToken(token: string | null): ApiClient {
    return new ApiClient(this.baseUrl, token);
  }

  private authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  async request<T = any>(
    method: string,
    path: string,
    opts: {
      json?: unknown;
      form?: FormData;
      headers?: Record<string, string>;
      timeoutMs?: number;
    } = {}
  ): Promise<ApiResponse<T>> {
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? BUDGETS.apiCall;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      ...this.authHeaders(),
      ...(opts.headers || {}),
    };
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.form) {
      body = opts.form as unknown as BodyInit;
    }

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      const rawText = await res.text();
      let parsed: any = rawText;
      try {
        parsed = rawText ? JSON.parse(rawText) : null;
      } catch {
        /* non-JSON body (e.g. JSONL transcript) */
      }
      return { ok: res.ok, status: res.status, body: parsed, rawText };
    } catch (err: any) {
      if (err?.name === "AbortError") {
        throw new Error(
          `Request ${method} ${path} exceeded ${timeoutMs}ms budget (aborted)`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  get<T = any>(path: string, timeoutMs?: number) {
    return this.request<T>("GET", path, { timeoutMs });
  }
  post<T = any>(path: string, json?: unknown, timeoutMs?: number) {
    return this.request<T>("POST", path, { json, timeoutMs });
  }
  patch<T = any>(path: string, json?: unknown, timeoutMs?: number) {
    return this.request<T>("PATCH", path, { json, timeoutMs });
  }
  del<T = any>(path: string, json?: unknown, timeoutMs?: number) {
    return this.request<T>("DELETE", path, { json, timeoutMs });
  }
  postForm<T = any>(path: string, form: FormData, timeoutMs?: number) {
    return this.request<T>("POST", path, { form, timeoutMs });
  }
}

/** Convenience: assert a response is ok or throw a descriptive error. */
export function expectOk<T>(res: ApiResponse<T>, label: string): T {
  if (!res.ok) {
    throw new Error(
      `${label} -> ${res.status}: ${res.rawText?.slice(0, 500) || "(no body)"}`
    );
  }
  return res.body;
}
