import type { ClassifiedTraces, NormalizedSpan } from "@/types/bbva";
import { formatDurationMs } from "@/services/dateUtils";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface TracesViewProps {
  classified: ClassifiedTraces;
  allSpans: NormalizedSpan[];
}

const sectionMeta: {
  key: keyof ClassifiedTraces;
  label: string;
  color: string;
}[] = [
  {
    key: "InterBackendCics",
    label: "CICS",
    color: "text-destructive",
  },
  {
    key: "APIInternalConnectorImpl",
    label: "API Connector Interno",
    color: "text-primary",
  },
  {
    key: "APIExternalConnectorImpl",
    label: "API Connector Externo",
    color: "text-primary",
  },
  {
    key: "Jdbc",
    label: "JDBC",
    color: "text-accent",
  },
  {
    key: "Jpa",
    label: "JPA",
    color: "text-accent",
  },
  {
    key: "DaasMongoConnector",
    label: "Mongo",
    color: "text-warning",
  },
  {
    key: "TitanClient",
    label: "Titan Client",
    color: "text-warning",
  },
  {
    key: "GRPCClient",
    label: "GRPC Client",
    color: "text-warning",
  },
  {
    key: "other",
    label: "Otros",
    color: "text-muted-foreground",
  },
];

function getSpanLibrary(span: NormalizedSpan): string {
  return String(
    span.properties?.invokerLibrary ??
      span.properties?.library ??
      span.properties?.invokerlibrary ??
      "-"
  ).trim();
}

function getSpanInvokedParam(span: NormalizedSpan): string {
  return String(
    span.properties?.invokedparam ??
      span.properties?.databaseQuery ??
      span.properties?.collection ??
      span.name ??
      "-"
  ).trim();
}

function getSpanChannelCode(span: NormalizedSpan): string {
  return String(
    span.channelCode ??
      span.properties?.["channel-code"] ??
      span.properties?.channelCode ??
      "-"
  ).trim();
}

function getGroupKey(span: NormalizedSpan): string {
  const library = getSpanLibrary(span);
  const invokedParam = getSpanInvokedParam(span);

  if (library !== "-" && invokedParam !== "-") {
    return `${library} / ${invokedParam}`;
  }

  if (span.name) return span.name;

  return span.spanId;
}

export default function TracesView({ classified, allSpans }: TracesViewProps) {
  const topSlow = [...allSpans]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Top 10 operaciones más lentas
        </h3>

        <div className="space-y-1.5">
          {topSlow.map((sp, i) => {
            const library = getSpanLibrary(sp);
            const invokedParam = getSpanInvokedParam(sp);
            const channelCode = getSpanChannelCode(sp);

            return (
              <div
                key={sp.spanId}
                className="grid grid-cols-[2rem_minmax(0,1fr)_auto_auto_auto] items-center gap-3 text-xs font-mono"
              >
                <span className="text-right text-muted-foreground">
                  {i + 1}.
                </span>

                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {sp.name || invokedParam}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    Library: {library} · InvokedParam: {invokedParam} · Canal:{" "}
                    {channelCode}
                  </div>
                </div>

                <span className="inline-block rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground">
                  {sp.utilityType}
                </span>

                <span className="inline-block rounded border border-border bg-muted/40 px-1.5 py-0.5 text-muted-foreground">
                  {channelCode}
                </span>

                <span className="w-20 text-right font-semibold text-primary">
                  {formatDurationMs(sp.durationMs)}
                </span>
              </div>
            );
          })}

          {topSlow.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sin trazas disponibles
            </p>
          )}
        </div>
      </div>

      <Accordion type="multiple" className="space-y-2">
        {sectionMeta.map(({ key, label, color }) => {
          const spans = classified[key] ?? [];

          if (spans.length === 0) return null;

          const groups = new Map<string, NormalizedSpan[]>();

          for (const span of spans) {
            const groupKey = getGroupKey(span);

            if (!groups.has(groupKey)) {
              groups.set(groupKey, []);
            }

            groups.get(groupKey)!.push(span);
          }

          const totalDur = spans.reduce(
            (sum, span) => sum + Number(span.durationMs ?? 0),
            0
          );

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
                      const total = group.reduce(
                        (sum, span) => sum + Number(span.durationMs ?? 0),
                        0
                      );

                      const avg = group.length > 0 ? total / group.length : 0;
                      const sample = group[0];

                      const library = getSpanLibrary(sample);
                      const invokedParam = getSpanInvokedParam(sample);
                      const channelCode = getSpanChannelCode(sample);

                      return (
                        <div
                          key={name}
                          className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border/50 py-2 text-xs font-mono last:border-0"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium">{name}</div>

                            <div className="truncate text-[11px] text-muted-foreground">
                              Library: {library} · InvokedParam: {invokedParam} ·
                              Canal: {channelCode}
                            </div>
                          </div>

                          {group.length > 1 && (
                            <span className="text-muted-foreground">
                              ×{group.length}
                            </span>
                          )}

                          <span className="w-20 text-right text-primary">
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