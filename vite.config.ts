import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

function createApxConsoleProxy(target: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    secure: false,
    rewrite: (p) => p.replace(/^\/apx-console\/[^/]+/, "/APX_Operation"),
    configure: (proxy) => {
      proxy.on("proxyReq", (proxyReq, req) => {
        const rawSessionCookie = req.headers["x-session-cookie"];
        const sessionCookie = Array.isArray(rawSessionCookie)
          ? rawSessionCookie.join("; ")
          : rawSessionCookie;

        if (sessionCookie) {
          proxyReq.setHeader("Cookie", sessionCookie);
        }

        proxyReq.removeHeader("x-session-cookie");
      });
    },
  };
}

function createFresnoProxy(): ProxyOptions {
  return {
    target: "https://bbva-es-government-ing.appspot.com",
    changeOrigin: true,
    secure: false,
    rewrite: (p) => p.replace(/^\/fresno/, "/c"),
    configure: (proxy) => {
      proxy.on("proxyReq", (proxyReq, req) => {
        const rawSessionCookie = req.headers["x-session-cookie"];
        const sessionCookie = Array.isArray(rawSessionCookie)
          ? rawSessionCookie.join("; ")
          : rawSessionCookie;

        if (sessionCookie) {
          proxyReq.setHeader("Cookie", sessionCookie);
        }

        proxyReq.removeHeader("x-session-cookie");
      });
    },
  };
}

export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "/mu-live-02": {
        target: "https://mu.live-02.nextgen.igrupobbva",
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/mu-live-02/, ""),
      },
      "/rho-live-02": {
        target: "https://rho.live-02.nextgen.igrupobbva",
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/rho-live-02/, ""),
      },
      "/omega-live-02": {
        target: "https://omega.live-02.nextgen.igrupobbva",
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/omega-live-02/, ""),
      },
      "/apx-console/DEV": createApxConsoleProxy(
        "https://apxconsole-dev-mx.work-02.nextgen.igrupobbva"
      ),
      "/apx-console/INT": createApxConsoleProxy(
        "https://apxconsole-int-mx.work-02.nextgen.igrupobbva"
      ),
      "/apx-console/OCTA": createApxConsoleProxy(
        "https://apxconsole-oct-mx.work-02.nextgen.igrupobbva"
      ),
      "/apx-console/AUS": createApxConsoleProxy(
        "https://apxconsole-aus-mx.work-02.nextgen.igrupobbva"
      ),
      "/apx-console/PROD": createApxConsoleProxy(
        "https://apxconsole-mx.live-02.nextgen.igrupobbva"
      ),
      "/fresno": createFresnoProxy(),
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [react()],
});