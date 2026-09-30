export interface LoginItemSettings {
  openAtLogin: boolean;
  path?: string;
  args?: string[];
}

export interface LoginItemApp {
  isPackaged: boolean;
  getAppPath: () => string;
  setLoginItemSettings: (settings: LoginItemSettings) => void;
}

export function buildLoginItemSettings(input: {
  openAtLogin: boolean;
  platform: NodeJS.Platform;
  isPackaged: boolean;
  execPath: string;
  appPath: string;
}): LoginItemSettings {
  const openAtLogin = input.openAtLogin === true;
  if (input.platform === "win32" && !input.isPackaged) {
    return {
      openAtLogin,
      path: input.execPath,
      args: [input.appPath]
    };
  }
  return { openAtLogin };
}

export function applyLoginItemSettings(
  app: LoginItemApp,
  openAtLogin: boolean,
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath
): void {
  app.setLoginItemSettings(buildLoginItemSettings({
    openAtLogin,
    platform,
    isPackaged: app.isPackaged,
    execPath,
    appPath: app.getAppPath()
  }));
}
