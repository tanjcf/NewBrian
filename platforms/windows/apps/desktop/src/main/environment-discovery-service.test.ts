import assert from "node:assert/strict";
import test from "node:test";

const { EnvironmentDiscoveryService } = await import(
  new URL("./environment-discovery-service.ts", import.meta.url).href
);

function createService(overrides: Record<string, unknown> = {}) {
  return new EnvironmentDiscoveryService({
    platform: "win32",
    arch: "x64",
    environment: {
      USERPROFILE: "C:\\Users\\test",
      LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
      ProgramFiles: "C:\\Program Files"
    },
    homeDirectory: "C:\\Users\\test",
    managedCondaRoot: "C:\\state\\conda",
    accessPath: async () => undefined,
    lookupCommand: () => ({ status: 0, stdout: "C:\\tools\\conda.exe\r\n" }),
    ...overrides
  });
}

test("discovers canonical Windows Conda and Node candidates", () => {
  const service = createService();
  assert.deepEqual(service.getSystemCondaCandidatePaths().slice(0, 4), [
    "conda.exe",
    "conda.bat",
    "C:\\Users\\test\\miniconda3\\Scripts\\conda.exe",
    "C:\\Users\\test\\anaconda3\\Scripts\\conda.exe"
  ]);
  assert.deepEqual(service.getSystemNodeCandidatePaths().slice(0, 3), [
    "node",
    "node.exe",
    "C:\\Program Files\\nodejs\\node.exe"
  ]);
  assert.equal(service.getManagedCondaExecutable(), "C:\\state\\conda\\Scripts\\conda.exe");
});

test("uses command lookup before managed Conda and exposes supported installer specs", async () => {
  const service = createService();
  assert.deepEqual(await service.resolvePreferredCondaExecutable(), {
    source: "system",
    condaPath: "C:\\tools\\conda.exe"
  });
  assert.equal(await service.resolvePreferredNodeExecutable(), "C:\\tools\\conda.exe");
  assert.equal(service.getManagedCondaInstallerSpec()?.installMode, "windows-exe");
});

test("does not return a missing Program Files Node path that would spawn ENOENT", async () => {
  const service = createService({
    lookupCommand: () => ({ status: 1, stdout: "" }),
    accessPath: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }
  });
  assert.equal(await service.resolvePreferredNodeExecutable(), "");
});

test("accepts Node from registry Path directories when Program Files is empty", async () => {
  const service = createService({
    lookupCommand: (_executable, args) => {
      const hive = String(args?.[1] || "");
      if (hive.includes("HKCU") || hive.includes("HKLM")) {
        return {
          status: 0,
          stdout: "\r\n    Path    REG_SZ    C:\\Users\\test\\tools\\nodejs\r\n"
        };
      }
      return { status: 1, stdout: "" };
    },
    accessPath: async (targetPath) => {
      if (String(targetPath).toLowerCase().endsWith("\\node.exe") && String(targetPath).includes("tools\\nodejs")) {
        return undefined;
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }
  });
  assert.equal(await service.resolvePreferredNodeExecutable(), "C:\\Users\\test\\tools\\nodejs\\node.exe");
});

test("prefers runnable Windows command shims over extensionless where.exe results", () => {
  const service = createService({
    lookupCommand: () => ({
      status: 0,
      stdout: "C:\\Program Files\\nodejs\\npm\r\nC:\\Program Files\\nodejs\\npm.cmd\r\n"
    })
  });
  assert.equal(service.detectCommandPath("npm"), "C:\\Program Files\\nodejs\\npm.cmd");
});

test("merges registry user Path so GUI launches see host Python", () => {
  const service = createService({
    environment: {
      USERPROFILE: "C:\\Users\\test",
      LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
      Path: "C:\\Windows\\System32"
    },
    lookupCommand: (_executable, args) => {
      const hive = String(args?.[1] || "");
      if (hive.includes("HKCU")) {
        return {
          status: 0,
          stdout: "\r\n    Path    REG_EXPAND_SZ    C:\\Users\\test\\AppData\\Local\\Programs\\Python\\Python312;%USERPROFILE%\\bin\r\n"
        };
      }
      if (hive.includes("HKLM")) {
        return {
          status: 0,
          stdout: "\r\n    Path    REG_SZ    C:\\Windows\\System32\r\n"
        };
      }
      return { status: 1, stdout: "" };
    }
  });
  const registryPath = service.readWindowsRegistryPath();
  assert.match(registryPath, /Python312/i);
  assert.match(registryPath, /C:\\Users\\test\\bin/i);
  const enriched = service.enrichShellEnv({ PATH: "C:\\only-conda" });
  const pathKeys = Object.keys(enriched).filter((key) => key.toLowerCase() === "path");
  assert.equal(pathKeys.length, 1);
  const pathValue = Object.entries(enriched).find(([key]) => key.toLowerCase() === "path")?.[1] || "";
  assert.match(pathValue, /Python312/i);
  assert.match(pathValue, /only-conda/i);
});

test("lists Windows Python launcher candidates for absolute discovery", () => {
  const service = createService();
  assert.ok(service.getSystemPythonCandidatePaths().some((item) => /Launcher\\py\.exe$/i.test(item)));
});

test("supports macOS discovery and rejects unsupported managed installers", () => {
  const mac = createService({
    platform: "darwin",
    arch: "arm64",
    environment: {},
    homeDirectory: "/Users/test",
    managedCondaRoot: "/state/conda",
    lookupCommand: () => ({ status: 1, stdout: "" })
  });
  assert.equal(mac.getManagedCondaExecutable(), "/state/conda/bin/conda");
  assert.equal(mac.getManagedCondaInstallerSpec()?.platformLabel, "macOS Apple Silicon");
  assert.match(mac.quoteShellArgument("a'b"), /^'.*'$/);

  const linux = createService({ platform: "linux", arch: "arm64", environment: {} });
  assert.equal(linux.getManagedCondaInstallerSpec(), null);
});
