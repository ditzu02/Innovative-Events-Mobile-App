import { API_BASE_URL } from "@/constants/config";
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from "@/lib/auth-tokens";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type RequestOptions = RequestInit & { timeoutMs?: number };
type RefreshResponse = { access_token: string; refresh_token: string };

/**
 * Minimal fetch wrapper that applies the configured API base URL,
 * enforces a timeout, and throws typed errors for non-2xx responses.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error("API base URL is not set. Define EXPO_PUBLIC_API_URL.");
  }

  const { timeoutMs = 8000, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const isAuthEndpoint = path.startsWith("/api/auth/");

  const refreshSession = async (): Promise<string | null> => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) return null;
    const refreshController = new AbortController();
    const refreshTimer = setTimeout(() => refreshController.abort(), timeoutMs);
    try {
      const refreshResponse = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: refreshController.signal,
      });
      if (!refreshResponse.ok) {
        await clearTokens();
        return null;
      }
      const data = (await refreshResponse.json()) as RefreshResponse;
      if (!data?.access_token || !data?.refresh_token) {
        await clearTokens();
        return null;
      }
      await setTokens(data.access_token, data.refresh_token);
      return data.access_token;
    } catch {
      return null;
    } finally {
      clearTimeout(refreshTimer);
    }
  };

  try {
    const url = `${API_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
    const accessToken = await getAccessToken();

    const executeRequest = async (token: string | null) => {
      const headers = new Headers(rest.headers ?? {});
      if (token && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      return fetch(url, { ...rest, headers, signal: controller.signal });
    };

    let response = await executeRequest(accessToken ?? null);
    if (response.status === 401 && !isAuthEndpoint) {
      const refreshedToken = await refreshSession();
      if (refreshedToken) {
        response = await executeRequest(refreshedToken);
      } else if (accessToken) {
        await clearTokens();
      }
    }

    if (!response.ok) {
      const rawText = await response.text();
      let message = rawText || `Request failed with status ${response.status}`;
      if (rawText) {
        try {
          const parsed = JSON.parse(rawText) as { error?: unknown; message?: unknown };
          if (typeof parsed.error === "string" && parsed.error.trim()) {
            message = parsed.error;
          } else if (typeof parsed.message === "string" && parsed.message.trim()) {
            message = parsed.message;
          }
        } catch {
          // Leave message as raw text when response is not JSON.
        }
      }
      throw new ApiError(response.status, message);
    }

    return (await response.json()) as T;
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
