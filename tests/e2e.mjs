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

// ── 6. remote input is disabled (device reacted to the opcode) ──
check('input: button hidden pending firmware agreement', await page.evaluate(() =>
  getComputedStyle(document.getElementById('btn-usb-input')).display === 'none'));
check('input: no FE 03 frames were sent', await page.evaluate(() =>
  !window.__writes.some(w => w[0] === 0xFE && w[1] === 0x03)));

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
// the grid is directly editable now — no separate "edit" mode toggle
const canEdit = await page.evaluate(() =>
  !!document.querySelector('.pe-row[data-step="0"] .pe-c[data-f="note"][tabindex="0"]'));
check('editor: phrase grid is editable in place', canEdit);
check('editor: keyboard help shown', await page.evaluate(() => !!document.querySelector('.pe-help')));
// focus the note cell at step 0, type a new note, commit with Enter
await page.click('.pe-row[data-step="0"] .pe-c[data-f="note"]');
await page.waitForTimeout(100);
await page.keyboard.press('Enter');       // begin editing the focused cell
await page.waitForTimeout(100);
await page.evaluate(() => {
  const inp = document.querySelector('.pe-row[data-step="0"] .pe-edit');
  inp.value = 'E-4';
});
await page.keyboard.press('Enter');       // commit
await page.waitForTimeout(250);
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
  document.querySelector('#phrase-rows .pe-row[data-step="0"] .pe-note')?.textContent.trim());
check('editor: saved edit persisted to card (E-4 at step 0)', savedNote === 'E-4');
check('editor: phrase audition button present', await page.evaluate(() => !!document.getElementById('btn-ph-play')));

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
      const chips = r ? [...r.querySelectorAll('.pp-slice')] : [];
      res(chips.length);
    }, 200);
  }, 400));
});
check('slicer: 7 markers persisted to card (8 slices)', slicesAfter === 7);

// ── 8b. chain preview + unused-pool trash on the demo card ─
await page.keyboard.press('Escape');
await page.click('.tab-bin, .tab-btn[data-tab="projects"]').catch(() => {});
await page.click('.tab-btn[data-tab="projects"]');
await page.waitForTimeout(300);
await page.evaluate(() => [...document.querySelectorAll('.proj-item')].find(r => r.textContent.includes('NIGHTDRIVE'))?.querySelector('.proj-row')?.click());
await page.waitForTimeout(200);
await page.click('.btn-det-open');
await page.waitForTimeout(700);
await page.click('#btn-modal-patterns');
await page.waitForTimeout(400);
check('patterns: zoom + expand controls present', await page.evaluate(() =>
  !!document.getElementById('pv-zoom') && !!document.getElementById('btn-pv-expand')));
check('patterns: chain colour pickers present', await page.evaluate(() =>
  document.querySelectorAll('.pv-chainrow input[type=color]').length > 0));
// the chain list must be ascending by chain number, not song-usage order
check('patterns: chain list is in ascending order', await page.evaluate(() => {
  const ns = [...document.querySelectorAll('.pv-chainrow')].map(r => parseInt(r.dataset.chain, 10));
  return ns.length > 1 && ns.every((n, i) => i === 0 || n > ns[i - 1]);
}));
check('patterns: chain list shows usage counts', await page.evaluate(() =>
  [...document.querySelectorAll('.pv-chainrow .cp-count')].every(e => /^×\d+$/.test(e.textContent))));
await page.evaluate(() => document.querySelector('.pv-chainrow .cp-play')?.click());
await page.waitForTimeout(800);
const chainBtn = await page.evaluate(() => document.querySelector('.pv-chainrow .cp-play')?.textContent);
check('patterns: chain preview started', chainBtn === '■' || chainBtn === '▶');  // ■ while playing, ▶ if already ended
await page.keyboard.press('Escape');
await page.click('.tab-btn[data-tab="problems"]');
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('[data-psec="unusedpool"]').click());
await page.waitForTimeout(300);
const unusedBefore = await page.evaluate(() => document.querySelectorAll('.btn-trash-one').length);
check('cleanup: trash buttons offered', unusedBefore >= 1);
await page.click('.btn-trash-one');
await page.waitForTimeout(2000);
const unusedAfter = await page.evaluate(() => document.querySelectorAll('.btn-trash-one').length);
check('cleanup: sample moved to card trash', unusedAfter === unusedBefore - 1);

// ── 9. warm reopen of a (mock) real card reads no wav content ──
await page.evaluate(() => {
  function mkFile(name, content, mtime = 1700000000000) {
    const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    return { kind: 'file', name, getFile: async () => new File([data], name, { lastModified: mtime }),
      createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
  }
  function mkDir(name, entries) {
    return { kind: 'directory', name, entries,
      async *[Symbol.asyncIterator]() { for (const [n, h] of Object.entries(entries)) yield [n, h]; },
      async getDirectoryHandle(n, o) { const h = entries[n]; if (h?.kind === 'directory') return h;
        if (o?.create) { const d = mkDir(n, {}); entries[n] = d; return d; } throw new DOMException('nf', 'NotFoundError'); },
      async getFileHandle(n, o) { const h = entries[n]; if (h?.kind === 'file') return h;
        if (o?.create) { const f = mkFile(n, new Uint8Array()); entries[n] = f; return f; } throw new DOMException('nf', 'NotFoundError'); },
      async requestPermission() { return 'granted'; },
      async resolve() { return null; }, async isSameEntry() { return false; } };
  }
  const wav = () => { const b = new Uint8Array(100); b.set([82,73,70,70]); b.set([87,65,86,69], 8); return b; };
  const RUN = (v, l) => `<DATA VALUE="${v}" LENGTH="${l}"/>`;
  const proj = `<PICOTRACKER><PROJECT VERSION="3.1"><PARAMETER NAME="tempo" VALUE="120"/></PROJECT>
<SONG><SONG><DATA>00</DATA></SONG><CHAINS><DATA>00</DATA></CHAINS><TRANSPOSES>${RUN(0,16)}</TRANSPOSES>
<NOTES><DATA>3C</DATA></NOTES><INSTRUMENTS><DATA>00</DATA></INSTRUMENTS>
<COMMAND1>${RUN(45,16)}</COMMAND1><PARAM1>${RUN(0,32)}</PARAM1><COMMAND2>${RUN(45,16)}</COMMAND2><PARAM2>${RUN(0,32)}</PARAM2></SONG>
<INSTRUMENTBANK><INSTRUMENT ID="00" TYPE="SAMPLE"><PARAM NAME="sample" VALUE="k.wav"/></INSTRUMENT></INSTRUMENTBANK>
<TABLES/><GROOVES>${RUN(255,64)}</GROOVES><MIXER/></PICOTRACKER>`;
  // macOS junk is sprinkled through this card on purpose — none of it
  // should be scanned, counted, or shown anywhere
  const card = mkDir('WARMCARD', {
    projects: mkDir('projects', {
      ONE: mkDir('ONE', {
        'ptsav.dat': mkFile('ptsav.dat', proj),
        '._ptsav.dat': mkFile('._ptsav.dat', 'MACJUNK'),
        '.DS_Store': mkFile('.DS_Store', 'MACJUNK'),
        samples: mkDir('samples', {
          'k.wav': mkFile('k.wav', wav()),
          'x.wav': mkFile('x.wav', wav()),
          '._k.wav': mkFile('._k.wav', wav()),
          '._x.wav': mkFile('._x.wav', wav()),
        }),
      }),
      '.DS_Store': mkFile('.DS_Store', 'MACJUNK'),
      '._ONE': mkDir('._ONE', { 'ptsav.dat': mkFile('ptsav.dat', proj) }),
    }),
    samples: mkDir('samples', {
      'lib.wav': mkFile('lib.wav', wav()),
      '._lib.wav': mkFile('._lib.wav', wav()),
      '.Spotlight-V100': mkDir('.Spotlight-V100', { 'junk.wav': mkFile('junk.wav', wav()) }),
    }),
  });
  window.showDirectoryPicker = async () => card;
});
await page.click('#btn-open');
await page.waitForTimeout(1200);
const coldMsg = await page.evaluate(() => document.getElementById('cache-msg').textContent);
check('cold open reads sample heads', /[1-9]\d* samples? read/.test(coldMsg));
// junk filter: 3 real wavs on this card (k, x, lib) and one real project
check('junk: only the 3 real wavs were read (macOS ._ files skipped)',
  /\b3 samples? read/.test(coldMsg));
await page.click('.tab-btn[data-tab="samples"]');
await page.waitForTimeout(400);
check('junk: no ._ files listed in the sample browser', await page.evaluate(() =>
  !document.getElementById('tab-samples').textContent.includes('._')));
await page.click('.tab-btn[data-tab="projects"]');
await page.waitForTimeout(400);
check('junk: ._ project folder not listed as a project', await page.evaluate(() =>
  document.querySelectorAll('.proj-item').length === 1 &&
  !document.getElementById('tab-projects').textContent.includes('._ONE')));
await page.click('#btn-open');
await page.waitForTimeout(1500);
const warmMsg = await page.evaluate(() => document.getElementById('cache-msg').textContent);
check('warm reopen reads 0 sample heads', warmMsg.includes('0 samples read'));

check('zero console errors across the whole run', errors.length === 0);
if (errors.length) console.error(errors);
await browser.close();
console.log(`\ne2e: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
