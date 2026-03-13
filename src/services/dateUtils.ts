// ============================================================
// Date Utils
// ============================================================
import type { NanoTimestamp } from "@/types/bbva";

export function toNanoTimestamp(date: Date): NanoTimestamp {
  return `${date.getTime()}000000`;
}

export function dateRangeToNano(fromDate: Date, toDate: Date): {
  from: NanoTimestamp;
  to: NanoTimestamp;
} {
  return {
    from: toNanoTimestamp(fromDate),
    to: toNanoTimestamp(toDate),
  };
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms)) return "0 ms";

  if (ms < 1) {
    return `${(ms * 1000).toFixed(2)} μs`;
  }

  if (ms < 1000) {
    return `${ms.toFixed(2)} ms`;
  }

  return `${(ms / 1000).toFixed(2)} s`;
}