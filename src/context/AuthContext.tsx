import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { jwtDecode } from "jwt-decode";
import { DEMO_LOGIN } from "@/config/authConfig";
import type { AppUser } from "@/types/auth";
import type { GoogleJwtPayload } from "@/types/google";

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  loginWithGoogleCredential: (credential: string) => Promise<void>;
  loginWithCredentials: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const LOCAL_USER_STORAGE_KEY = "glomo-auth-user";

function readStoredUser(): AppUser | null {
  try {
    const raw = localStorage.getItem(LOCAL_USER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AppUser;
  } catch {
    return null;
  }
}

function saveStoredUser(user: AppUser | null) {
  if (!user) {
    localStorage.removeItem(LOCAL_USER_STORAGE_KEY);
    return;
  }
  localStorage.setItem(LOCAL_USER_STORAGE_KEY, JSON.stringify(user));
}

function mapGoogleCredentialToUser(credential: string): AppUser {
  const payload = jwtDecode<GoogleJwtPayload>(credential);

  return {
    id: payload.sub,
    name: payload.name || payload.given_name || "Usuario Google",
    email: payload.email || "",
    photoUrl: payload.picture,
    method: "google",
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = readStoredUser();
    setUser(stored);
    setLoading(false);
  }, []);

  const loginWithGoogleCredential = useCallback(async (credential: string) => {
    if (!credential?.trim()) {
      throw new Error("No se recibió credencial de Google.");
    }

    const mapped = mapGoogleCredentialToUser(credential);
    saveStoredUser(mapped);
    setUser(mapped);
  }, []);

  const loginWithCredentials = useCallback(
    async (username: string, password: string) => {
      if (
        username.trim() !== DEMO_LOGIN.username ||
        password !== DEMO_LOGIN.password
      ) {
        throw new Error("Usuario o contraseña incorrectos.");
      }

      const localUser: AppUser = {
        id: "local-admin",
        name: "Arquitectura APX",
        email: `${DEMO_LOGIN.username}@local`,
        method: "local",
      };

      saveStoredUser(localUser);
      setUser(localUser);
    },
    []
  );

  const logout = useCallback(async () => {
    saveStoredUser(null);
    setUser(null);

    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      loginWithGoogleCredential,
      loginWithCredentials,
      logout,
    }),
    [user, loading, loginWithGoogleCredential, loginWithCredentials, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth debe usarse dentro de AuthProvider");
  }
  return ctx;
}