import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/mu-live-01": {
        target: "https://mu.live-01.nextgen.igrupobbva",
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/mu-live-01/, ""),
      },
      "/mu-live-02": {
        target: "https://mu.live-02.nextgen.igrupobbva",
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/mu-live-02/, ""),
      },
      "/mu-live-03": {
        target: "https://mu.live-03.nextgen.igrupobbva",
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/mu-live-03/, ""),
      },
      "/mu-live-04": {
        target: "https://mu.live-04.nextgen.igrupobbva",
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/mu-live-04/, ""),
      },
      "/mu-live-05": {
        target: "https://mu.live-05.nextgen.igrupobbva",
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/mu-live-05/, ""),
      },

      "/rho-live-01": {
        target: "https://rho.live-01.nextgen.igrupobbva",
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/rho-live-01/, ""),
      },
      "/rho-live-02": {
        target: "https://rho.live-02.nextgen.igrupobbva",
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/rho-live-02/, ""),
      },
      "/rho-live-03": {
        target: "https://rho.live-03.nextgen.igrupobbva",
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/rho-live-03/, ""),
      },
      "/rho-live-04": {
        target: "https://rho.live-04.nextgen.igrupobbva",
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/rho-live-04/, ""),
      },
      "/rho-live-05": {
        target: "https://rho.live-05.nextgen.igrupobbva",
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/rho-live-05/, ""),
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));