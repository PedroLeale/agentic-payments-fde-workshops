import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:4022";

export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy para o agente: assim o EventSource fala com a propria origem e
    // nao ha CORS no caminho do SSE.
    proxy: {
      "/api": { target: AGENT_URL, changeOrigin: true },
    },
  },
});
