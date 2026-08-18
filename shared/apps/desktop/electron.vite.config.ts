import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { mainRollupOutput } from "./build-output-policy";

export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
      rollupOptions: {
        external: [
          "pdf-parse",
          "pdf-parse/worker",
          "mammoth",
          "exceljs",
          "@uzen/kokoro-js",
          "@huggingface/transformers"
        ],
        output: {
          ...mainRollupOutput,
          entryFileNames: "[name].js"
        },
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          "agent-host-entry": resolve(__dirname, "src/main/agent-host-entry.ts"),
          "pdf-text-extractor": resolve(__dirname, "src/main/pdf-text-extractor.ts"),
          "word-text-extractor": resolve(__dirname, "src/main/word-text-extractor.ts"),
          "spreadsheet-text-extractor": resolve(__dirname, "src/main/spreadsheet-text-extractor.ts"),
          "novel-tts-kokoro-worker": resolve(__dirname, "src/main/novel-tts-kokoro-worker.ts"),
          "tool-host-worker": resolve(__dirname, "../agentd/src/tool-host-worker.js")
        }
      }
    },
    resolve: {
      alias: {
        "@codex-forge/protocol": resolve(__dirname, "../../packages/protocol/src"),
        "@codex-forge/ui": resolve(__dirname, "../../packages/ui/src")
      }
    }
  },
  preload: {
    build: {
      outDir: "out/preload",
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs"
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        "@codex-forge/protocol": resolve(__dirname, "../../packages/protocol/src"),
        "@codex-forge/ui": resolve(__dirname, "../../packages/ui/src")
      }
    },
    plugins: [react()],
    build: {
      outDir: "out/renderer"
    }
  }
});
