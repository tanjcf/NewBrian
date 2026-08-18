import assert from "node:assert/strict";
import test from "node:test";

const {
  collectDarwinPathHints,
  mergeEnvWithSystemPath,
  readLoginShellPath,
  readPathHelperPath,
  resolveSystemPath
} = await import(new URL("./system-path-env-service.ts", import.meta.url).href);

test("reads login-shell PATH from zsh -ilc on darwin", () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const path = readLoginShellPath({
    platform: "darwin",
    environment: { SHELL: "/bin/zsh", HOME: "/Users/test" },
    homeDirectory: "/Users/test",
    spawn: (command, args) => {
      calls.push({ command, args });
      return { status: 0, stdout: "/opt/homebrew/bin:/usr/bin:/bin", stderr: "" };
    }
  });
  assert.equal(path, "/opt/homebrew/bin:/usr/bin:/bin");
  assert.equal(calls[0]?.command, "/bin/zsh");
  assert.deepEqual(calls[0]?.args, ["-ilc", 'printf %s "$PATH"']);
});

test("parses path_helper export output", () => {
  const path = readPathHelperPath({
    platform: "darwin",
    environment: {},
    homeDirectory: "/Users/test",
    pathHelperExists: true,
    spawn: () => ({
      status: 0,
      stdout: 'PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"; export PATH;\n',
      stderr: ""
    })
  });
  assert.equal(path, "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
});

test("merges login shell, path_helper, hints, and process PATH without duplicates", () => {
  const resolved = resolveSystemPath({
    platform: "darwin",
    environment: { PATH: "/usr/bin:/custom/bin", SHELL: "/bin/zsh", HOME: "/Users/test" },
    homeDirectory: "/Users/test",
    pathHelperExists: true,
    spawn: (command, args) => {
      if (command === "/bin/zsh") {
        return { status: 0, stdout: "/opt/homebrew/bin:/usr/bin", stderr: "" };
      }
      if (command === "/usr/libexec/path_helper") {
        return {
          status: 0,
          stdout: 'PATH="/usr/bin:/bin:/usr/sbin:/sbin"; export PATH;\n',
          stderr: ""
        };
      }
      return { status: 1, stdout: "", stderr: String(args) };
    }
  });
  assert.match(resolved, /^\/opt\/homebrew\/bin:/);
  assert.match(resolved, /:\/usr\/bin:/);
  assert.match(resolved, /:\/custom\/bin/);
  assert.equal(resolved.split(":").filter((entry) => entry === "/usr/bin").length, 1);
});

test("keeps Windows PATH unchanged aside from dedupe", () => {
  const resolved = resolveSystemPath({
    platform: "win32",
    environment: { PATH: "C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32" },
    homeDirectory: "C:\\Users\\test",
    spawn: () => ({ status: 1, stdout: "", stderr: "" })
  });
  assert.equal(resolved, "C:\\Windows\\System32;C:\\Windows");
});

test("mergeEnvWithSystemPath overwrites PATH and keeps other vars", () => {
  const merged = mergeEnvWithSystemPath(
    { PATH: "/old", HOME: "/Users/test", EMPTY: undefined as unknown as string },
    "/opt/homebrew/bin:/usr/bin"
  );
  assert.equal(merged.PATH, "/opt/homebrew/bin:/usr/bin");
  assert.equal(merged.HOME, "/Users/test");
  assert.equal("EMPTY" in merged, false);
});

test("collectDarwinPathHints includes homebrew and user bins", () => {
  const hints = collectDarwinPathHints("/Users/demo");
  assert.ok(hints.includes("/opt/homebrew/bin"));
  assert.ok(hints.includes("/Users/demo/.local/bin"));
});
