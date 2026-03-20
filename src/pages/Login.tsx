import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { APP_BRAND, GOOGLE_GIS_CLIENT_ID } from "@/config/authConfig";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ShieldCheck,
  Lock,
  User,
  Loader2,
  CheckCircle2,
} from "lucide-react";

import apxLogo from "@/assets/icono_apx.png";
import barhcLogo from "@/assets/logo_BArhc_white.png";

function loadGoogleScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(
      'script[src="https://accounts.google.com/gsi/client"]'
    ) as HTMLScriptElement | null;

    if (existing) {
      if (window.google?.accounts?.id) {
        resolve();
        return;
      }

      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("No se pudo cargar GIS.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("No se pudo cargar GIS."));
    document.head.appendChild(script);
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { loginWithGoogleCredential, loginWithCredentials } = useAuth();

  const googleButtonRef = useRef<HTMLDivElement | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState<"google" | "local" | null>(null);
  const [error, setError] = useState("");
  const [loginSuccess, setLoginSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function setupGoogle() {
      try {
        await loadGoogleScript();

        if (cancelled || !googleButtonRef.current || !window.google?.accounts?.id) {
          return;
        }

        googleButtonRef.current.innerHTML = "";

        window.google.accounts.id.initialize({
          client_id: GOOGLE_GIS_CLIENT_ID,
          callback: async (response) => {
            try {
              setSubmitting("google");
              setError("");
              setLoginSuccess(false);

              await loginWithGoogleCredential(response.credential);
              setLoginSuccess(true);
              await sleep(1100);

              navigate("/", { replace: true });
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : "No se pudo iniciar con Google."
              );
            } finally {
              setSubmitting(null);
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: true,
        });

        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "pill",
          width: 360,
          logo_alignment: "left",
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "No se pudo inicializar Google."
        );
      }
    }

    setupGoogle();

    return () => {
      cancelled = true;
    };
  }, [loginWithGoogleCredential, navigate]);

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting("local");
    setLoginSuccess(false);

    try {
      await loginWithCredentials(username, password);
      setLoginSuccess(true);
      await sleep(1100);

      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
    } finally {
      setSubmitting(null);
    }
  };

  const isDisabled = Boolean(submitting) || loginSuccess;
  const showOverlay = Boolean(submitting) || loginSuccess;

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.18),transparent_30%)]" />
      <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:32px_32px]" />

      {showOverlay ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-900/95 px-8 py-7 shadow-2xl">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-cyan-400/20 blur-xl" />
                {loginSuccess ? (
                  <CheckCircle2 className="relative h-14 w-14 text-emerald-400" />
                ) : (
                  <Loader2 className="relative h-14 w-14 animate-spin text-cyan-400" />
                )}
              </div>

              <div className="space-y-1">
                <h3 className="text-lg font-semibold text-white">
                  {loginSuccess ? "Acceso concedido" : "Validando acceso"}
                </h3>
                <p className="text-sm text-slate-400">
                  {loginSuccess
                    ? "Entrando al dashboard..."
                    : submitting === "google"
                    ? "Iniciando sesión con Google..."
                    : "Validando credenciales internas..."}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10">
        <div
          className={`grid w-full max-w-6xl overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/80 shadow-2xl backdrop-blur transition-all duration-700 xl:grid-cols-[1.1fr_0.9fr] ${
            loginSuccess ? "scale-[0.985] opacity-90" : "scale-100 opacity-100"
          }`}
        >
          <div className="relative hidden min-h-[680px] overflow-hidden xl:block">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/25 via-slate-900 to-emerald-500/20" />
            <div className="absolute -left-16 top-10 h-56 w-56 rounded-full bg-cyan-400/20 blur-3xl" />
            <div className="absolute bottom-10 right-0 h-64 w-64 rounded-full bg-emerald-400/20 blur-3xl" />

            <div className="relative flex h-full flex-col justify-between p-10 text-slate-100">
              <div>
                <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm">
                  <ShieldCheck className="h-4 w-4 text-cyan-300" />
                  Acceso seguro
                </div>

                <h1 className="mt-8 max-w-lg text-5xl font-bold leading-tight">
                  {APP_BRAND.name}
                </h1>

                <p className="mt-5 max-w-xl text-lg text-slate-300">
                  {APP_BRAND.subtitle}
                </p>
              </div>

              <div className="space-y-5">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-7 shadow-xl backdrop-blur-sm transition-transform duration-500 hover:-translate-y-1">
                  <div className="flex items-center justify-between gap-6">
                    <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-white shadow-lg ring-1 ring-white/20">
                      <img
                        src={apxLogo}
                        alt="APX"
                        className="h-16 w-16 object-contain"
                      />
                    </div>

                    <div className="flex flex-1 justify-end">
                      <div className="rounded-3xl bg-slate-950 px-6 py-5 shadow-lg ring-1 ring-white/10">
                        <img
                          src={barhcLogo}
                          alt="BArhc"
                          className="h-16 w-auto object-contain"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
                    Plataforma de monitoreo hecho por Arquitectura Local Mexico.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex min-h-[680px] items-center justify-center bg-slate-950/60 p-6 sm:p-10">
            <div
              className={`w-full max-w-md transition-all duration-700 ${
                loginSuccess ? "translate-y-2 scale-[0.98] opacity-80" : "translate-y-0 scale-100 opacity-100"
              }`}
            >
              <div className="mb-8 text-center xl:text-left">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-emerald-400 shadow-lg xl:mx-0">
                  <ShieldCheck className="h-8 w-8 text-slate-950" />
                </div>
                <h2 className="text-3xl font-bold text-white">Iniciar sesión</h2>
                <p className="mt-2 text-sm text-slate-400">
                  
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex justify-center xl:justify-start">
                  <div ref={googleButtonRef} />
                </div>

                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-800" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-slate-950 px-3 text-xs uppercase tracking-[0.2em] text-slate-500">
                      o con usuario y contraseña
                    </span>
                  </div>
                </div>

                <form onSubmit={handleLocalLogin} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm text-slate-300">Usuario</label>
                    <div className="relative">
                      <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Ingresa tu usuario"
                        className="h-12 rounded-xl border-slate-800 bg-slate-900 pl-10 text-white placeholder:text-slate-500"
                        disabled={isDisabled}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm text-slate-300">Contraseña</label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Ingresa tu contraseña"
                        className="h-12 rounded-xl border-slate-800 bg-slate-900 pl-10 text-white placeholder:text-slate-500"
                        disabled={isDisabled}
                      />
                    </div>
                  </div>

                  {error ? (
                    <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                      {error}
                    </div>
                  ) : null}

                  <Button
                    type="submit"
                    disabled={isDisabled}
                    className="h-12 w-full rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950 hover:opacity-95"
                  >
                    {submitting === "local" ? "Validando..." : "Entrar"}
                  </Button>
                </form>
              </div>

              <p className="mt-6 text-center text-xs text-slate-500 xl:text-left">
                Acceso protegido para usuarios autorizados. Si tienes problemas para iniciar sesión, contacta al administrador.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}