import mammoth from "mammoth";

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

async function main() {
  const filePath = process.argv[2];
  if (!filePath) throw new Error("Word file path is required.");
  const result = await mammoth.extractRawText({ path: filePath });
  process.stdout.write(result.value);
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
