import { useMemo, useState, useEffect } from "react";
import {
  CalendarIcon,
  Search,
  Eye,
  EyeOff,
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

import {
  UTILITY_TYPES,
  type MetricsFilters,
} from "@/types/bbva";

interface FilterPanelProps {
  onSearch: (filters: MetricsFilters) => void;
  loading?: boolean;
}

const SITES = ["LIVE-02", "LIVE-04"];
const BEARER_STORAGE_KEY = "bbva_bearer_token";

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

export default function FilterPanel({
  onSearch,
  loading = false,
}: FilterPanelProps) {
  const [fromDate, setFromDate] = useState<Date>(new Date());
  const [toDate, setToDate] = useState<Date>(new Date());
  const [site, setSite] = useState("LIVE-04");
  const [utilityType, setUtilityType] = useState("all");
  const [limit, setLimit] = useState("10");
  const [bearerToken, setBearerToken] = useState(() => {
    return localStorage.getItem(BEARER_STORAGE_KEY) || "";
  });
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    localStorage.setItem(BEARER_STORAGE_KEY, bearerToken);
  }, [bearerToken]);

  const isDateRangeValid = useMemo(() => {
    return atStartOfDay(fromDate).getTime() <= atEndOfDay(toDate).getTime();
  }, [fromDate, toDate]);

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

    const filters: MetricsFilters = {
      fromDate: atStartOfDay(fromDate),
      toDate: atEndOfDay(toDate),
      site,
      utilityType: utilityType === "all" ? undefined : utilityType,
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined,
      bearerToken: bearerToken.trim(),
      searchMode: "pipeline",
      iterateAllInvokerTx: true,
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
          <Label className="text-xs text-muted-foreground">Límite invokerTx</Label>
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

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Fecha inicio</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start font-mono text-xs",
                  !fromDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {fromDate ? format(fromDate, "dd/MM/yyyy") : "Selecciona fecha"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={fromDate}
                onSelect={(d) => d && setFromDate(d)}
                initialFocus
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
                  "w-full justify-start font-mono text-xs",
                  !toDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {toDate ? format(toDate, "dd/MM/yyyy") : "Selecciona fecha"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={toDate}
                onSelect={(d) => d && setToDate(d)}
                initialFocus
              />
            </PopoverContent>
          </Popover>
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
        {loading ? "Consultando..." : "Consultar todos los invokerTx"}
      </Button>
    </div>
  );
}