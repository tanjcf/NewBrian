import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const execute = promisify(execFile);

export async function diagnoseAgentReach(python: string, resources: string) {
  try {
    const { stdout } = await execute(python, [join(resources, "reach_doctor.py")], {
      windowsHide: true, timeout: 30_000, maxBuffer: 256_000,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" }
    });
    const report = JSON.parse(stdout);
    if (report.schemaVersion !== 1 || !report.channels) throw new Error("REACH_REPORT_INVALID");
    return report;
  } catch (error) {
    const details = error as { code?: string; stdout?: string };
    if (details.stdout) {
      try { const report = JSON.parse(details.stdout); if (report.error) throw new Error(`${report.error}: ${report.dependency || ""}`); }
      catch (parsed) { if (!(parsed instanceof SyntaxError)) throw parsed; }
    }
    throw new Error(details.code === "ENOENT" ? "REACH_PYTHON_MISSING" : "REACH_DIAGNOSIS_FAILED");
  }
}

export async function readCandidateBundle(workspace: string, directory: string) {
  const allowed = resolve(workspace, ".brain", "candidates");
  const root = resolve(workspace, directory);
  const relativeRoot = relative(allowed, root);
  if (!relativeRoot || relativeRoot.startsWith("..") || relativeRoot.startsWith(sep) || resolve(allowed, relativeRoot) !== root) {
    throw new Error("CANDIDATE_MUST_BE_IN_PROJECT_CANDIDATES");
  }
  // Check ancestors as well as children so a junction cannot expose files outside the project.
  const physicalWorkspace = await fs.realpath(workspace);
  let ancestor = resolve(workspace);
  for (const part of relative(ancestor, root).split(sep)) {
    ancestor = join(ancestor, part);
    if ((await fs.lstat(ancestor)).isSymbolicLink()) throw new Error("CANDIDATE_SYMLINK_REJECTED");
  }
  const physicalRoot = await fs.realpath(root);
  if (!physicalRoot.startsWith(physicalWorkspace + sep) || (await fs.lstat(root)).isSymbolicLink()) {
    throw new Error("CANDIDATE_SYMLINK_REJECTED");
  }
  const files: Record<string, string> = {};
  let bytes = 0;
  async function visit(path: string) {
    for (const entry of await fs.readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error("CANDIDATE_SYMLINK_REJECTED");
      if (entry.isDirectory()) { await visit(file); continue; }
      if (!entry.isFile() || Object.keys(files).length >= 128) throw new Error("CANDIDATE_FILES_LIMIT");
      const size = (await fs.stat(file)).size;
      bytes += size;
      if (bytes > 2_000_000) throw new Error("CANDIDATE_TOO_LARGE");
      const buffer = await fs.readFile(file);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      if (text.includes("\0")) throw new Error("CANDIDATE_TEXT_ONLY");
      files[relative(root, file).split(sep).join("/")] = text;
    }
  }
  await visit(root);
  for (const required of ["SKILL.md", "sources.md", "evaluation.json"]) {
    if (!files[required]?.trim()) throw new Error(`CANDIDATE_MISSING_${required}`);
  }
  JSON.parse(files["evaluation.json"]);
  return files;
}

export async function scaffoldGameStudios(workspace: string) {
  const templates: Record<string, string> = {
    "design/gdd/systems-index.md": "# Game Systems\n\n| System | Design document | Status |\n| --- | --- | --- |\n",
    "design/quick-specs/README.md": "# Quick Design Specs\n\nStore reviewed quick-design outputs here.\n",
    "production/epics/README.md": "# Stories\n\nEach story records acceptance criteria, implementation files and evidence.\n",
    "production/sprints/README.md": "# Sprints\n",
    "production/session-state/active.md": "# Active Story\n\nNo active story.\n",
    "production/review-mode.txt": "lean\n",
    "production/qa/evidence/README.md": "# Evidence\n\nRecord actual tests, outputs and manual sign-off. Missing evidence is not a pass.\n",
    "docs/architecture/tr-registry.yaml": "requirements: []\n",
    "docs/architecture/control-manifest.md": "# Control Manifest\n\nManifest Version: initial\n"
  };
  const created: string[] = [];
  const realWorkspace = await fs.realpath(workspace);
  for (const [path, content] of Object.entries(templates)) {
    const parts = path.split("/");
    let parent = realWorkspace;
    for (const part of parts.slice(0, -1)) {
      parent = join(parent, part);
      await fs.mkdir(parent).catch(error => { if (error.code !== "EEXIST") throw error; });
      if ((await fs.lstat(parent)).isSymbolicLink()) throw new Error("GAME_TEMPLATE_SYMLINK_REJECTED");
    }
    try { await fs.writeFile(join(realWorkspace, path), content, { flag: "wx" }); created.push(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  return { created };
}
