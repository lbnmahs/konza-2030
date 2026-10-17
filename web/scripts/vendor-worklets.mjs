// K8 S1 (MED-329): copies the voice SDK's audio worklets into public/vendor/elevenlabs/ so /sia can
// load them from its own origin under a strict CSP (no blob:, data: or CDN scripts). Runs before
// `next dev` and `next build`; the copies are git-ignored and always match the installed packages.

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(web, "public", "vendor", "elevenlabs");
mkdirSync(out, { recursive: true });

const files = [
  ["node_modules/@elevenlabs/client/worklets/rawAudioProcessor.js", "raw-audio-processor.js"],
  ["node_modules/@elevenlabs/client/worklets/audioConcatProcessor.js", "audio-concat-processor.js"],
  // Voice mode dictation (MED-342).
  ["node_modules/@elevenlabs/client/worklets/scribeAudioProcessor.js", "scribe-audio-processor.js"],
  // The SDK resamples with this on browsers without the sample-rate constraint (Firefox); pinned to
  // the version the SDK would otherwise fetch from a CDN.
  ["node_modules/@alexanderolsen/libsamplerate-js/dist/libsamplerate.worklet.js", "libsamplerate.worklet.js"],
];
for (const [from, to] of files) copyFileSync(join(web, from), join(out, to));
console.log(`vendor-worklets: ${files.length} files in public/vendor/elevenlabs`);
