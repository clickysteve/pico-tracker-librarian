// Shared helper: extract the PT module straight out of index.html so the
// tests always run against the shipped code, zero build step.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');

function extractModule(name) {
  const start = html.indexOf(`const ${name} = (() => {`);
  if (start < 0) throw new Error(`module ${name} not found`);
  const end = html.indexOf('})();', start);
  return html.slice(start, end + 5);
}

const src = extractModule('PT');
const factory = new Function(`${src}; return PT;`);
export const PT = factory();

// FX is pure data plus one function that only touches the DOM when it is
// called, so the definitions, presets and clamping can be unit tested in
// node exactly like the parser.
const fxSrc = extractModule('FX');
export const FX = new Function(`${fxSrc}; return FX;`)();
