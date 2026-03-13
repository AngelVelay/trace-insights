import { useMemo, useState } from "react";
import {
  CalendarIcon,
  Search,
  KeyRound,
  Eye,
  EyeOff,
  Settings2,
  Layers3,
} from "lucide-react";
import { format } from "date-fns";

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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { UTILITY_TYPES, type MetricsFilters } from "@/types/bbva";

interface FilterPanelProps {
  onSearch: (filters: MetricsFilters) => void;
  loading?: boolean;
}

const SITES = ["LIVE-01", "LIVE-02", "LIVE-03", "LIVE-04", "LIVE-05"];

const SEARCH_MODES = [
  { value: "pipeline", label: "Pipeline completo (todos los invokerTx)" },
  { value: "utility", label: "Utility metrics" },
  { value: "rho", label: "RHO trazas" },
] as const;

type SearchMode = (typeof SEARCH_MODES)[number]["value"];

function atStartOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function atEndOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export default function FilterPanel({ onSearch, loading = false }: FilterPanelProps) {
  const [searchMode, setSearchMode] = useState<SearchMode>("pipeline");
  const [fromDate, setFromDate] = useState<Date>(new Date());
  const [toDate, setToDate] = useState<Date>(new Date());
  const [site, setSite] = useState("LIVE-04");
  const [invokerTx, setInvokerTx] = useState("");
  const [utilityType, setUtilityType] = useState("all");
  const [limit, setLimit] = useState("10");
  const [bearerToken, setBearerToken] = useState("");
  const [showToken, setShowToken] = useState(false);

  const isDateRangeValid = useMemo(() => {
    return atStartOfDay(fromDate).getTime() <= atEndOfDay(toDate).getTime();
  }, [fromDate, toDate]);

  const isPipelineMode = searchMode === "pipeline";
  const requiresInvokerTx = searchMode === "utility" || searchMode === "rho";

  const handleSearch = () => {
    if (!bearerToken.trim()) {
      toast.error("Bearer Token es requerido para consultar los endpoints.");
      return;
    }

    if (!isDateRangeValid) {
      toast.error("La fecha inicio no puede ser mayor que la fecha fin.");
      return;
    }

    if (requiresInvokerTx && !invokerTx.trim()) {
      toast.error("InvokerTx es requerido para este tipo de búsqueda.");
      return;
    }

    const parsedLimit = Number(limit);
    const normalizedFrom = atStartOfDay(fromDate);
    const normalizedTo = atEndOfDay(toDate);

    const filters: MetricsFilters = {
      fromDate: normalizedFrom,
      toDate: normalizedTo,
      site: site || undefined,
      invokerTx: isPipelineMode ? undefined : invokerTx.trim() || undefined,
      utilityType: utilityType === "all" ? undefined : utilityType,
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined,
      bearerToken: bearerToken.trim(),
      searchMode,
      iterateAllInvokerTx: isPipelineMode,
    };
    
    onSearch(filters);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Filtros de consulta
        </h2>

        <div className="w-full max-w-[280px]">
          <Select value={searchMode} onValueChange={(v) => setSearchMode(v as SearchMode)}>
            <SelectTrigger className="font-mono text-xs">
              <Settings2 className="mr-2 h-3.5 w-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEARCH_MODES.map((mode) => (
                <SelectItem key={mode.value} value={mode.value}>
                  {mode.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
          <KeyRound className="h-3 w-3" />
          Bearer Token
        </Label>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={showToken ? "text" : "password"}
              placeholder="Pega tu Bearer Token aquí..."
              className="font-mono text-xs pr-10"
              value={bearerToken}
              onChange={(e) => setBearerToken(e.target.value)}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowToken((prev) => !prev)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {bearerToken.trim() && (
            <span className="flex items-center text-xs text-emerald-500 font-medium">
              ✓ Configurado
            </span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          El token se usa solo en memoria. En modo pipeline se consulta MU para obtener todos los invokerTx.
        </p>
      </div>

      {isPipelineMode && (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400 flex items-start gap-2">
          <Layers3 className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            Se consultará primero el endpoint MU con <span className="font-mono">aggregate="invokerTx"</span>.
            Después se tomarán todos los <span className="font-mono">bucket.invokerTx</span> y se mandarán a la tabla.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Fecha inicio</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-mono text-xs",
                  !fromDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                {fromDate ? format(fromDate, "yyyy-MM-dd") : "Seleccionar"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={fromDate}
                onSelect={(d) => d && setFromDate(d)}
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Fecha fin</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-mono text-xs",
                  !toDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                {toDate ? format(toDate, "yyyy-MM-dd") : "Seleccionar"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={toDate}
                onSelect={(d) => d && setToDate(d)}
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Site</Label>
          <Select value={site} onValueChange={setSite}>
            <SelectTrigger className="font-mono text-xs">
              <SelectValue />
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
  <Label className="text-xs text-muted-foreground">InvokerTx</Label>
  <Input
    placeholder={
      isPipelineMode
        ? "Automático: se toman todos desde MU"
        : "Ej: KUSUT05402ZZ"
    }
    className="font-mono text-xs"
    value={isPipelineMode ? "" : invokerTx}
    onChange={(e) => setInvokerTx(e.target.value.toUpperCase())}
    disabled={isPipelineMode}
  />
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
            {isPipelineMode ? "Límite invokerTx" : "Límite"}
          </Label>
          <Input
            type="number"
            min="1"
            placeholder="10"
            className="font-mono text-xs"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </div>
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
        {loading
          ? "Consultando..."
          : isPipelineMode
          ? "Consultar todos los invokerTx"
          : "Ejecutar consulta"}
      </Button>
    </div>
  );
}