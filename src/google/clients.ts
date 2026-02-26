// import type only — no runtime cost; the actual classes are loaded via require below
import type { docs_v1, drive_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Load only the specific API we need (84ms) instead of the full 99MB googleapis bundle
const { docs_v1: DocsNS } = require("googleapis/build/src/apis/docs/v1.js") as { docs_v1: typeof docs_v1 };
const { drive_v3: DriveNS } = require("googleapis/build/src/apis/drive/v3.js") as { drive_v3: typeof drive_v3 };

export function createDocsClient(auth: OAuth2Client): docs_v1.Docs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new DocsNS.Docs({ auth } as any);
}

export function createDriveClient(auth: OAuth2Client): drive_v3.Drive {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new DriveNS.Drive({ auth } as any);
}

