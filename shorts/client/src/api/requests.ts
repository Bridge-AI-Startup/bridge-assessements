import { API_BASE_URL } from "@/config/api";
import { auth } from "@/firebase/firebase";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type ErrorField = "message" | "error";

/**
 * No usable response came back: the host refused the connection, or the
 * browser blocked the response because CORS rejected our origin. `fetch`
 * collapses both into a bare `TypeError: Failed to fetch` — it cannot tell
 * them apart, and neither can we, so the message has to name both.
 *
 * Both are common in local dev. The backend stops accepting connections for
 * a few seconds after any file under `server/` is saved (nodemon restart),
 * and the CORS allowlist in `server/src/server.ts` only covers specific dev
 * origins — a Vite port other than the usual one is rejected, which returns
 * a 500 with no CORS headers that the page never gets to see.
 *
 * The dev diagnostic is dev-build-only: in production the same failure is
 * almost always the *user's* connection (phone locked mid-request, cell
 * blip), so consumers get one plain sentence instead of instructions to
 * check a server log they don't have.
 */
export class ApiNetworkError extends Error {
  readonly url: string;
  readonly method: Method;

  constructor(method: Method, url: string, cause: unknown) {
    super(
      import.meta.env.DEV
        ? `No response from the Shorts API (${method} ${url}). Either the backend ` +
            `is not accepting connections — it restarts for a few seconds after ` +
            `any server file is saved, so check \`cd server && npm run dev\` is ` +
            `running — or it rejected this page's origin (${window.location.origin}) ` +
            `via CORS. Check the server log for a "Blocked request from ` +
            `unauthorized origin" warning.`
        : "Couldn't reach Bridge Shorts — check your connection and try again.",
    );
    this.name = "ApiNetworkError";
    this.url = url;
    this.method = method;
    this.cause = cause;
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    return {};
  }
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

async function fetchRequest(
  method: Method,
  path: string,
  body?: unknown,
  authenticated = false,
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  const hasBody = body !== undefined;

  const headers: Record<string, string> = {};
  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }
  if (authenticated) {
    Object.assign(headers, await getAuthHeaders());
  }

  try {
    return await fetch(url, {
      method,
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    // Only network-level failures land here; an HTTP error status resolves
    // normally and is handled by the caller off `res.ok`.
    throw new ApiNetworkError(method, url, error);
  }
}

export async function readJsonBody(
  response: Response,
): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({}));
  return body && typeof body === "object"
    ? (body as Record<string, unknown>)
    : {};
}

export function getResponseErrorMessage(
  body: Record<string, unknown>,
  status: number,
  errorFields: ErrorField[] = ["message", "error"],
): string {
  for (const field of errorFields) {
    if (typeof body[field] === "string") {
      return body[field];
    }
  }
  return `HTTP ${status}`;
}

export function getRequestErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export async function get(path: string): Promise<Response> {
  return fetchRequest("GET", path);
}

export async function post(path: string, body?: unknown): Promise<Response> {
  return fetchRequest("POST", path, body);
}

export async function put(path: string, body?: unknown): Promise<Response> {
  return fetchRequest("PUT", path, body);
}

export async function authGet(path: string): Promise<Response> {
  return fetchRequest("GET", path, undefined, true);
}

export async function authPost(path: string, body?: unknown): Promise<Response> {
  return fetchRequest("POST", path, body, true);
}

export async function authDelete(path: string): Promise<Response> {
  return fetchRequest("DELETE", path, undefined, true);
}

export async function authPatch(
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetchRequest("PATCH", path, body, true);
}
