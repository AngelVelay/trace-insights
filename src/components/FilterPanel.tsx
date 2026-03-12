import { useState } from 'react';
import { CalendarIcon, Search } from 'lucide-react';
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

  const handleSearch = () => {
    onSearch({
      fromDate,
      toDate,
      site: site || undefined,
      invokerTx: invokerTx || undefined,
      utilityType: utilityType || undefined,
      limit: limit ? Number(limit) : undefined,
    });
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Filtros de consulta
      </h2>

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

      <Button onClick={handleSearch} disabled={loading} className="glow-primary">
        <Search className="mr-2 h-4 w-4" />
        {loading ? 'Consultando...' : 'Ejecutar consulta'}
      </Button>
    </div>
  );
}
