const { app } = require("electron");
const fs = require("node:fs/promises");

app.whenReady().then(async () => {
  try {
    const [{ PDFParse }, { getData }] = await Promise.all([
      import("pdf-parse"),
      import("pdf-parse/worker")
    ]);
    PDFParse.setWorker(getData());
    const parser = new PDFParse({
      data: await fs.readFile("../../.newbrain/projects/New project/personal-intro-verified.pdf")
    });
    const result = await parser.getText();
    console.log(result.text);
    await parser.destroy();
  } catch (error) {
    console.error(error?.stack || error);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
