const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5070";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.message || data.error || response.statusText;
    throw new Error(message);
  }
  return data;
}

export function fetchTickets({ priority, status, search } = {}) {
  const params = new URLSearchParams();
  if (priority) params.set("priority", priority);
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  const query = params.toString();
  return request(`/api/tickets${query ? `?${query}` : ""}`);
}

export function fetchStats() {
  return request("/api/stats");
}

export function createTicket(body) {
  return request("/api/tickets", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateTicket(id, body) {
  return request(`/api/tickets/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
