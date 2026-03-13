// ============================================================
// HTTP client with retries, timeouts, error handling
// ============================================================

interface FetchOptions extends RequestInit {
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

async function fetchWithTimeout(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeout = 30000, ...fetchOpts } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { ...fetchOpts, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}



export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    console.error("Respuesta no JSON:", text);
    throw new Error("La respuesta no es JSON válido");
  }
}

// Build auth headers
export function buildAuthHeaders(bearerToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
  };
  if (bearerToken) {
    headers['Authorization'] = `Bearer ${bearerToken}`;
  }
  return headers;
}

// Concurrency limiter
export function createConcurrencyLimiter(maxConcurrent: number) {
  let running = 0;
  const queue: (() => void)[] = [];

  function next() {
    if (queue.length > 0 && running < maxConcurrent) {
      running++;
      const resolve = queue.shift()!;
      resolve();
    }
  }

  return async function <T>(fn: () => Promise<T>): Promise<T> {
    if (running >= maxConcurrent) {
      await new Promise<void>((resolve) => queue.push(resolve));
    } else {
      running++;
    }

    try {
      return await fn();
    } finally {
      running--;
      next();
    }
  };

  
}
