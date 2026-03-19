import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

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
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});