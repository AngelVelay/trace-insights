// ============================================================
// CSV / TXT Export utilities
// ============================================================
import type { MetricRow, NormalizedSpan, ClassifiedTraces } from '@/types/bbva';
import { formatDurationMs } from './dateUtils';

// ---- CSV Export ----
export function metricsToCSV(rows: MetricRow[]): string {
  const headers = [
    'site',
    'invokerTx',
    'invokerLibrary',
    'utilitytype',
    'invokedparam',
    'utility_count',
    'min_utility_duration',
    'mean_utility_duration',
    'max_utility_duration',
  ];

  const lines = [headers.join(',')];

  for (const row of rows) {
    lines.push(
      [
        row.site,
        row.invokerTx,
        row.invokerLibrary,
        row.utilitytype,
        `"${row.invokedparam}"`,
        row.utility_count,
        row.min_utility_duration.toFixed(2),
        row.mean_utility_duration.toFixed(2),
        row.max_utility_duration.toFixed(2),
      ].join(',')
    );
  }

  return lines.join('\n');
}

// ---- TXT Export (hierarchical trace view) ----
export function tracesToTXT(
  classified: ClassifiedTraces,
  allSpans: NormalizedSpan[]
): string {
  const lines: string[] = [];
  const totalJumps = allSpans.length;
  const totalDuration = allSpans.reduce((s, sp) => s + sp.durationMs, 0);
  const avgDuration = totalJumps > 0 ? totalDuration / totalJumps : 0;

  // Top slowest
  const topSlow = [...allSpans].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);

  lines.push('══════════════════════════════════════════════════════════');
  lines.push('  RESUMEN EJECUTIVO DE TRAZAS');
  lines.push('══════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`  Total de saltos encontrados: ${totalJumps}`);
  lines.push(`  Tiempo total de saltos:      ${formatDurationMs(totalDuration)}`);
  lines.push(`  Tiempo promedio por operación: ${formatDurationMs(avgDuration)}`);
  lines.push('');
  lines.push('── Top 10 operaciones más lentas ──');
  topSlow.forEach((sp, i) => {
    lines.push(`  ${i + 1}. ${sp.name} → ${formatDurationMs(sp.durationMs)} [${sp.utilityType}]`);
  });
  lines.push('');

  const sections: [string, NormalizedSpan[]][] = [
    ['API-CONNECTOR (APIInternalConnectorImpl)', classified.APIInternalConnectorImpl],
    ['CICS (InterBackendCics)', classified.InterBackendCics],
    ['JDBC', classified.Jdbc],
    ['MONGO CONNECTOR (DaasMongoConnector)', classified.DaasMongoConnector],
    ['OTROS', classified.other],
  ];

  for (const [title, spans] of sections) {
    if (spans.length === 0) continue;

    lines.push(`┌─── ${title} (${spans.length} saltos) ───`);
    lines.push('│');

    // Group by name
    const groups = new Map<string, NormalizedSpan[]>();
    for (const sp of spans) {
      const key = sp.name;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(sp);
    }

    const entries = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

    for (const [name, group] of entries) {
      const avg = group.reduce((s, sp) => s + sp.durationMs, 0) / group.length;
      if (group.length > 1) {
        lines.push(`├── ${name} (×${group.length}, prom: ${formatDurationMs(avg)})`);
      } else {
        lines.push(`├── ${name} → ${formatDurationMs(group[0].durationMs)}`);
      }
    }

    lines.push('│');
    lines.push('└───');
    lines.push('');
  }

  return lines.join('\n');
}

// ---- Download helper ----
export function downloadFile(content: string, filename: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
