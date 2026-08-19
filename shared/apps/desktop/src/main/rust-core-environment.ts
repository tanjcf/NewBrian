const allowedEnvironmentKeys = new Set([
  "PATH", "Path", "SystemRoot", "WINDIR", "HOME", "USERPROFILE", "TMP", "TEMP",
  "LANG", "LC_ALL", "LC_CTYPE", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"
]);

export function rustCoreChildEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(([key, value]) => allowedEnvironmentKeys.has(key) && typeof value === "string")
  );
}
