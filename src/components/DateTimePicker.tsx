import { format } from "date-fns";
import { CalendarIcon, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DateTimePickerProps {
  value: Date;
  onChange: (date: Date) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

function setTimeOnDate(baseDate: Date, timeValue: string): Date {
  const next = new Date(baseDate);
  const [hours, minutes] = timeValue.split(":").map((v) => Number(v));
  next.setHours(Number.isFinite(hours) ? hours : 0);
  next.setMinutes(Number.isFinite(minutes) ? minutes : 0);
  next.setSeconds(0);
  next.setMilliseconds(0);
  return next;
}

function getTimeValue(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function DateTimePicker({
  value,
  onChange,
  placeholder = "Selecciona fecha y hora",
  className,
  disabled = false,
}: DateTimePickerProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-11 w-full justify-start rounded-xl font-mono text-xs",
            !value && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value ? format(value, "dd/MM/yyyy HH:mm") : placeholder}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-auto rounded-xl p-3" align="start">
        <div className="space-y-3">
          <Calendar
            mode="single"
            selected={value}
            onSelect={(selectedDate) => {
              if (!selectedDate) return;

              const next = new Date(selectedDate);
              next.setHours(value.getHours());
              next.setMinutes(value.getMinutes());
              next.setSeconds(0);
              next.setMilliseconds(0);

              onChange(next);
            }}
            initialFocus
          />

          <div className="space-y-2 border-t border-border pt-3">
            <Label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock3 className="h-4 w-4" />
              Hora
            </Label>

            <Input
              type="time"
              step="60"
              value={getTimeValue(value)}
              onChange={(e) => onChange(setTimeOnDate(value, e.target.value))}
              className="h-10 font-mono text-xs"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}