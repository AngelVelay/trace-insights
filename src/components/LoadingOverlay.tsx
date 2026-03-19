import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface LoadingOverlayProps {
  show: boolean;
  progressText?: string;
  progressValue?: number;
}

export default function LoadingOverlay({
  show,
  progressText = "Cargando...",
  progressValue,
}: LoadingOverlayProps) {
  if (!show) return null;

  const safeValue =
    typeof progressValue === "number"
      ? Math.max(0, Math.min(100, progressValue))
      : undefined;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-border/60 bg-card/95 px-8 py-7 shadow-2xl">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />

          <div className="w-full space-y-3 text-center">
            <p className="text-base font-semibold tracking-tight text-foreground">
              Procesando consulta
            </p>

            <p className="min-h-[20px] text-sm text-muted-foreground">
              {progressText}
            </p>

            <div className="space-y-2">
              <Progress value={safeValue ?? 15} className="h-3" />
              <div className="text-right font-mono text-xs text-muted-foreground">
                {safeValue != null ? `${safeValue}%` : "Preparando..."}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}