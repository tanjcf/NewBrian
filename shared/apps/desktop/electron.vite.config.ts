import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { mainRollupOutput } from "./build-output-policy";

const optionalMainEntry = (name: string, relativePath: string) => {
  const entryPath = resolve(__dirname, relativePath);
  return existsSync(entryPath) ? { [name]: entryPath } : {};
};

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
          "document-anchor": resolve(__dirname, "../../packages/protocol/src/document-anchor.ts"),
          "agent-host-entry": resolve(__dirname, "src/main/agent-host-entry.ts"),
          ...optionalMainEntry("pdf-text-extractor", "src/main/pdf-text-extractor.ts"),
          ...optionalMainEntry("word-text-extractor", "src/main/word-text-extractor.ts"),
          ...optionalMainEntry("spreadsheet-text-extractor", "src/main/spreadsheet-text-extractor.ts"),
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
    },
    resolve: {
      alias: {
        "@codex-forge/protocol": resolve(__dirname, "../../packages/protocol/src")
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
