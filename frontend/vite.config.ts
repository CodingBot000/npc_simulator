import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@contracts": fileURLToPath(new URL("../contracts/generated", import.meta.url)),
      "@sim-shared": fileURLToPath(new URL("../shared/simulator-rules", import.meta.url)),
    },
  },
  server: {
    port: 3000,
  },
});
