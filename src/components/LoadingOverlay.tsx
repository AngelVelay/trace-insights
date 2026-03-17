import { Loader2 } from "lucide-react";

interface LoadingOverlayProps {
  show: boolean;
}

export default function LoadingOverlay({
  show,
}: LoadingOverlayProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 rounded-3xl border border-border/60 bg-card/95 px-10 py-8 shadow-2xl">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-base font-semibold tracking-tight text-foreground">
          Cargando...
        </p>
      </div>
    </div>
  );
}