// ============================================================
// HTTP Client
// ============================================================

export function buildAuthHeaders(token?: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  return headers;
}

export async function apiRequest<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} - ${rawText.slice(0, 300)}`
    );
  }

  if (!rawText || rawText.trim().length === 0) {
    return {} as T;
  }

  try {
    return JSON.parse(rawText) as T;
  } catch (error) {
    throw new Error(
      `JSON.parse falló. Respuesta no JSON recibida: ${rawText.slice(0, 300)}`
    );
  }
}

export function createConcurrencyLimiter(maxConcurrent = 5) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active--;
    const job = queue.shift();
    if (job) job();
  };

  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }

    active++;

    try {
      return await fn();
    } finally {
      next();
    }
  };
}