import { useLocation, useNavigate } from "react-router-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import apxLogo from "@/assets/icono_apx.png";
import barhcLogo from "@/assets/logo_BArhc_white.png";

type HeaderRoute =
  | "pipeline"
  | "versionado-entornos"
  | "versionado-incidentes"
  | "securizacion-live";

const ROUTES: Array<{ value: HeaderRoute; label: string; path: string }> = [
  { value: "pipeline", label: "AWS Monitoreo", path: "/" },
  {
    value: "versionado-entornos",
    label: "Versionado / Monitoreo de Entornos",
    path: "/versionado/entornos",
  },
  {
    value: "versionado-incidentes",
    label: "Versionado / Monitoreo de Incidentes",
    path: "/versionado/incidentes",
  },
  {
    value: "securizacion-live",
    label: "Monitoreo Securización LIVE",
    path: "/monitoreo/securizacion-live",
  },
];

function getRouteValue(pathname: string): HeaderRoute {
  if (pathname.startsWith("/monitoreo/securizacion-live")) {
    return "securizacion-live";
  }

  if (pathname.startsWith("/versionado/incidentes")) {
    return "versionado-incidentes";
  }

  if (pathname.startsWith("/versionado/entornos")) {
    return "versionado-entornos";
  }

  return "pipeline";
}

export default function AppHeader() {
  const navigate = useNavigate();
  const location = useLocation();

  const currentValue = getRouteValue(location.pathname);

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-xl shadow-sm">
      <div className="mx-auto flex w-full max-w-[1880px] items-center justify-between gap-6 px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-border/50">
            <img
              src={apxLogo}
              alt="APX"
              className="h-10 w-10 object-contain"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                BBVA Monitoring Tool
              </h1>
              <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                Atenea
              </span>
            </div>

            <p className="text-sm leading-5 text-muted-foreground"></p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="w-[260px] sm:w-[360px]">
            <Select
              value={currentValue}
              onValueChange={(value) => {
                const selected = ROUTES.find((item) => item.value === value);
                if (selected) {
                  navigate(selected.path);
                }
              }}
            >
              <SelectTrigger className="h-11 rounded-xl font-mono text-xs">
                <SelectValue placeholder="Selecciona una página" />
              </SelectTrigger>
              <SelectContent>
                {ROUTES.map((route) => (
                  <SelectItem key={route.value} value={route.value}>
                    {route.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="hidden shrink-0 items-center md:flex">
            <div className="rounded-2xl bg-slate-900 px-4 py-3 shadow-sm ring-1 ring-border/40">
              <img
                src={barhcLogo}
                alt="BArhc"
                className="h-12 w-auto object-contain"
              />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}