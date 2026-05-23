import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function copyManifest(): Plugin {
  return {
    name: "copy-extension-manifest",
    closeBundle() {
      const outputDir = path.resolve(__dirname, "dist");
      mkdirSync(outputDir, { recursive: true });
      copyFileSync(
        path.resolve(__dirname, "manifest.json"),
        path.join(outputDir, "manifest.json"),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), copyManifest()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: path.resolve(__dirname, "sidepanel.html"),
        background: path.resolve(__dirname, "src/background.ts"),
      },
      output: {
        entryFileNames: (chunk) => (
          chunk.name === "background" ? "background.js" : "assets/[name].js"
        ),
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
