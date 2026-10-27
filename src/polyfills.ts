import { Buffer } from "buffer";

// @ton/core and TON Connect expect Node's Buffer at module load time.
// Browsers do not provide it, so install the polyfill before any app imports.
if (!(globalThis as any).Buffer) {
  (globalThis as any).Buffer = Buffer;
}
