import { pathToFileURL } from "node:url";
import { healAllZeroVolumeEnvelope } from "./.materialized/windows/apps/desktop/src/shared/video-volume-envelope.ts";
const healed = healAllZeroVolumeEnvelope([{ t: 0, v: 0 }, { t: 1, v: 0 }]);
console.log(JSON.stringify(healed));
