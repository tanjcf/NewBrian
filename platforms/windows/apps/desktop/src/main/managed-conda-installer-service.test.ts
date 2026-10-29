import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

const {
  buildBoundedCommandEnv,
  ManagedCondaInstallerService,
  resolveBoundedSpawnCommand,
  resolveTrustedWindowsSystemRoot,
  runBoundedEnvironmentCommand,
  sanitizeWindowsPathEnv
} = await import(
  new URL("./managed-conda-installer-service.ts", import.meta.url).href
);

test("routes Windows cmd and bat shims through literal cmd.exe with env-held command line", () => {
  const resolved = resolveBoundedSpawnCommand({ executable: "C:\\Program Files\\nodejs\\npm.cmd", args: ["--version"] }, "win32");
  assert.equal(resolved.executable, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(resolved.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(resolved.args[3], "call %NEWBRAIN_BOUNDED_CMDLINE%");
  assert.match(String(resolved.envExtra?.NEWBRAIN_BOUNDED_CMDLINE), /^"C:\\Program Files\\nodejs\\npm\.cmd" "--version"$/);
  assert.equal(resolved.windowsVerbatimArguments, true);
});

test("rejects bare cmd.exe /c concatenated shell lines", () => {
  assert.throws(
    () => resolveBoundedSpawnCommand({
      executable: "cmd.exe",
      args: ["/d", "/s", "/c", "\"C:\\\\tools\\\\conda.bat\" create --yes"]
    }, "win32"),
    /must not invoke cmd\.exe \/c/
  );
});

test("restores required Windows process variables without discarding the task environment", () => {
  const env = buildBoundedCommandEnv(
    { PATH: "C:\\tools", CUSTOM_VALUE: "ready", SystemRoot: "", ComSpec: "" },
    "win32",
    { SystemRoot: "C:\\Windows", ComSpec: "C:\\Windows\\System32\\cmd.exe", PATH: "host" }
  );
  assert.equal(env.SystemRoot, "C:\\Windows");
  assert.equal(env.WINDIR, "C:\\Windows");
  assert.equal(env.ComSpec, "C:\\Windows\\System32\\cmd.exe");
  assert.equal(env.PATH, "C:\\tools");
  assert.equal(env.CUSTOM_VALUE, "ready");
});

test("rejects hostile SystemRoot and ComSpec from the host environment", () => {
  assert.equal(resolveTrustedWindowsSystemRoot("C:\\Windows&calc.exe"), "C:\\Windows");
  assert.equal(resolveTrustedWindowsSystemRoot("D:\\Windows"), "D:\\Windows");
  const env = buildBoundedCommandEnv(
    { PATH: "C:\\safe;C:\\bad&calc;C:\\ok" },
    "win32",
    {
      SystemRoot: "C:\\Windows\" & calc.exe",
      ComSpec: "C:\\evil\\cmd.exe",
      PATH: "C:\\host&evil;C:\\Windows\\System32",
      SECRET_TOKEN: "should-not-copy"
    }
  );
  assert.equal(env.SystemRoot, "C:\\Windows");
  assert.equal(env.ComSpec, "C:\\Windows\\System32\\cmd.exe");
  assert.equal(env.PATH, "C:\\safe;C:\\ok");
  assert.equal(env.SECRET_TOKEN, undefined);
  assert.equal(sanitizeWindowsPathEnv("C:\\a&b;C:\\c"), "C:\\c");
});

test("executes the installed npm.cmd shim on Windows", { skip: process.platform !== "win32" }, async () => {
  const result = await runBoundedEnvironmentCommand({
    executable: "C:\\Program Files\\nodejs\\npm.cmd",
    args: ["--version"],
    cwd: process.cwd(),
    env: process.env
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test("executes npm.cmd when the supplied task environment omits Windows system variables", { skip: process.platform !== "win32" }, async () => {
  const result = await runBoundedEnvironmentCommand({
    executable: "C:\\Program Files\\nodejs\\npm.cmd",
    args: ["--version"],
    cwd: process.cwd(),
    env: { PATH: process.env.PATH, CUSTOM_VALUE: "ready" }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test("reports a missing working directory before spawning a command", async () => {
  const missingCwd = `${process.cwd()}\\missing-newbrain-command-cwd`;
  await assert.rejects(() => runBoundedEnvironmentCommand({
    executable: process.execPath,
    args: ["--version"],
    cwd: missingCwd
  }), /Command working directory does not exist/);
});

test("rejects a file path used as the command working directory", async () => {
  const currentFile = fileURLToPath(import.meta.url);
  await assert.rejects(() => runBoundedEnvironmentCommand({
    executable: process.execPath,
    args: ["--version"],
    cwd: currentFile
  }), /Command working directory is not a directory/);
});

test("downloads and installs managed Conda through bounded commands without shell downloaders", async () => {
  const commands: Array<{ executable: string; args: string[] }> = [];
  const downloads: Array<{ url: string; path: string }> = [];
  let installed = false;
  const service = new ManagedCondaInstallerService({
    workspacePath: "C:\\newbrain",
    platform: "win32",
    getManagedCondaRoot: () => "C:\\state\\conda",
    getManagedCondaExecutable: () => "C:\\state\\conda\\Scripts\\conda.exe",
    pathExists: async (path: string) => path.endsWith("conda.exe") ? installed : false,
    summarizeEnvironment: () => ({
      platform: "win32",
      arch: "x64",
      release: "test",
      installerSpec: {
        fileName: "miniconda.exe",
        downloadUrl: "https://example.test/miniconda.exe",
        installMode: "windows-exe",
        platformLabel: "Windows x64"
      }
    }),
    showManualInstallPrompt: async () => undefined,
    canReachPublicUrl: async () => true,
    ensureDirectory: async () => undefined,
    quoteShellArgument: (value: string) => `"${value}"`,
    downloadFile: async (url: string, destinationPath: string) => {
      downloads.push({ url, path: destinationPath });
    },
    runCommand: async (input: { executable: string; args: string[] }) => {
      commands.push(input);
      if (input.executable.endsWith("miniconda.exe")) installed = true;
      return { status: 0, stdout: "", stderr: "" };
    }
  });

  assert.equal(await service.ensureInstalled(), "C:\\state\\conda\\Scripts\\conda.exe");
  assert.deepEqual(downloads, [{ url: "https://example.test/miniconda.exe", path: "C:\\newbrain\\install\\miniconda.exe" }]);
  assert.deepEqual(commands.map((command) => command.executable), ["C:\\newbrain\\install\\miniconda.exe"]);
  assert.deepEqual(commands[0]?.args, ["/S", "/D=C:\\state\\conda"]);
  assert.ok(commands.every((command) => !("timeoutMs" in command)));
});

test("requires manual installation when the platform is unsupported", async () => {
  let prompted = false;
  const service = new ManagedCondaInstallerService({
    workspacePath: "/newbrain",
    platform: "linux",
    getManagedCondaRoot: () => "/state/conda",
    getManagedCondaExecutable: () => "/state/conda/bin/conda",
    pathExists: async () => false,
    summarizeEnvironment: () => ({ platform: "linux", arch: "arm64", release: "test", installerSpec: null }),
    showManualInstallPrompt: async () => { prompted = true; },
    canReachPublicUrl: async () => true,
    ensureDirectory: async () => undefined,
    quoteShellArgument: String,
    runCommand: async () => ({ status: 0, stdout: "", stderr: "" })
  });
  await assert.rejects(() => service.ensureInstalled(), /Unsupported platform/);
  assert.equal(prompted, true);
});

test("rejects an already canceled bounded command before spawning", async () => {
  const controller = new AbortController();
  controller.abort(new Error("stop now"));
  await assert.rejects(() => runBoundedEnvironmentCommand({
    executable: "unused",
    args: [],
    cwd: ".",
    signal: controller.signal
  }), /stop now/);
});

test("terminates a running environment command when cancellation arrives", async () => {
  const controller = new AbortController();
  const running = runBoundedEnvironmentCommand({
    executable: process.execPath,
    args: ["-e", "setTimeout(() => {}, 10000)"],
    cwd: process.cwd(),
    signal: controller.signal
  });
  setTimeout(() => controller.abort(new Error("cancel running command")), 20);
  await assert.rejects(() => running, /cancel running command/);
});
