import { toast } from "sonner";

type RequestOptions = RequestInit & {
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 20000;

export async function apiRequest<T>(
  url: string,
  options: RequestOptions = {}
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `HTTP ${response.status} ${response.statusText} - ${body?.slice(0, 300) ?? ""}`
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Timeout excedido (${timeoutMs} ms)`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function buildAuthHeaders(bearerToken?: string): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (bearerToken?.trim()) {
    headers.Authorization = `Bearer ${bearerToken.trim()}`;
  }

  return headers;
}

export function createConcurrencyLimiter(limit: number) {
  let activeCount = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    activeCount -= 1;
    const task = queue.shift();
    if (task) task();
  };

  return async function runLimited<T>(fn: () => Promise<T>): Promise<T> {
    if (activeCount >= limit) {
      await new Promise<void>((resolve) => {
        queue.push(resolve);
      });
    }

    activeCount += 1;

    try {
      return await fn();
    } finally {
      next();
    }
  };
}

export function notifyHttpError(error: unknown, fallback = "Error de red") {
  const message = error instanceof Error ? error.message : fallback;
  toast.error(message);
}