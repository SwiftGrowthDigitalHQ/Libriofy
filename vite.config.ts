import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = env.VITE_BASE_PATH || "/";

  return {
    base,
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) {
              return undefined;
            }

            if (id.includes("@supabase")) {
              return "vendor-supabase";
            }

            if (id.includes("recharts")) {
              return "vendor-charts";
            }

            if (id.includes("framer-motion")) {
              return "vendor-motion";
            }

            if (
              id.includes("@radix-ui") ||
              id.includes("cmdk") ||
              id.includes("vaul") ||
              id.includes("embla-carousel-react")
            ) {
              return "vendor-ui";
            }

            if (id.includes("react-router") || id.includes("@tanstack/react-query")) {
              return "vendor-routing";
            }

            if (id.includes("react") || id.includes("scheduler")) {
              return "vendor-react";
            }

            if (
              id.includes("date-fns") ||
              id.includes("zod") ||
              id.includes("lucide-react") ||
              id.includes("qrcode.react") ||
              id.includes("react-day-picker") ||
              id.includes("react-simple-maps") ||
              id.includes("topojson-client")
            ) {
              return "vendor-utils";
            }

            return "vendor";
          },
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
