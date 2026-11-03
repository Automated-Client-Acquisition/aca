import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    server: {
      host: "::",
      port: 3001,
      proxy: env.VITE_SUPABASE_URL ? {
        "/api/v1/campaign-events": {
          target: env.VITE_SUPABASE_URL,
          changeOrigin: true,
          rewrite: () => "/functions/v1/campaign-trigger-events",
        },
      } : undefined,
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["mediabunny", "@mediabunny/ac3", "react", "react-dom"],
    },
    build: {
      chunkSizeWarningLimit: 4000,
    },
    optimizeDeps: {
      include: [
        "remotion",
        "@remotion/player",
        "@remotion/transitions",
        "@remotion/transitions/fade",
        "@remotion/transitions/slide",
        "@remotion/transitions/wipe",
        "mediabunny",
        "@mediabunny/ac3",
      ],
    },
  };
});
