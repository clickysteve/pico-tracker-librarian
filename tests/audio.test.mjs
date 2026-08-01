// Renders the demo song through an OfflineAudioContext and measures the mix.
// Guards two things that are invisible to DOM assertions:
//   * the output must not clip (eight channels used to sum to a peak of 1.26
//     into a destination that clamps at ±1 — that was audible distortion);
//   * sliced notes must be scheduled from the wav's OWN sample rate.
// Needs Playwright + Chromium, like e2e.mjs.
const { chromium } = await (async () => {
  try { return await import('playwright'); }
  catch { return await import('/opt/node-tools/node_modules/playwright/index.mjs'); }
})();
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok ${name}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

// Swap AudioContext for an OfflineAudioContext so the mix can be rendered
// and inspected rather than played to a device that isn't there.
await page.addInitScript(() => {
  const Real = window.OfflineAudioContext;
  window.__offline = null;
  class FakeCtx extends Real {
    constructor() { super(2, 44100 * 12, 44100); window.__offline = this; }
    close() { return Promise.resolve(); }
  }
  window.AudioContext = FakeCtx;
  window.webkitAudioContext = FakeCtx;
});
await page.goto('file://' + join(root, 'index.html'));
await page.waitForTimeout(400);
await page.click('#btn-demo');
await page.waitForTimeout(1500);
await page.click('.tab-btn[data-tab="projects"]');
await page.waitForTimeout(300);
// NIGHTDRIVE is the densest demo project and the one with a sliced instrument
await page.evaluate(() => [...document.querySelectorAll('.proj-item')]
  .find(r => r.textContent.includes('NIGHTDRIVE'))?.querySelector('.proj-row')?.click());
await page.waitForTimeout(200);
await page.evaluate(() => [...document.querySelectorAll('.proj-item')]
  .find(r => r.textContent.includes('NIGHTDRIVE'))?.querySelector('.btn-det-open')?.click());
await page.waitForTimeout(800);
await page.click('#btn-modal-play');
await page.waitForTimeout(1500);

const mix = await page.evaluate(async () => {
  const ctx = window.__offline;
  if (!ctx) return null;
  const buf = await ctx.startRendering();
  let peak = 0, clipped = 0, sumSq = 0, n = 0, nonZero = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i]);
      if (v > peak) peak = v;
      if (v >= 0.999) clipped++;
      if (v > 1e-5) nonZero++;
      sumSq += d[i] * d[i]; n++;
    }
  }
  return { peak, clipped, rms: Math.sqrt(sumSq / n), nonZero };
});

check('audio: the song actually rendered', mix && mix.nonZero > 10000,
  mix ? `only ${mix.nonZero} non-silent samples` : 'no offline context');
check('audio: mix does not clip', mix && mix.clipped === 0,
  mix && `${mix.clipped} samples at full scale`);
check('audio: peak leaves headroom', mix && mix.peak < 0.95,
  mix && `peak ${mix.peak.toFixed(3)}`);
check('audio: mix is not inaudibly quiet', mix && mix.rms > 0.005,
  mix && `rms ${mix.rms.toFixed(4)}`);
check('audio: no page errors', errors.length === 0, errors.join('; '));
if (mix) console.log(`     peak ${mix.peak.toFixed(3)} · rms ${mix.rms.toFixed(4)} · clipped ${mix.clipped}`);

// ── offline render to WAV, and stems ───────────────────
// Assert the render actually produces audio and a valid WAV container,
// rather than only that the buttons exist.
const rendered = await page.evaluate(async () => {
  const dl = [];
  // capture downloads instead of writing files
  const realCreate = URL.createObjectURL;
  URL.createObjectURL = b => { dl.push(b); return 'blob:stub'; };
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {};
  document.getElementById('btn-modal-wav').click();
  // wait for the render to finish and the blob to be handed over
  for (let i = 0; i < 120 && !dl.length; i++) await new Promise(r => setTimeout(r, 250));
  URL.createObjectURL = realCreate;
  HTMLAnchorElement.prototype.click = origClick;
  if (!dl.length) return null;
  const buf = new Uint8Array(await dl[0].arrayBuffer());
  const txt = o => String.fromCharCode(...buf.slice(o, o + 4));
  const dv = new DataView(buf.buffer);
  // is there any non-silence?
  let peak = 0;
  for (let o = 44; o + 1 < buf.length; o += 2) {
    const v = Math.abs(dv.getInt16(o, true));
    if (v > peak) peak = v;
  }
  return { size: buf.length, riff: txt(0), wave: txt(8), fmt: txt(12), data: txt(36),
    channels: dv.getUint16(22, true), rate: dv.getUint32(24, true),
    bits: dv.getUint16(34, true), peak };
});
check('render: produced a file', !!rendered, 'no blob was created');
if (rendered) {
  check('render: valid WAV container',
    rendered.riff === 'RIFF' && rendered.wave === 'WAVE' && rendered.fmt === 'fmt ' && rendered.data === 'data',
    JSON.stringify(rendered));
  check('render: stereo 16-bit 44.1k',
    rendered.channels === 2 && rendered.bits === 16 && rendered.rate === 44100,
    `${rendered.channels}ch ${rendered.bits}bit ${rendered.rate}Hz`);
  check('render: contains audio, not silence', rendered.peak > 500, `peak ${rendered.peak}`);
  check('render: does not clip', rendered.peak < 32767, `peak ${rendered.peak}`);
  console.log(`     wav ${(rendered.size/1024).toFixed(0)}KB · peak ${rendered.peak}/32767`);
}

// stems: one file per channel that plays, and they must not be identical
const stems = await page.evaluate(async () => {
  const dl = [];
  const realCreate = URL.createObjectURL;
  URL.createObjectURL = b => { dl.push(b); return 'blob:stub'; };
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {};
  document.getElementById('btn-modal-stems').click();
  for (let i = 0; i < 240; i++) {
    await new Promise(r => setTimeout(r, 250));
    const msg = document.getElementById('cache-msg')?.textContent || '';
    if (/Rendered \d+ stem/.test(msg)) break;
  }
  URL.createObjectURL = realCreate;
  HTMLAnchorElement.prototype.click = origClick;
  const peaks = [];
  for (const b of dl) {
    const buf = new Uint8Array(await b.arrayBuffer());
    const dv = new DataView(buf.buffer);
    let peak = 0, sum = 0;
    for (let o = 44; o + 1 < buf.length; o += 2) {
      const v = Math.abs(dv.getInt16(o, true));
      if (v > peak) peak = v;
      sum += v;
    }
    peaks.push({ peak, sum });
  }
  return peaks;
});
check('stems: one file per playing channel', stems.length >= 2, `got ${stems.length}`);
check('stems: every stem has audio', stems.every(s2 => s2.peak > 100),
  stems.map(s2 => s2.peak).join(','));
check('stems: stems differ from each other',
  new Set(stems.map(s2 => s2.sum)).size === stems.length,
  'two stems are byte-identical, so the channel filter is not working');
if (stems.length) console.log(`     ${stems.length} stems · peaks ${stems.map(s2 => s2.peak).join(' ')}`);

await browser.close();
console.log(`\naudio: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
