import { promises as fs } from "node:fs";
import { PDFParse } from "pdf-parse";
import { getData as getPdfWorkerData } from "pdf-parse/worker";

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error("PDF file path is required.");
  }

  PDFParse.setWorker(getPdfWorkerData());
  const parser = new PDFParse({
    data: await fs.readFile(filePath),
    disableFontFace: true,
    useSystemFonts: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false
  });
  try {
    const result = await parser.getText();
    process.stdout.write(result.text);
  } finally {
    await parser.destroy();
  }
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
