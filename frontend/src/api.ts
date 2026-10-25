const configuredBase = import.meta.env.VITE_API_BASE_URL?.trim() || "";
const API_BASE = configuredBase.replace(/\/+$/, "");

export type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export async function getJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    throw new Error("Backend is not reachable.");
  }

  if (!response.ok) throw new Error(`Backend health check failed (${response.status}).`);
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error("Backend returned an unreadable health response.");
  }
}

export async function postJson<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(210_000)
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("The request timed out. Check the backend and try again.");
    }
    throw new Error("Could not connect to the backend. Check that it is running.");
  }

  let payload: T & { success?: boolean; error?: string };
  try {
    payload = (await response.json()) as T & { success?: boolean; error?: string };
  } catch {
    throw new Error("The backend returned an unreadable response.");
  }
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  return payload;
}
