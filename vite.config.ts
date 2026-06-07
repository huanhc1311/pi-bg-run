import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: [
        "node:child_process",
        "node:fs",
        "node:path",
        "@earendil-works/pi-coding-agent",
        "@earendil-works/pi-tui",
        "typebox",
      ],
    },
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
  },
});
