import { useMemo, useState, useEffect, useCallback } from "react";
import { Search, Eye, EyeOff, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

import {
  CHANNEL_CODES,
  UTILITY_TYPES,
  type MetricsFilters,
} from "@/types/bbva";
import DateTimePicker from "@/components/DateTimePicker";

interface FilterPanelProps {
  onSearch: (filters: MetricsFilters) => void;
  loading?: boolean;
}

const SITES = ["LIVE-02", "LIVE-04"];
const BEARER_STORAGE_KEY = "bbva_bearer_token";
const LIMIT_OPTIONS = ["all", "10", "25", "50", "100"];

export default function FilterPanel({
  onSearch,
  loading = false,
}: FilterPanelProps) {
  const [fromDate, setFromDate] = useState<Date>(new Date());
  const [toDate, setToDate] = useState<Date>(new Date());
  const [site, setSite] = useState("LIVE-04");
  const [utilityType, setUtilityType] = useState("all");
  const [limit, setLimit] = useState("all");
  const [invokerTx, setInvokerTx] = useState("");
  const [channelSearch, setChannelSearch] = useState("");
  const [bearerToken, setBearerToken] = useState(() => {
    return localStorage.getItem(BEARER_STORAGE_KEY) || "";
  });
  const [showToken, setShowToken] = useState(false);
  const [channelCodes, setChannelCodes] = useState<string[]>([]);
  useEffect(() => {
    localStorage.setItem(BEARER_STORAGE_KEY, bearerToken);
  }, [bearerToken]);

  const isDateRangeValid = useMemo(() => {
    return fromDate.getTime() <= toDate.getTime();
  }, [fromDate, toDate]);

  const filteredChannelCodes = useMemo(() => {
    const q = channelSearch.trim().toLowerCase();

    if (!q) return CHANNEL_CODES;

    return CHANNEL_CODES.filter((item) => {
      const channelCode = item.channelCode.toLowerCase();
      const name = String(item.name ?? "").toLowerCase();

      const appsText = (item.applications ?? [])
        .map((app) => {
          return [app.channel, app.name, app.aap].filter(Boolean).join(" ");
        })
        .join(" ")
        .toLowerCase();

      return (
        channelCode.includes(q) || name.includes(q) || appsText.includes(q)
      );
    });
  }, [channelSearch]);

  const toggleChannelCode = (code: string) => {
    setChannelCodes((current) => {
      if (current.includes(code)) {
        return current.filter((item) => item !== code);
      }

      return [...current, code];
    });
  };

  const handleSearch = () => {
    if (!bearerToken.trim()) {
      toast.error("Bearer Token es requerido para consultar los endpoints.");
      return;
    }

    if (!isDateRangeValid) {
      toast.error("La fecha inicio no puede ser mayor que la fecha fin.");
      return;
    }

    const parsedLimit = Number(limit);
    const useAllInvokerTx = limit === "all";

    const filters: MetricsFilters = {
      fromDate,
      toDate,
      site,
      invokerTx: invokerTx.trim() || undefined,
      utilityType: utilityType === "all" ? undefined : utilityType,
      channelCodes: channelCodes.length ? channelCodes : undefined,
      channelCode: channelCodes.length === 1 ? channelCodes[0] : undefined,
      limit:
        useAllInvokerTx || !Number.isFinite(parsedLimit) || parsedLimit <= 0
          ? undefined
          : parsedLimit,
      bearerToken: bearerToken.trim(),
      searchMode: "pipeline",
      iterateAllInvokerTx: useAllInvokerTx,
    };

    onSearch(filters);
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Bearer Token</Label>
        <div className="relative">
          <Input
            type={showToken ? "text" : "password"}
            placeholder="Pega aquí el bearer token"
            className="pr-10 font-mono text-xs"
            value={bearerToken}
            onChange={(e) => setBearerToken(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowToken((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            {showToken ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Site</Label>
          <Select value={site} onValueChange={setSite}>
            <SelectTrigger className="font-mono text-xs">
              <SelectValue placeholder="Selecciona site" />
            </SelectTrigger>
            <SelectContent>
              {SITES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Utility Type</Label>
          <Select value={utilityType} onValueChange={setUtilityType}>
            <SelectTrigger className="font-mono text-xs">
              <SelectValue placeholder="Auto / Todos" />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value="all">Auto / Todos</SelectItem>

              {UTILITY_TYPES.map((ut) => (
                <SelectItem key={ut} value={ut}>
                  {ut}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Límite invokerTx
          </Label>
          <Select value={limit} onValueChange={setLimit}>
            <SelectTrigger className="font-mono text-xs">
              <SelectValue placeholder="Selecciona límite" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {LIMIT_OPTIONS.filter((v) => v !== "all").map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <Label className="text-xs text-muted-foreground">
            InvokerTx específico
          </Label>
          <Input
            type="text"
            placeholder="Ej. KUSUT07201ZZ"
            className="font-mono text-xs"
            value={invokerTx}
            onChange={(e) => setInvokerTx(e.target.value.toUpperCase())}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Fecha inicio</Label>
          <DateTimePicker value={fromDate} onChange={setFromDate} />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Fecha fin</Label>
          <DateTimePicker value={toDate} onChange={setToDate} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Channel-code</Label>

        <div className="rounded-xl border border-border bg-background p-3">
          <Input
            value={channelSearch}
            onChange={(event) => setChannelSearch(event.target.value)}
            placeholder="Buscar canal, aplicación o AAP..."
            className="mb-3 h-9 font-mono text-xs"
          />

          <div className="max-h-56 overflow-y-auto">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted">
              <input
                type="checkbox"
                checked={!channelCodes.length}
                onChange={() => setChannelCodes([])}
              />
              <span className="font-mono">Todos los canales</span>
            </label>

            {filteredChannelCodes.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                No se encontraron canales.
              </div>
            ) : (
              filteredChannelCodes.map((item) => {
                const apps = item.applications ?? [];

                return (
                  <label
                    key={item.channelCode}
                    className="block cursor-pointer rounded-lg px-2 py-2 text-xs hover:bg-muted"
                    title={apps
                      .map(
                        (app) =>
                          `${app.channel} · ${app.name} · AAP ${app.aap}`,
                      )
                      .join("\n")}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={channelCodes.includes(item.channelCode)}
                        onChange={() => toggleChannelCode(item.channelCode)}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold">
                            {item.channelCode}
                          </span>

                          <span className="truncate text-muted-foreground">
                            {apps.length > 0
                              ? apps.map((app) => app.name).join(" · ")
                              : item.name}
                          </span>
                        </div>

                        {apps.length > 0 && (
                          <div className="mt-1 max-h-14 overflow-hidden pl-1 text-[11px] leading-4 text-muted-foreground">
                            {apps.map((app) => (
                              <div
                                key={`${item.channelCode}-${app.aap}-${app.name}`}
                                className="truncate"
                              >
                                <span className="font-mono">AAP {app.aap}</span>
                                <span> · {app.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {channelCodes.length
            ? `Canales seleccionados: ${channelCodes.join(", ")}`
            : "Sin selección: se consultan todos los canales."}
        </p>
      </div>

      {!isDateRangeValid && (
        <div className="text-xs text-red-500">
          La fecha inicio debe ser menor o igual a la fecha fin.
        </div>
      )}

      <Button
        onClick={handleSearch}
        disabled={loading || !bearerToken.trim() || !isDateRangeValid}
        className="glow-primary"
      >
        <Search className="mr-2 h-4 w-4" />
        {loading ? "Consultando..." : "Consultar"}
      </Button>
    </div>
  );
}
