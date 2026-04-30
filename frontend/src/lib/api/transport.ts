function resolveApiBaseUrl() {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL;
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  if (typeof window === "undefined") {
    return "";
  }

  const protocol = window.location.protocol;
  if (protocol === "http:" || protocol === "https:") {
    return "";
  }

  return "http://127.0.0.1:8000";
}

const API_BASE = resolveApiBaseUrl();

export function withAccountId(path: string, accountId?: string) {
  if (!accountId) {
    return path;
  }
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}accountId=${encodeURIComponent(accountId)}`;
}

export function withAccountKey(path: string, accountKey: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}accountKey=${encodeURIComponent(accountKey)}`;
}

function formatApiErrorDetail(detail: unknown): string | null {
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }
  if (Array.isArray(detail)) {
    const entries = detail
      .map((entry) => formatValidationEntry(entry))
      .filter((entry): entry is string => Boolean(entry));
    return entries.length ? entries.join(" ") : null;
  }
  if (detail && typeof detail === "object") {
    const structured = detail as { code?: unknown; message?: unknown; limitations?: unknown };
    const message = typeof structured.message === "string" ? structured.message.trim() : "";
    const code = typeof structured.code === "string" ? structured.code.trim() : "";
    const limitations = Array.isArray(structured.limitations)
      ? structured.limitations.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
      : [];
    if (message) {
      const suffix = [code ? `Code: ${code}.` : "", ...limitations].filter(Boolean).join(" ");
      return suffix ? `${message} ${suffix}` : message;
    }
    try {
      return JSON.stringify(detail);
    } catch {
      return null;
    }
  }
  return null;
}

function formatValidationEntry(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") {
    return typeof entry === "string" ? entry : null;
  }
  const candidate = entry as { loc?: unknown; msg?: unknown };
  const msg = typeof candidate.msg === "string" ? candidate.msg : null;
  const loc = Array.isArray(candidate.loc)
    ? candidate.loc
        .map((segment) => (typeof segment === "string" || typeof segment === "number" ? String(segment) : null))
        .filter((segment): segment is string => Boolean(segment))
        .filter((segment) => segment !== "body")
    : [];
  if (msg && loc.length) {
    return `${loc.join(".")}: ${msg}`;
  }
  return msg;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch {
    const fallbackBase = API_BASE || "the configured API";
    throw new Error(`Could not reach local backend at ${fallbackBase}. The desktop app may still be starting its local service.`);
  }
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as { detail?: unknown };
      const formattedDetail = formatApiErrorDetail(payload.detail);
      if (formattedDetail) {
        message = formattedDetail;
      }
    } catch {
      // Keep the HTTP status text when the server does not return JSON.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function fetchJson<T>(path: string): Promise<T> {
  return requestJson<T>(path);
}

export async function postJson<T>(path: string, body?: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
}
