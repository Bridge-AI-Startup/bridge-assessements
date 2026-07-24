import { API_BASE_URL } from "@/config/api";
import { auth } from "@/firebase/firebase";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type ErrorField = "message" | "error";

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

  return fetch(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
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

export async function patch(path: string, body?: unknown): Promise<Response> {
  return fetchRequest("PATCH", path, body);
}

export async function authGet(path: string): Promise<Response> {
  return fetchRequest("GET", path, undefined, true);
}

export async function authPost(path: string, body?: unknown): Promise<Response> {
  return fetchRequest("POST", path, body, true);
}

export async function authPatch(
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetchRequest("PATCH", path, body, true);
}
