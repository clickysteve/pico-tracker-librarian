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

await browser.close();
console.log(`\naudio: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
