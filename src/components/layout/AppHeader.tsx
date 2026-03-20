import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export default function AppHeader() {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/85 backdrop-blur">
      <div className="container flex h-16 items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-white">GLOMO Monitoring</div>
          <div className="text-xs text-slate-400">Operación y monitoreo</div>
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <div className="text-right">
                <div className="text-sm font-medium text-white">{user.name}</div>
                <div className="text-xs text-slate-400">{user.email}</div>
              </div>

              {user.photoUrl ? (
                <img
                  src={user.photoUrl}
                  alt={user.name}
                  className="h-10 w-10 rounded-full border border-slate-700 object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-sm font-bold text-white">
                  {user.name.slice(0, 1).toUpperCase()}
                </div>
              )}

              <Button
                variant="outline"
                onClick={logout}
                className="border-slate-700 bg-slate-900 text-white hover:bg-slate-800"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Salir
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}