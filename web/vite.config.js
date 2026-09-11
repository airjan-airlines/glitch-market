import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  // Published as a GitHub *project* page, so assets live under /glitch-market/.
  base: "/glitch-market/",
  // Secrets live in the repo-root .env alongside the contract tooling, not a second copy here.
  envDir: "..",
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
      "@deployments": fileURLToPath(new URL("../deployments.json", import.meta.url)),
    },
  },
  server: { port: 5173 },
});
