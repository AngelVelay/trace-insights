import { useState } from 'react';
import { CalendarIcon, Search, KeyRound, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { UTILITY_TYPES, type MetricsFilters } from '@/types/bbva';
import { toast } from 'sonner';

interface FilterPanelProps {
  onSearch: (filters: MetricsFilters) => void;
  loading?: boolean;
}

const SITES = ['LIVE-01', 'LIVE-02', 'LIVE-03', 'LIVE-04', 'LIVE-05'];

export default function FilterPanel({ onSearch, loading }: FilterPanelProps) {
  const [fromDate, setFromDate] = useState<Date>(new Date());
  const [toDate, setToDate] = useState<Date>(new Date());
  const [site, setSite] = useState('LIVE-04');
  const [invokerTx, setInvokerTx] = useState('');
  const [utilityType, setUtilityType] = useState('');
  const [limit, setLimit] = useState('10');
  const [bearerToken, setBearerToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  const handleSearch = () => {
    if (!bearerToken.trim()) {
      toast.error('Bearer Token es requerido para consultar los endpoints.');
      return;
    }

    onSearch({
      fromDate,
      toDate,
      site: site || undefined,
      invokerTx: invokerTx || undefined,
      utilityType: utilityType === 'all' ? undefined : utilityType || undefined,
      limit: limit ? Number(limit) : undefined,
      bearerToken: bearerToken.trim(),
    });
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Filtros de consulta
      </h2>

      {/* Bearer Token row */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
          <KeyRound className="h-3 w-3" />
          Bearer Token
        </Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={showToken ? 'text' : 'password'}
              placeholder="Pega tu Bearer Token aquí..."
              className="font-mono text-xs pr-10"
              value={bearerToken}
              onChange={(e) => setBearerToken(e.target.value)}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {bearerToken && (
            <span className="flex items-center text-xs text-accent font-medium">✓ Configurado</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          El token se usa solo en memoria y no se almacena de forma persistente.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {/* From date */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Fecha inicio</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn('w-full justify-start text-left font-mono text-xs', !fromDate && 'text-muted-foreground')}
              >
                <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                {fromDate ? format(fromDate, 'yyyy-MM-dd') : 'Seleccionar'}
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

        {/* To date */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Fecha fin</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn('w-full justify-start text-left font-mono text-xs', !toDate && 'text-muted-foreground')}
              >
                <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                {toDate ? format(toDate, 'yyyy-MM-dd') : 'Seleccionar'}
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

        {/* Site */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Site</Label>
          <Select value={site} onValueChange={setSite}>
            <SelectTrigger className="font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SITES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* InvokerTx */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">InvokerTx</Label>
          <Input
            placeholder="Ej: KUSUT05402ZZ"
            className="font-mono text-xs"
            value={invokerTx}
            onChange={(e) => setInvokerTx(e.target.value)}
          />
        </div>

        {/* UtilityType */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Utility Type</Label>
          <Select value={utilityType} onValueChange={setUtilityType}>
            <SelectTrigger className="font-mono text-xs">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {UTILITY_TYPES.map((ut) => (
                <SelectItem key={ut} value={ut}>{ut}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Limit */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Límite (pruebas)</Label>
          <Input
            type="number"
            placeholder="10"
            className="font-mono text-xs"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </div>
      </div>

      <Button onClick={handleSearch} disabled={loading || !bearerToken.trim()} className="glow-primary">
        <Search className="mr-2 h-4 w-4" />
        {loading ? 'Consultando...' : 'Ejecutar consulta'}
      </Button>
    </div>
  );
}
