import { createHash } from "node:crypto";

export function buildStableDesktopDeviceId(input: {
  platform: string;
  userDataPath: string;
  machineIdentifier: string;
}) {
  const source = [
    input.platform.trim().toLowerCase(),
    input.userDataPath.trim().replace(/[\\/]+/g, "/").toLowerCase(),
    input.machineIdentifier.trim().toLowerCase()
  ].join("|");
  return createHash("sha256").update(source).digest("hex").slice(0, 24);
}
