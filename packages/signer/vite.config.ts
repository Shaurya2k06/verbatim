import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// One self-contained HTML file: load it once, turn on airplane mode, keep signing.
export default defineConfig({ plugins: [viteSingleFile()], build: { outDir: "dist" } });
