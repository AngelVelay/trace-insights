import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster as Sonner } from "@/components/ui/sonner";

import { AuthProvider, useAuth } from "@/context/AuthContext";
import ProtectedRoute from "@/components/auth/ProtectedRoute";

import AppHeader from "@/components/AppHeader";
import Dashboard from "@/pages/Dashboard";
import LoginPage from "@/pages/Login";
import VersionadoEntornos from "@/pages/VersionadoEntornos";
import VersionadoIncidentes from "@/pages/VersionadoIncidentes";
import MonitoreoSecurizacionLive from "@/pages/MonitoreoSecurizacionLive";
import Fresno from "@/pages/Fresno";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

function AppShell() {
  const { user } = useAuth();

  return (
    <BrowserRouter>
      {user ? <AppHeader /> : null}

      <Routes>
        <Route
          path="/login"
          element={user ? <Navigate to="/" replace /> : <LoginPage />}
        />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/versionado/entornos"
          element={
            <ProtectedRoute>
              <VersionadoEntornos />
            </ProtectedRoute>
          }
        />

        <Route
          path="/versionado/incidentes"
          element={
            <ProtectedRoute>
              <VersionadoIncidentes />
            </ProtectedRoute>
          }
        />

        <Route
          path="/monitoreo/securizacion-live"
          element={
            <ProtectedRoute>
              <MonitoreoSecurizacionLive />
            </ProtectedRoute>
          }
        />

        <Route
          path="/fresno"
          element={
            <ProtectedRoute>
              <Fresno />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;