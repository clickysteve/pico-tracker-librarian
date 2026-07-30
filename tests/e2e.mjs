// End-to-end browser tests. Unlike the parser tests these need Playwright
// (any recent version) and Chromium:
//   npm i -D playwright && node tests/e2e.mjs
// They drive the real app against an in-memory mock SD card and a fake
// WebSerial device, asserting scan results, batch repair, .pti export,
// theme device-writes, and the USB screen mirror.
const { chromium } = await (async () => {
  try { return await import('playwright'); }
  catch { return await import('/opt/node-tools/node_modules/playwright/index.mjs'); }
})();
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ok ${name}`); }
  else { fail++; console.error(`  FAIL ${name}`); }
};

const errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto('file://' + join(root, 'index.html'));

// ── 1. demo card loads ─────────────────────────────────
await page.click('#btn-demo');
await page.waitForTimeout(1500);
const health = await page.evaluate(() => ({
  projects: +document.getElementById('h-projects').textContent,
  broken: +document.getElementById('h-broken').textContent,
}));
check('demo: 3 projects', health.projects === 3);
check('demo: 2 missing samples', health.broken === 2);

// ── 2. batch repair fixes the fixable one ──────────────
await page.click('.tab-btn[data-tab="problems"]');
await page.waitForTimeout(300);
check('fix-all button offered', await page.evaluate(() => !!document.getElementById('btn-fixall')));
await page.click('#btn-fixall');
await page.waitForTimeout(1800);
const brokenAfter = await page.evaluate(() => +document.getElementById('h-broken').textContent);
check('batch repair: exactly the unrecoverable one remains', brokenAfter === 1);

// ── 3. .pti extraction appears in library after rescan ─
await page.click('.tab-btn[data-tab="instruments"]');
await page.waitForTimeout(300);
const ptisBefore = await page.evaluate(() => document.querySelectorAll('.i-src').length);
await page.click('.instr-row');
await page.waitForTimeout(200);
if (await page.evaluate(() => !!document.querySelector('.btn-export-pti'))) {
  await page.click('.btn-export-pti');
  await page.waitForTimeout(1800);
}
check('pti extraction ran without error', errors.length === 0);

// ── 4. theme set-on-device moves the badge ─────────────
await page.click('.tab-btn[data-tab="themes"]');
await page.waitForTimeout(300);
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('[data-setdev]')];
  btns[btns.length - 1].click();
});
await page.waitForTimeout(1500);
check('theme set on device (badge rendered)', await page.evaluate(() =>
  document.getElementById('themes-grid').innerHTML.includes('● device')));

// ── 5. USB mirror with a fake serial device ────────────
await page.evaluate(() => {
  window.__writes = [];
  const fakePort = {
    readable: new ReadableStream({ start(c) { window.__pushBytes = b => c.enqueue(new Uint8Array(b)); } }),
    writable: new WritableStream({ write(chunk) { window.__writes.push([...chunk]); } }),
    open: async () => {}, close: async () => {},
  };
  Object.defineProperty(navigator, 'serial', { value: { requestPort: async () => fakePort }, configurable: true });
});
await page.click('.tab-btn[data-tab="device"]');
await page.click('#btn-usb-connect');
await page.waitForTimeout(300);
await page.evaluate(() => {
  const O = 0x0F, out = [0xFE,0x03,0x0F,0x0F,0x0F, 0xFE,0x05,0x0F, 0xFE,0x04,0x79,0xB5,0xE3];
  'SONG'.split('').forEach((ch, i) => out.push(0xFE,0x02, ch.charCodeAt(0), 2+i+O, 1+O, 0x00));
  out.push(0xFE,0x02, 0x87, 10+O, 1+O, 0x00);      // special glyph (note icon)
  out.push(0xFE,0x02, 0x41, 12+O, 1+O, 0x7F);      // inverted A
  window.__pushBytes(out);
});
await page.waitForTimeout(300);
const usb = await page.evaluate(() => {
  const c = document.getElementById('usb-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, 300).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i] > 60 || d[i+2] > 60) lit++;
  return { lit, refreshSent: window.__writes.some(w => w[0] === 0xFE && w[1] === 0x02) };
});
check('usb: refresh request sent on connect', usb.refreshSent);
check('usb: glyphs rendered on canvas', usb.lit > 100);

// ── 6. experimental remote input frames ────────────────
await page.click('#btn-usb-input');
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(100);
await page.keyboard.up('ArrowRight');
await page.waitForTimeout(100);
// on-screen PLAY pad button
await page.dispatchEvent('.usb-key[data-bit="8"]', 'pointerdown');
await page.waitForTimeout(80);
await page.dispatchEvent('.usb-key[data-bit="8"]', 'pointerup');
await page.waitForTimeout(150);
const inputFrames = await page.evaluate(() =>
  window.__writes.filter(w => w[0] === 0xFE && w[1] === 0x03).map(w => w[2] | (w[3] << 8)));
check('input: RIGHT press+release masks sent', inputFrames.includes(0x004) &&
  inputFrames.indexOf(0x000, inputFrames.indexOf(0x004)) > inputFrames.indexOf(0x004));
check('input: PLAY (bit 8) mask sent from on-screen pad', inputFrames.includes(0x100));

// ── 7. player + phrase editor on the demo card ─────────
await page.click('.tab-btn[data-tab="projects"]');
await page.waitForTimeout(300);
await page.click('.proj-row');           // first project (BREAKS-90 or A-Z first)
await page.waitForTimeout(200);
await page.click('.btn-det-open');
await page.waitForTimeout(700);
// play (headless audio context runs silently; just assert the button flips)
await page.click('#btn-modal-play');
await page.waitForTimeout(900);
const playBtn = await page.evaluate(() => document.getElementById('btn-modal-play').textContent);
check('player: started (button shows Stop)', playBtn.includes('Stop'));
await page.click('#btn-modal-play');     // stop
await page.waitForTimeout(200);
// open patterns, drill to a phrase, edit note at step 0
await page.click('#btn-modal-patterns');
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('.pv-cell.chain')?.click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('.pv-cstep .cp')?.click());
await page.waitForTimeout(200);
const canEdit = await page.evaluate(() => !!document.getElementById('btn-phrase-edit'));
check('editor: edit button offered', canEdit);
await page.click('#btn-phrase-edit');
await page.waitForTimeout(200);
await page.evaluate(() => {
  const inp = document.querySelector('[data-step="0"] [data-f="note"]');
  inp.value = 'E-4';
  inp.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(200);
check('editor: dirty bar appears', await page.evaluate(() => !!document.getElementById('pv-save-bar')));
await page.click('#btn-save-edits');
await page.waitForTimeout(2000);
// reopen the same project fresh and confirm the edit persisted in the (in-memory) card
const firstProj = await page.evaluate(() => document.querySelector('.proj-item')?.dataset.proj);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.proj-item .proj-row')?.click());
await page.waitForTimeout(200);
await page.click('.btn-det-open');
await page.waitForTimeout(700);
await page.click('#btn-modal-patterns');
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('.pv-cell.chain')?.click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('.pv-cstep .cp')?.click());
await page.waitForTimeout(300);
const savedNote = await page.evaluate(() =>
  document.querySelector('#phrase-rows .pv-pstep .pn')?.textContent);
check('editor: saved edit persisted to card (E-4 at step 0)', savedNote === 'E-4');

// ── 8. slice editor on the demo card ───────────────────
await page.keyboard.press('Escape');
await page.click('.tab-btn[data-tab="instruments"]');
await page.waitForTimeout(300);
// find the Night Bass row (has slices + sample present)
const rowIdx = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.instr-item')];
  return rows.findIndex(r => r.textContent.includes('Night Bass'));
});
check('slicer: sliced demo instrument present', rowIdx >= 0);
await page.evaluate(i => document.querySelectorAll('.instr-item .instr-row')[i].click(), rowIdx);
await page.waitForTimeout(200);
check('slicer: button offered', await page.evaluate(() => !!document.querySelector('.instr-item.open .btn-slice-open')));
await page.evaluate(() => document.querySelector('.instr-item.open .btn-slice-open').click());
await page.waitForTimeout(1200);
check('slicer: waveform loaded', await page.evaluate(() => !document.getElementById('btn-slice-save').disabled));
await page.fill('#slice-n', '8');
await page.click('#btn-slice-equal');
await page.waitForTimeout(200);
const chipCount = await page.evaluate(() => document.querySelectorAll('#slice-chips [data-slice]').length);
check('slicer: equal-8 produced 8 regions', chipCount === 8);
await page.click('#btn-slice-save');
await page.waitForTimeout(2500);
const slicesAfter = await page.evaluate(() => {
  const p = null;
  // after rescan, check via the UI: reopen instruments and count SL chips on Night Bass
  return new Promise(res => setTimeout(() => {
    const rows = [...document.querySelectorAll('.instr-item')];
    const r = rows.find(x => x.textContent.includes('Night Bass'));
    r?.querySelector('.instr-row')?.click();
    setTimeout(() => {
      const chips = r ? [...r.querySelectorAll('.ipchip.mod')] : [];
      res(chips.length);
    }, 200);
  }, 400));
});
check('slicer: 7 markers persisted to card (8 slices)', slicesAfter === 7);

check('zero console errors across the whole run', errors.length === 0);
if (errors.length) console.error(errors);
await browser.close();
console.log(`\ne2e: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
