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

        <div className="max-h-56 overflow-y-auto rounded-xl border border-border bg-background p-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted">
            <input
              type="checkbox"
              checked={!channelCodes.length}
              onChange={() => setChannelCodes([])}
            />
            <span className="font-mono">Todos los canales</span>
          </label>

          {CHANNEL_CODES.map((item) => (
            <label
              key={item.channelCode}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-xs hover:bg-muted"
            >
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={channelCodes.includes(item.channelCode)}
                  onChange={() => toggleChannelCode(item.channelCode)}
                />
                <span className="font-mono">{item.channelCode}</span>
              </span>

              <div className="block w-full">
                {/* Definimos una altura máxima fija y permitimos el scroll vertical */}
                <div className="max-h-32 overflow-y-auto pr-2 custom-scrollbar">
                  <div className="flex flex-wrap gap-2">
                    {item.aap
                      .toLocaleString()
                      .split(",")
                      .map((id, index) => {
                        const cleanId = id.trim();
                        return (
                          <span
                            // SOLUCIÓN AL ERROR DE KEY: Combinamos el valor con el índice
                            key={`${cleanId}-${index}`}
                            className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-gray-500/10"
                          >
                            {cleanId}
                          </span>
                        );
                      })}
                  </div>
                </div>
              </div>
            </label>
          ))}
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
