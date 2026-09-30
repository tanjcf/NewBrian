import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function installBuiltinSkillFile(source: string, destination: string) {
  await mkdir(dirname(destination), { recursive: true });

  const sourceContent = await readFile(source, "utf8");
  try {
    const destinationContent = await readFile(destination, "utf8");
    await chmod(destination, 0o666);
    if (sourceContent === destinationContent) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await copyFile(source, destination);
  await chmod(destination, 0o666);
}
