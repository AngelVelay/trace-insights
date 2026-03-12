// ============================================================
// Date utilities for BBVA nanosecond timestamps
// ============================================================
import type { NanoTimestamp } from '@/types/bbva';

export function toNano(date: Date): NanoTimestamp {
  return (BigInt(date.getTime()) * 1000000n).toString();
}

export function fromNano(nano: NanoTimestamp): Date {
  return new Date(Number(BigInt(nano) / 1000000n));
}

export function fullDayRange(date: Date): { from: NanoTimestamp; to: NanoTimestamp } {
  const from = new Date(date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(date);
  to.setHours(23, 59, 59, 999);
  return { from: toNano(from), to: toNano(to) };
}

export function dateRangeToNano(from: Date, to: Date): { from: NanoTimestamp; to: NanoTimestamp } {
  return { from: toNano(from), to: toNano(to) };
}

export function formatDateDisplay(date: Date): string {
  return date.toLocaleString('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDurationMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
