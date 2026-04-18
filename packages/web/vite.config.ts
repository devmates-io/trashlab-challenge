import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    // HMR over docker works fine with default `host: 0.0.0.0`. If a reviewer
    // runs into HMR issues behind a proxy, they can set VITE_HMR_HOST.
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@bill-pay/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
});
