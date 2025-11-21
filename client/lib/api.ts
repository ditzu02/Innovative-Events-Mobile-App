import { API_BASE_URL } from "@/constants/config";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type RequestOptions = RequestInit & { timeoutMs?: number };

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

  try {
    const url = `${API_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
    const response = await fetch(url, { ...rest, signal: controller.signal });

    if (!response.ok) {
      const text = await response.text();
      throw new ApiError(response.status, text || `Request failed with status ${response.status}`);
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
