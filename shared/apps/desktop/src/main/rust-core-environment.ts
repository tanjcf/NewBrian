const allowedEnvironmentKeys = new Set([
  "PATH", "Path", "SystemRoot", "WINDIR", "HOME", "USERPROFILE", "TMP", "TEMP",
  "APPDATA", "LOCALAPPDATA", "FONTCONFIG_PATH", "FONTCONFIG_FILE",
  "LANG", "LC_ALL", "LC_CTYPE", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"
]);

export function rustCoreChildEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(([key, value]) => allowedEnvironmentKeys.has(key) && typeof value === "string")
  );
}
