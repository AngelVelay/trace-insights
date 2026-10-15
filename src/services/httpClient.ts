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
  const parentSignal = fetchOptions.signal;
  if (parentSignal?.aborted) {
    throw new DOMException("Petición cancelada", "AbortError");
  }

  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort();
  parentSignal?.addEventListener("abort", forwardAbort, { once: true });
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

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
    if (parentSignal?.aborted) {
      throw new DOMException("Petición cancelada", "AbortError");
    }
    if (timedOut && error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Timeout excedido (${timeoutMs} ms)`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    parentSignal?.removeEventListener("abort", forwardAbort);
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

/** Espera entre reintentos respetando la cancelación del usuario. */
function retryPause(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Petición cancelada", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Petición cancelada", "AbortError"));
    };
    const timer = globalThis.setTimeout(finish, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Reintenta únicamente fallos transitorios de MU/RHO; nunca 400/401/403/404. */
export async function apiRequestWithRetry<T>(
  url: string,
  options: RequestOptions = {},
  maxAttempts = 3,
): Promise<T> {
  const attempts = Math.max(1, Math.min(4, maxAttempts));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw new DOMException("Petición cancelada", "AbortError");
    }
    try {
      return await apiRequest<T>(url, options);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const status = Number(message.match(/\bHTTP\s+(\d{3})\b/i)?.[1] ?? 0);
      const retryable = status
        ? status === 429 || status >= 500
        : error instanceof TypeError || /Timeout excedido|Failed to fetch|network error/i.test(message);
      if (!retryable || attempt === attempts) throw error;
      await retryPause(350 * 2 ** (attempt - 1), options.signal ?? undefined);
    }
  }
  throw new Error("No se pudo completar la consulta");
}
