import type { ClassifiedTraces, NormalizedSpan } from '@/types/bbva';
import { formatDurationMs } from '@/services/dateUtils';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

interface TracesViewProps {
  classified: ClassifiedTraces;
  allSpans: NormalizedSpan[];
}

const sectionMeta: { key: keyof ClassifiedTraces; label: string; color: string }[] = [
  { key: 'InterBackendCics', label: 'CICS', color: 'text-destructive' },
  { key: 'APIInternalConnectorImpl', label: 'API Connector', color: 'text-primary' },
  { key: 'Jdbc', label: 'JDBC', color: 'text-accent' },
  { key: 'DaasMongoConnector', label: 'Mongo', color: 'text-warning' },
  { key: 'other', label: 'Otros', color: 'text-muted-foreground' },
];

export default function TracesView({ classified, allSpans }: TracesViewProps) {
  const topSlow = [...allSpans].sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);

  return (
    <div className="space-y-4">
      {/* Top slow */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Top 10 operaciones más lentas
        </h3>
        <div className="space-y-1.5">
          {topSlow.map((sp, i) => (
            <div key={sp.spanId} className="flex items-center gap-3 text-xs font-mono">
              <span className="text-muted-foreground w-5 text-right">{i + 1}.</span>
              <span className="flex-1 truncate">{sp.name}</span>
              <span className="inline-block rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground">
                {sp.utilityType}
              </span>
              <span className="text-primary font-semibold w-20 text-right">
                {formatDurationMs(sp.durationMs)}
              </span>
            </div>
          ))}
          {topSlow.length === 0 && (
            <p className="text-muted-foreground text-sm">Sin trazas disponibles</p>
          )}
        </div>
      </div>

      {/* By category */}
      <Accordion type="multiple" className="space-y-2">
        {sectionMeta.map(({ key, label, color }) => {
          const spans = classified[key];
          if (spans.length === 0) return null;

          // Group by name
          const groups = new Map<string, NormalizedSpan[]>();
          for (const sp of spans) {
            if (!groups.has(sp.name)) groups.set(sp.name, []);
            groups.get(sp.name)!.push(sp);
          }

          const totalDur = spans.reduce((s, sp) => s + sp.durationMs, 0);

          return (
            <AccordionItem
              key={key}
              value={key}
              className="rounded-lg border border-border bg-card px-4"
            >
              <AccordionTrigger className="text-sm hover:no-underline">
                <div className="flex items-center gap-3">
                  <span className={`font-semibold ${color}`}>{label}</span>
                  <span className="text-xs text-muted-foreground">
                    {spans.length} saltos · {formatDurationMs(totalDur)}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-1 py-2">
                  {[...groups.entries()]
                    .sort((a, b) => b[1].length - a[1].length)
                    .map(([name, group]) => {
                      const avg = group.reduce((s, sp) => s + sp.durationMs, 0) / group.length;
                      return (
                        <div key={name} className="flex items-center gap-3 text-xs font-mono py-1 border-b border-border/50 last:border-0">
                          <span className="flex-1 truncate">{name}</span>
                          {group.length > 1 && (
                            <span className="text-muted-foreground">×{group.length}</span>
                          )}
                          <span className="text-primary w-20 text-right">
                            {formatDurationMs(avg)}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}
