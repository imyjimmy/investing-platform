import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const frontendPort = Number(process.env.INVESTING_PLATFORM_FRONTEND_PORT ?? "5173");
const backendPort = process.env.INVESTING_PLATFORM_BACKEND_PORT ?? "8000";
const backendTarget = process.env.VITE_API_BASE_URL ?? `http://127.0.0.1:${backendPort}`;

export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: frontendPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
}));
