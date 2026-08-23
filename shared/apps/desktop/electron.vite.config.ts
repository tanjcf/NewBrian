import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { mainRollupOutput } from "./build-output-policy";
import { repairMainBundleDir } from "./scripts/repair-bundle-cjs-shim.mjs";

const skipMainEsbuildTranspile = (): Plugin => ({
  name: "skip-main-esbuild-transpile",
  apply: "build",
  enforce: "pre",
  renderChunk(_code, _chunk, outputOptions) {
    (outputOptions as { __vite_skip_esbuild__?: boolean }).__vite_skip_esbuild__ = true;
  }
});

const repairBundleCjsShim = (): Plugin => ({
  name: "repair-bundle-cjs-shim",
  apply: "build",
  writeBundle(options) {
    const dir = options.dir?.replace(/\\/g, "/") ?? "";
    if (!dir.endsWith("out/main")) return;
    repairMainBundleDir(options.dir!);
  }
});

const forceCompressionLibraryExternal = (): Plugin => ({
  name: "force-compression-library-external",
  enforce: "pre",
  resolveId(source) {
    if (/^(jszip|exceljs)(\/.*)?$/.test(source)) {
      return { id: source, external: true };
    }
    return null;
  }
});

const optionalMainEntry = (name: string, relativePath: string) => {
  const entryPath = resolve(__dirname, relativePath);
  return existsSync(entryPath) ? { [name]: entryPath } : {};
};

const ssrExternalDeps = [
  "pdf-parse",
  "pdf-parse/worker",
  "mammoth",
  "exceljs",
  "jszip",
  "pdf-lib",
  "@uzen/kokoro-js",
  "@huggingface/transformers"
] as const;

export default defineConfig({
  main: {
    plugins: [skipMainEsbuildTranspile(), forceCompressionLibraryExternal(), repairBundleCjsShim()],
    ssr: {
      // Keep heavy compression/document deps out of multi-MB main chunks (Rollup CJS shim bug).
      external: [...ssrExternalDeps]
    },
    build: {
      target: "node20",
      minify: false,
      outDir: "out/main",
      rollupOptions: {
        external: [...ssrExternalDeps],
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
      dedupe: ["jszip", "exceljs"],
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
