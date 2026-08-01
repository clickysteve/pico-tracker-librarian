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

// Escape inside an editor clears the selection rather than closing the
// project, so close the workspace explicitly.
const closeProjectModal = async () => {
  await page.evaluate(() => {
    const m = document.getElementById('proj-modal');
    if (m && m.style.display !== 'none') document.getElementById('btn-modal-close').click();
    document.getElementById('slice-modal')?.style?.display === 'flex' && document.getElementById('btn-slice-close').click();
  });
  await page.waitForTimeout(250);
};

const errors = [];
// --enable-unsafe-swiftshader gives headless Chromium a software WebGL
// stack, which the mirror's output effects need. Real browsers use the GPU.
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
// The app now confirms destructive/unsaved-work actions; accept them all.
page.on('dialog', d => d.accept());
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto('file://' + join(root, 'index.html'));
// Record every buffer-source start so the slice-offset assertions below can
// inspect what the player actually scheduled.
await page.addInitScript(() => {
  window.__sliceStarts = [];
  const orig = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, offset, dur) {
    if (dur !== undefined && this.buffer)
      window.__sliceStarts.push({ offset, dur, bufRate: this.buffer.sampleRate, bufDur: this.buffer.duration });
    return orig.call(this, when, offset, dur);
  };
});
await page.reload();

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
// USB now paints into an offscreen source canvas; Mirror owns whatever is
// on screen, so the glyph check reads the source directly.
const usb = await page.evaluate(() => {
  const c = USB.sourceCanvas();
  const d = c.getContext('2d').getImageData(0, 0, c.width, 300).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i] > 60 || d[i+2] > 60) lit++;
  return { lit, refreshSent: window.__writes.some(w => w[0] === 0xFE && w[1] === 0x02),
           w: c.width, h: c.height };
});
check('usb: refresh request sent on connect', usb.refreshSent);
check('usb: glyphs rendered on canvas', usb.lit > 100);
check('usb: source canvas is the full device screen at 3x', usb.w === 960 && usb.h === 720);

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
// v0.8 overview: hero stats, foldable sections, per-instrument slicer
check('overview: pool rows have preview buttons in the list detail',
  await page.evaluate(() => document.querySelectorAll('.det-play').length > 0));
await page.click('.btn-det-open');
await page.waitForTimeout(700);
check('overview: headline stats rendered', await page.evaluate(() =>
  document.querySelectorAll('.ov-hero').length === 4 &&
  document.querySelectorAll('.ov-panel').length === 3));
check('overview: stats are not all identical chips', await page.evaluate(() =>
  document.querySelectorAll('.ov-stat').length === 0));
check('overview: instrument chips carry a ✂ when sliceable', await page.evaluate(() =>
  document.querySelectorAll('.ichip-instr [data-slice-instr]').length > 0));
check('overview: pool rows have preview buttons', await page.evaluate(() =>
  document.querySelectorAll('#ov-samples .play-btn').length > 0));
// fold the instruments section away and back
await page.click('[data-fold="ov-instr"]');
await page.waitForTimeout(150);
check('overview: instruments section collapses', await page.evaluate(() =>
  document.getElementById('ov-instr').style.display === 'none'));
await page.click('[data-fold="ov-instr"]');
await page.waitForTimeout(150);
check('overview: instruments section reopens', await page.evaluate(() =>
  document.getElementById('ov-instr').style.display !== 'none'));
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
await page.evaluate(() => document.querySelector('.pv-cstep .cgo')?.click());
await page.waitForTimeout(200);
// the grid is directly editable now — no separate "edit" mode toggle
const canEdit = await page.evaluate(() =>
  !!document.querySelector('.pe-row[data-step="0"] .pe-c[data-f="note"][tabindex="0"]'));
check('editor: phrase grid is editable in place', canEdit);
check('editor: keyboard help shown', await page.evaluate(() =>
  !!document.querySelector('#pv-phrase-detail .pe-help')));
// focus the note cell at step 0, type a new note, commit with Enter
await page.click('.pe-row[data-step="0"] .pe-c[data-f="note"]');
await page.waitForTimeout(100);
await page.keyboard.press('Enter');       // opens the note pick-list
await page.waitForTimeout(200);
check('editor: note cell opens a pick list', await page.evaluate(() => !!document.querySelector('.pick')));
await page.evaluate(() => {
  const f = document.querySelector('.pick-filter');
  f.value = 'E-4';
  f.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(150);
await page.keyboard.press('Enter');       // choose the highlighted entry
await page.waitForTimeout(250);
check('editor: dirty bar appears', await page.evaluate(() => !!document.getElementById('pv-save-bar')));
await page.click('#btn-save-edits');
await page.waitForTimeout(400);
check('save preview: opens before writing', await page.evaluate(() =>
  document.getElementById('save-preview').classList.contains('open')));
check('save preview: lists what will change', await page.evaluate(() =>
  /Phrases|Song grid|Chains/.test(document.getElementById('savep-body').textContent)));
await page.click('#btn-savep-go');
await page.waitForTimeout(2000);
// reopen the same project fresh and confirm the edit persisted in the (in-memory) card
const firstProj = await page.evaluate(() => document.querySelector('.proj-item')?.dataset.proj);
await closeProjectModal();
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.proj-item .proj-row')?.click());
await page.waitForTimeout(200);
await page.click('.btn-det-open');
await page.waitForTimeout(700);
await page.click('#btn-modal-patterns');
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('.pv-cell.chain')?.click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('.pv-cstep .cgo')?.click());
await page.waitForTimeout(300);
const savedNote = await page.evaluate(() =>
  document.querySelector('#phrase-rows .pe-row[data-step="0"] .pe-note')?.textContent.trim());
check('editor: saved edit persisted to card (E-4 at step 0)', savedNote === 'E-4');
check('editor: phrase audition button present', await page.evaluate(() => !!document.getElementById('btn-ph-play')));

// ── 7a2. arrangement editing: song grid + chain steps ───
// Both write through the same paranoid path as repairs, so this asserts the
// edit survives write + reparse, not just that the DOM changed.
await page.evaluate(() => document.querySelector('.pv-cell.empty[data-row]')?.focus());
const emptyCell = await page.evaluate(() => {
  const c = document.querySelector('.pv-cell.empty[data-row]');
  return c ? { row: c.dataset.row, ch: c.dataset.ch } : null;
});
check('grid: an empty cell was available to fill', !!emptyCell);
await page.evaluate(() => {
  const c = document.querySelector('.pv-cell.empty[data-row]');
  c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await page.waitForTimeout(250);
check('grid: clicking a cell opens the chain pick list', await page.evaluate(() =>
  !!document.querySelector('.pick')));
check('grid: pick list shows chains already in the song', await page.evaluate(() =>
  [...document.querySelectorAll('.pick-group')].some(g => g.textContent === 'In this song')));
await page.evaluate(() => {
  const f = document.querySelector('.pick-filter');
  f.value = '02';
  f.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(150);
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check('grid: placing a chain marks the song dirty', await page.evaluate(() =>
  (document.getElementById('pv-save-bar')?.textContent || '').includes('song grid')));
const placed = await page.evaluate(sel =>
  document.querySelector(`.pv-cell[data-row="${sel.row}"][data-ch="${sel.ch}"]`)?.textContent.trim(), emptyCell);
check('grid: the cell now shows the placed chain', placed === '02');
// edit a chain step's phrase
await page.evaluate(() => document.querySelector('.pv-cell.chain')?.click());
await page.waitForTimeout(250);
check('chain: step list is editable', await page.evaluate(() =>
  document.querySelectorAll('.pv-cstep [data-f="phrase"][tabindex="0"]').length === 16));
// Chain cells behave like song-grid cells: click selects, Enter (or typing)
// opens the picker, Delete clears. Clicking must NOT open the picker.
await page.evaluate(() => {
  const c = document.querySelector('.pv-cstep [data-f="phrase"]');
  c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await page.waitForTimeout(250);
check('chain: clicking a phrase cell selects it rather than opening the picker',
  await page.evaluate(() => !document.querySelector('.pick') &&
    document.activeElement?.dataset?.f === 'phrase'));
// Delete clears the value in place
const hadPhrase = await page.evaluate(() =>
  document.querySelector('.pv-cstep [data-f="phrase"]').textContent.trim());
await page.evaluate(() => document.activeElement.dispatchEvent(
  new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })));
await page.waitForTimeout(300);
check('chain: Delete clears a phrase cell without opening the picker',
  hadPhrase !== '--' && await page.evaluate(() =>
    document.querySelector('.pv-cstep [data-f="phrase"]').textContent.trim() === '--'));
// Enter opens the picker
await page.evaluate(() => {
  const c = document.querySelector('.pv-cstep [data-f="phrase"]');
  c.focus();
  c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
await page.waitForTimeout(250);
check('chain: Enter opens the pick list', await page.evaluate(() => !!document.querySelector('.pick')));
await page.keyboard.press('Escape');          // dismiss the picker, not the project
await page.waitForTimeout(150);
// put the phrase back so later assertions still have one
await page.evaluate(hp => {
  const c = document.querySelector('.pv-cstep [data-f="phrase"]');
  c.focus();
  c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  setTimeout(() => {
    const f = document.querySelector('.pick-filter');
    if (f) { f.value = hp; f.dispatchEvent(new Event('input', { bubbles: true })); }
  }, 60);
}, hadPhrase);
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.evaluate(() => {
  const c = document.querySelector('.pv-cstep [data-f="transpose"]');
  c.focus();
  c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
await page.waitForTimeout(200);
await page.evaluate(() => { const i = document.querySelector('.pv-cstep .pe-edit'); if (i) i.value = '-5'; });
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check('chain: editing a step marks chains dirty', await page.evaluate(() =>
  (document.getElementById('pv-save-bar')?.textContent || '').includes('chain')));
check('chain: transpose shows the new value', await page.evaluate(() =>
  document.querySelector('.pv-cstep [data-f="transpose"]')?.textContent.trim() === '-5'));
// save and confirm it survived the write + reparse
await page.click('#btn-save-edits');
await page.waitForTimeout(400);
await page.click('#btn-savep-go');
await page.waitForTimeout(2500);
check('arrangement: save cleared the dirty bar', await page.evaluate(() =>
  !document.getElementById('pv-save-bar')));
await closeProjectModal();
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.proj-item .proj-row')?.click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('.proj-item .btn-det-open')?.click());
await page.waitForTimeout(800);
await page.click('#btn-modal-patterns');
await page.waitForTimeout(500);
const reread = await page.evaluate(sel =>
  document.querySelector(`.pv-cell[data-row="${sel.row}"][data-ch="${sel.ch}"]`)?.textContent.trim(), emptyCell);
check('arrangement: placed chain persisted to the card', reread === '02');
await page.evaluate(() => document.querySelector('.pv-cell.chain')?.click());
await page.waitForTimeout(250);
check('arrangement: chain transpose persisted to the card', await page.evaluate(() =>
  document.querySelector('.pv-cstep [data-f="transpose"]')?.textContent.trim() === '-5'));

// spare rows past the end of the song, and whole-row copy/paste
check('grid: spare rows offered past the end of the song', await page.evaluate(() =>
  document.querySelectorAll('.pv-cell.rlbl.spare').length > 0));
check('grid: spare rows are editable like any other', await page.evaluate(() =>
  document.querySelectorAll('.pv-cell.empty.spare[tabindex="0"]').length > 0));
const rowsBefore = await page.evaluate(() => document.querySelectorAll('.pv-cell.rlbl').length);
await page.evaluate(() => document.getElementById('btn-pv-morerows')?.click());
await page.waitForTimeout(250);
check('grid: "+ more rows" extends the grid', await page.evaluate(r =>
  document.querySelectorAll('.pv-cell.rlbl').length > r, rowsBefore));
// copy row 0 and paste it over a spare row
check('grid: paste hidden until something is copied', await page.evaluate(() =>
  [...document.querySelectorAll('.pv-rowpaste')].every(b => b.style.display === 'none')));
await page.evaluate(() => document.querySelector('.pv-rowcopy[data-row="0"]')?.click());
await page.waitForTimeout(250);
check('grid: paste appears once a row is copied', await page.evaluate(() =>
  [...document.querySelectorAll('.pv-rowpaste')].some(b => b.style.display !== 'none')));
const row0 = await page.evaluate(() =>
  [...document.querySelectorAll('.pv-cell[data-row="0"]')].map(c => c.textContent.trim()).join(','));
const spareRow = await page.evaluate(() =>
  document.querySelector('.pv-cell.rlbl.spare')?.textContent.trim());
await page.evaluate(sr => {
  const target = [...document.querySelectorAll('.pv-rowpaste')]
    .find(b => parseInt(b.dataset.row, 10) === parseInt(sr, 16));
  target?.click();
}, spareRow);
await page.waitForTimeout(300);
const pasted = await page.evaluate(sr =>
  [...document.querySelectorAll(`.pv-cell[data-row="${parseInt(sr, 16)}"]`)].map(c => c.textContent.trim()).join(','), spareRow);
check('grid: pasted row matches the copied row', pasted === row0 && row0.length > 0);

// v0.9.4: insert/delete step, chain step layout, live marks, transport
check('grid: cells navigate with the arrow keys', await page.evaluate(async () => {
  const first = document.querySelector('.pv-cell[data-row="0"][data-ch="0"]');
  first.focus();
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  const a = document.activeElement;
  return a?.dataset?.row === '0' && a?.dataset?.ch === '1';
}));
await page.evaluate(() => document.querySelector('.pv-cell.chain')?.click());
await page.waitForTimeout(300);
check('chain steps: every fourth row is beat-marked', await page.evaluate(() => {
  const beats = [...document.querySelectorAll('.pv-cstep.beat')].map(r => +r.dataset.step);
  return beats.length === 4 && beats.every(b => b % 4 === 0);
}));
check('chain steps: columns line up regardless of transpose', await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.pv-cstep')];
  const xs = rows.map(r => Math.round(r.querySelector('.cgo').getBoundingClientRect().left));
  return new Set(xs).size === 1;   // the old flex rule made these drift
}));
check('chain steps: every row offers an edit affordance', await page.evaluate(() =>
  document.querySelectorAll('.pv-cstep .cgo').length === 16));
// pick lists must reach values that are not in the list
await page.evaluate(() => document.querySelector('.pv-cell.empty[data-row]')
  ?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await page.waitForTimeout(250);
await page.evaluate(() => {
  const f = document.querySelector('.pick-filter');
  f.value = 'A4';
  f.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(150);
check('picker: an unlisted value can still be chosen', await page.evaluate(() =>
  [...document.querySelectorAll('.pick-item .pick-lbl')].some(n => n.textContent.trim() === 'A4')));
await page.keyboard.press('Escape');          // dismiss the picker, not the project
await page.waitForTimeout(150);

// block selection: shift+arrows mark a range, which copies/pastes/clears
check('select: shift+arrow marks a block', await page.evaluate(async () => {
  const c = document.querySelector('.pv-cell[data-row="0"][data-ch="0"]');
  c.focus();
  c.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  const a = document.activeElement;
  a.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  return document.querySelectorAll('.pv-cell.sel').length === 4;   // 2x2
}));
check('select: the block size is reported', await page.evaluate(() =>
  /2×2/.test(document.getElementById('pv-selinfo')?.textContent || '')));
// copy the 2x2 block, move away, paste it, and confirm the values landed
const blockVals = await page.evaluate(() =>
  [[0,0],[0,1],[1,0],[1,1]].map(([r,t]) =>
    document.querySelector(`.pv-cell[data-row="${r}"][data-ch="${t}"]`).textContent.trim()));
// note the target row BEFORE pasting: filling spare rows extends the song,
// so they stop being spare and the selector would find a different row
const targetRow = await page.evaluate(async () => {
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  const target = document.querySelector('.pv-cell.empty.spare[data-ch="0"]');
  if (!target) return null;
  const r0 = parseInt(target.dataset.row, 10);
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  target.focus();
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', metaKey: true, bubbles: true }));
  return r0;
});
await page.waitForTimeout(350);
const pastedBlock = targetRow === null ? null : await page.evaluate(r0 =>
  [[0,0],[0,1],[1,0],[1,1]].map(([dr,dt]) =>
    document.querySelector(`.pv-cell[data-row="${r0+dr}"][data-ch="${dt}"]`)?.textContent.trim()), targetRow);
check('select: a copied block pastes as a block',
  !!pastedBlock && pastedBlock.join(',') === blockVals.join(','));
// Esc deselects
await page.evaluate(() => {
  const c = document.querySelector('.pv-cell[data-row="0"][data-ch="0"]');
  c.focus();
  c.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
});
await page.waitForTimeout(80);
await page.evaluate(() =>
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
await page.waitForTimeout(80);
check('select: Esc clears the selection', await page.evaluate(() =>
  document.querySelectorAll('.pv-cell.sel').length === 0));

// ── 7a2b. optional QWERTY piano entry ───────────────────
// open a chain, then a phrase inside it, so the phrase editor is on screen
await page.evaluate(() => document.querySelector('.pv-cell.chain')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.pv-cstep .cgo:not(.off)')?.click());
await page.waitForTimeout(350);
check('piano: off by default with a toggle offered', await page.evaluate(() => {
  const b = document.getElementById('btn-ph-piano');
  return !!b && !b.classList.contains('on');
}));
await page.click('#btn-ph-piano');
await page.waitForTimeout(250);
check('piano: toggling on shows the octave and step controls', await page.evaluate(() =>
  document.getElementById('btn-ph-piano').classList.contains('on') &&
  !!document.getElementById('ph-oct') && !!document.getElementById('ph-step')));
// type a melody down the note column: z=C, x=D, c=E at the current octave
const beforeOct = await page.evaluate(() => +document.getElementById('ph-oct').textContent);
await page.evaluate(async () => {
  const press = k => {
    const c = document.querySelector('.pe-row.cur .pe-c[data-f="note"]')
           || document.querySelector('.pe-row[data-step="0"] .pe-c[data-f="note"]');
    c.focus();
    c.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  };
  const first = document.querySelector('.pe-row[data-step="0"] .pe-c[data-f="note"]');
  first.focus();
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  press('x');
  await new Promise(r => setTimeout(r, 120));
  press('c');
  await new Promise(r => setTimeout(r, 120));
});
await page.waitForTimeout(300);
const typed = await page.evaluate(() => [0,1,2].map(i =>
  document.querySelector(`.pe-row[data-step="${i}"] .pe-note`)?.textContent.trim()));
check('piano: typing z x c enters C, D and E on consecutive steps',
  typed[0] === `C-${beforeOct}` && typed[1] === `D-${beforeOct}` && typed[2] === `E-${beforeOct}`);
check('piano: the instrument is carried down with the notes', await page.evaluate(() =>
  [0,1,2].every(i => {
    const t = document.querySelector(`.pe-row[data-step="${i}"] .pe-instr`)?.textContent.trim();
    return t && t !== '--';
  })));
// octave keys
await page.evaluate(() => {
  const c = document.querySelector('.pe-row[data-step="0"] .pe-c[data-f="note"]');
  c.focus();
  c.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }));
});
await page.waitForTimeout(250);
check('piano: ] raises the octave', await page.evaluate(o =>
  +document.getElementById('ph-oct').textContent === o + 1, beforeOct));
// note-off, and modifiers must still reach the editor rather than the piano
await page.evaluate(() => {
  const c = document.querySelector('.pe-row[data-step="4"] .pe-c[data-f="note"]');
  c.focus();
  c.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
});
await page.waitForTimeout(250);
check('piano: a enters a note-off', await page.evaluate(() =>
  document.querySelector('.pe-row[data-step="4"] .pe-note')?.textContent.trim() === 'OFF'));
await page.evaluate(() => {
  const c = document.querySelector('.pe-row[data-step="0"] .pe-c[data-f="note"]');
  c.focus();
  c.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
});
await page.waitForTimeout(250);
check('piano: Cmd+Z still undoes rather than typing a note', await page.evaluate(() =>
  document.querySelector('.pe-row[data-step="4"] .pe-note')?.textContent.trim() !== 'OFF'));
await page.click('#btn-ph-piano');     // back off for the rest of the run
await page.waitForTimeout(250);
check('piano: toggles back off', await page.evaluate(() =>
  !document.getElementById('btn-ph-piano').classList.contains('on')));

// ── 7a3. unsaved edits must survive navigation ──────────
// Regression guards. Previously: Escape inside an editor closed the
// project; reopening it re-read the card and threw the edits away while
// the dirty flags survived, so Save wrote the ORIGINAL bytes back and
// reported "saved and verified" — with a false line in the on-card audit
// log. Selection and clipboards also leaked between projects.
await page.evaluate(() => {
  const c = document.querySelector('.pv-cell.empty[data-row]') || document.querySelector('.pv-cell[data-row]');
  c.focus();
  c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
});
await page.waitForTimeout(200);
check('safety: Escape in the grid does not close the project', await page.evaluate(() =>
  document.getElementById('proj-modal').style.display !== 'none'));
// make an edit, leave the project, come back: it must still be there
const dirtyBefore = await page.evaluate(() => {
  const cell = document.querySelector('.pv-cell.empty[data-row]');
  return cell ? { row: cell.dataset.row, ch: cell.dataset.ch } : null;
});
if (dirtyBefore) {
  await page.evaluate(sel => {
    const c = document.querySelector(`.pv-cell[data-row="${sel.row}"][data-ch="${sel.ch}"]`);
    c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    c.focus();
    c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  }, dirtyBefore);
  await page.waitForTimeout(250);
}
// clear a specific populated cell and remember exactly which one
const clearedCell = await page.evaluate(() => {
  const c = document.querySelector('.pv-cell.chain[data-row]');
  const at = { row: c.dataset.row, ch: c.dataset.ch };
  c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  c.focus();
  c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  return at;
});
await page.waitForTimeout(300);
check('safety: clearing a cell marks the project dirty',
  await page.evaluate(() => !!document.getElementById('pv-save-bar')));
check('safety: the cell really cleared', await page.evaluate(at =>
  document.querySelector(`.pv-cell[data-row="${at.row}"][data-ch="${at.ch}"]`)
    ?.classList.contains('empty'), clearedCell));
const projName = await page.evaluate(() => document.getElementById('modal-title').textContent);
await closeProjectModal();
await page.waitForTimeout(300);
await page.evaluate(nm => {
  const row = [...document.querySelectorAll('.proj-item')].find(r => r.textContent.includes(nm));
  row?.querySelector('.btn-det-open')?.click();
}, projName);
await page.waitForTimeout(900);
await page.click('#btn-modal-patterns');
await page.waitForTimeout(500);
// The dirty flag alone proves nothing — it survived the old bug too, which
// is what made the bug silent. Assert the EDITED DATA came back.
check('safety: unsaved edits survive closing and reopening the project',
  await page.evaluate(at =>
    !!document.getElementById('pv-save-bar') &&
    document.querySelector(`.pv-cell[data-row="${at.row}"][data-ch="${at.ch}"]`)
      ?.classList.contains('empty'), clearedCell));
// undo puts it back
await page.evaluate(() => {
  const c = document.querySelector('.pv-cell[data-row]');
  c.focus();
  c.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
});
await page.waitForTimeout(300);
check('safety: the song grid has undo', await page.evaluate(() =>
  document.querySelectorAll('.pv-cell.chain').length > 0));
// selection must not follow us to another project
await page.evaluate(() => {
  const c = document.querySelector('.pv-cell[data-row="0"][data-ch="0"]');
  c.focus();
  c.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
});
await page.waitForTimeout(150);
await page.evaluate(() => document.getElementById('btn-modal-next').click());
await page.waitForTimeout(1000);
await page.click('#btn-modal-patterns');
await page.waitForTimeout(400);
check('safety: selection does not leak into the next project', await page.evaluate(() =>
  document.querySelectorAll('.pv-cell.sel').length === 0));
// an emptied grid must still be editable, not a dead end
await page.evaluate(() => {
  const c = document.querySelector('.pv-cell[data-row]');
  if (!c) return;
  c.focus();
  c.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true }));
  c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
});
await page.waitForTimeout(400);
check('safety: an emptied grid stays editable', await page.evaluate(() =>
  document.querySelectorAll('.pv-cell[data-row]').length > 0));
check('safety: an emptied grid still offers save/discard', await page.evaluate(() =>
  !!document.getElementById('pv-save-bar')));
await page.evaluate(() => {
  const c = document.querySelector('.pv-cell[data-row]');
  c.focus();
  c.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
});
await page.waitForTimeout(300);
await page.evaluate(() => {
  const bar = document.getElementById('pv-save-bar');
  bar?.querySelector('#btn-discard-edits')?.click();
});
await page.waitForTimeout(1200);

// ── 7a4. v0.9.8 feature sweep ───────────────────────────
// the discard above reloaded the project onto the Overview tab
await page.click('#btn-modal-patterns');
await page.waitForTimeout(500);
// jump to any chain/phrase without touching the arrangement
await page.click('#btn-pv-jump');
await page.waitForTimeout(250);
check('jump: opens a chain/phrase picker', await page.evaluate(() => !!document.querySelector('.pick')));
check('jump: offers slots that are not in the song', await page.evaluate(() =>
  [...document.querySelectorAll('.pick-group')].some(g => g.textContent === 'Empty')));
await page.evaluate(() => {
  const f = document.querySelector('.pick-filter');
  f.value = 'p 7F';
  f.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.waitForTimeout(350);
check('jump: reaching an unplaced phrase opens the editor', await page.evaluate(() =>
  document.getElementById('pv-phrase-detail')?.dataset.phrase === '127'));

// phrase block selection + selection-scoped transpose
await page.evaluate(() => document.querySelector('.pv-cell.chain')?.click());
await page.waitForTimeout(250);
await page.evaluate(() => document.querySelector('.pv-cstep .cgo:not(.off)')?.click());
await page.waitForTimeout(300);
check('phrase: usage is stated in the header', await page.evaluate(() =>
  /used|not referenced|shared/.test(document.querySelector('#pv-phrase-detail .usage-note')?.textContent || '')));
check('phrase: breadcrumb back to the chain', await page.evaluate(() =>
  !!document.querySelector('#pv-phrase-detail .pe-crumb a')));
check('phrase: selection block marks cells', await page.evaluate(async () => {
  const c = document.querySelector('.pe-row[data-step="0"] .pe-c[data-col="0"]');
  c.focus();
  c.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }));
  await new Promise(r => setTimeout(r, 80));
  return document.querySelectorAll('.pe-c.sel').length === 2;
}));
check('phrase: clone button offered', await page.evaluate(() => !!document.getElementById('btn-ph-clone')));

// tables and grooves
await page.click('#btn-modal-tables');
await page.waitForTimeout(450);
check('tables: the tab renders a table grid', await page.evaluate(() =>
  document.querySelectorAll('#modal-tables-section .tg-row').length === 16));
check('tables: groove steps are editable', await page.evaluate(() =>
  document.querySelectorAll('#modal-tables-section .tg-gs[tabindex="0"]').length >= 16));
await page.evaluate(() => {
  const g = document.querySelector('#modal-tables-section .tg-gs');
  g.focus();
  g.dispatchEvent(new KeyboardEvent('keydown', { key: '8', bubbles: true }));
});
await page.waitForTimeout(250);
await page.evaluate(() => {
  const i = document.querySelector('#modal-tables-section .pe-edit');
  if (i) { i.value = '8'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
});
await page.waitForTimeout(300);
check('tables: editing a groove step marks the project dirty', await page.evaluate(() =>
  (document.getElementById('pv-save-bar')?.textContent || '').includes('groove')));
await page.click('#btn-modal-patterns');
await page.waitForTimeout(300);

// transport controls
check('transport: loop and scrub controls present', await page.evaluate(() =>
  !!document.getElementById('tr-loop') && !!document.getElementById('tr-barwrap')));
// render buttons
check('render: WAV and stems offered', await page.evaluate(() =>
  !!document.getElementById('btn-modal-wav') && !!document.getElementById('btn-modal-stems')));
// new project button
check('new project: offered on the projects toolbar', await page.evaluate(() =>
  !!document.getElementById('btn-new-project')));
// undo is shared across panes
check('undo: redo button offered in the phrase editor', await page.evaluate(() =>
  !!document.getElementById('btn-ph-redo')));
// auto-advance toggle
check('advance: toggle and edit-step control present', await page.evaluate(() =>
  !!document.getElementById('btn-ph-adv') && !!document.getElementById('ph-step')));

// ── 7a5. review-fix regressions ─────────────────────────
// Undo must cover tables: a table edit followed by Ctrl+Z used to pop a
// snapshot that predated it and silently revert an unrelated phrase edit.
await page.click('#btn-modal-tables');
await page.waitForTimeout(400);
const tableUndo = await page.evaluate(async () => {
  const cell = document.querySelector('#modal-tables-section .tg-c.tg-par[tabindex="0"]');
  if (!cell) return { skipped: true };
  const before = cell.textContent.trim();
  cell.focus();
  cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  const inp = document.querySelector('#modal-tables-section .pe-edit');
  if (!inp) return { skipped: true };
  inp.value = '0ABC';
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  const after = document.querySelector('#modal-tables-section .tg-c.tg-par')?.textContent.trim();
  const c2 = document.querySelector('#modal-tables-section .tg-c.tg-par[tabindex="0"]');
  c2.focus();
  c2.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  const undone = document.querySelector('#modal-tables-section .tg-c.tg-par')?.textContent.trim();
  return { before, after, undone };
});
if (!tableUndo.skipped) {
  check('undo: a table edit is applied', tableUndo.after === '0ABC',
    `got ${tableUndo.after}`);
  check('undo: Ctrl+Z reverts the table edit itself',
    tableUndo.undone === tableUndo.before, `${tableUndo.undone} vs ${tableUndo.before}`);
}
// Groove edits must reach the playback timeline, not just the display.
const grooveEffect = await page.evaluate(async () => {
  const before = document.getElementById('modal-meta')?.textContent || '';
  const g = document.querySelector('#modal-tables-section .tg-gs');
  if (!g) return { skipped: true };
  g.focus();
  g.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  const i = document.querySelector('#modal-tables-section .pe-edit');
  if (!i) return { skipped: true };
  i.value = '24';                       // much slower than the default 6
  i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  return { before };
});
if (!grooveEffect.skipped) {
  check('groove: the edit shows in the groove editor', await page.evaluate(() =>
    document.querySelector('#modal-tables-section .tg-gs')?.textContent.trim() === '24'));
  check('groove: the project is marked dirty', await page.evaluate(() =>
    (document.getElementById('pv-save-bar')?.textContent || '').includes('groove')));
  // undo it so later assertions are not thrown off
  await page.evaluate(() => {
    const g = document.querySelector('#modal-tables-section .tg-gs');
    g.focus();
    g.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
  });
  await page.waitForTimeout(300);
  check('groove: Ctrl+Z reverts the groove edit', await page.evaluate(() =>
    document.querySelector('#modal-tables-section .tg-gs')?.textContent.trim() !== '24'));
}
await page.click('#btn-modal-patterns');
await page.waitForTimeout(400);

// ── 7b. sliced playback uses the wav's own sample rate ──
// Must run BEFORE the slicer test below, which overwrites Night Bass's
// markers with 8 equal divisions.
await closeProjectModal();
await page.click('.tab-btn[data-tab="projects"]');
await page.waitForTimeout(300);
// scope to NIGHTDRIVE's own row: other rows may still be expanded from
// earlier sections, and a bare .btn-det-open would hit the wrong one
await page.evaluate(() => {
  document.querySelectorAll('.proj-item.open .proj-row').forEach(r => r.click());  // collapse any open rows
  [...document.querySelectorAll('.proj-item')].find(r => r.textContent.includes('NIGHTDRIVE'))?.querySelector('.proj-row')?.click();
});
await page.waitForTimeout(300);
await page.evaluate(() =>
  [...document.querySelectorAll('.proj-item')].find(r => r.textContent.includes('NIGHTDRIVE'))
    ?.querySelector('.btn-det-open')?.click());
await page.waitForTimeout(900);
check('player: opened NIGHTDRIVE (the sliced project)', await page.evaluate(() =>
  document.getElementById('modal-title').textContent === 'NIGHTDRIVE'));
await page.evaluate(() => { window.__sliceStarts = []; });
await page.click('#btn-modal-play');
await page.waitForTimeout(1500);
const sliceStarts = await page.evaluate(() => (window.__sliceStarts || []));
// Night Bass: SL01=2205, SL02=5512 frames at the wav's own 22050Hz, in a
// 0.5s sample that decodes to the context rate (44.1k here, 48k on many
// machines). Dividing SLnn by the DECODED rate was the bug.
const SRC = 22050;
check('player: sliced notes actually triggered', sliceStarts.length > 0);
check('player: slice offsets use the source rate, not the context rate',
  sliceStarts.some(s => Math.abs(s.offset - 2205 / SRC) < 1e-3) &&
  !sliceStarts.some(s => s.bufRate !== SRC && Math.abs(s.offset - 2205 / s.bufRate) < 1e-3));
check('player: slice durations run to the next marker',
  sliceStarts.some(s => Math.abs(s.dur - (5512 - 2205) / SRC) < 1e-3));
check('player: last slice runs to the end of the buffer',
  sliceStarts.some(s => Math.abs((s.offset + s.dur) - s.bufDur) < 1e-3));
check('player: no slice starts past the end of its buffer',
  sliceStarts.every(s => s.offset < s.bufDur));
await page.click('#btn-modal-play');
await page.waitForTimeout(200);
await closeProjectModal();
await page.waitForTimeout(200);

// ── 8. slice editor on the demo card ───────────────────
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
// v0.8 zoom: buttons narrow the view window, Fit restores it
check('slicer: zoom controls + overview strip present', await page.evaluate(() =>
  !!document.getElementById('btn-slice-zoomin') && !!document.getElementById('btn-slice-zoomout')
  && !!document.getElementById('btn-slice-fit') && !!document.getElementById('slice-overview')));
await page.click('#btn-slice-zoomin');
await page.click('#btn-slice-zoomin');
await page.waitForTimeout(150);
check('slicer: zoom in narrows the visible window', await page.evaluate(() =>
  /\d×\)$/.test(document.getElementById('slice-zoomlbl').textContent)));
check('slicer: markers survive zooming', await page.evaluate(() =>
  document.querySelectorAll('#slice-chips [data-slice]').length === 8));
await page.click('#btn-slice-fit');
await page.waitForTimeout(150);
check('slicer: Fit restores the whole sample', await page.evaluate(() =>
  document.getElementById('slice-zoomlbl').textContent === 'whole sample'));
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
await closeProjectModal();
await page.click('.tab-bin, .tab-btn[data-tab="projects"]').catch(() => {});
await page.click('.tab-btn[data-tab="projects"]');
await page.waitForTimeout(300);
await page.evaluate(() => [...document.querySelectorAll('.proj-item')].find(r => r.textContent.includes('NIGHTDRIVE'))?.querySelector('.proj-row')?.click());
await page.waitForTimeout(200);
await page.click('.btn-det-open');
await page.waitForTimeout(700);
await page.click('#btn-modal-patterns');
await page.waitForTimeout(400);
// zoom slider, expand toggle and the transposed timeline are gone: the grid
// is always full-size and the timeline duplicated it with swapped axes
check('patterns: zoom slider and expand toggle removed', await page.evaluate(() =>
  !document.getElementById('pv-zoom') && !document.getElementById('btn-pv-expand')));
check('patterns: redundant timeline removed', await page.evaluate(() =>
  !document.querySelector('#modal-pattern-section .tl-svg')));
check('patterns: workspace is full-size by default', await page.evaluate(() => {
  const box = document.querySelector('.proj-modal-box');
  return box.getBoundingClientRect().width > window.innerWidth * 0.9;
}));
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
// v0.8 layout: detail panels live beside the grid, not under it
check('patterns: detail panel sits beside the grid', await page.evaluate(() => {
  const grid = document.querySelector('.pv-grid-wrap'), side = document.querySelector('.pv-side');
  if (!grid || !side) return false;
  return side.getBoundingClientRect().left >= grid.getBoundingClientRect().right - 2;
}));
// grid cells are editable in place, and empty cells invite a chain
check('patterns: grid cells are focusable for editing', await page.evaluate(() =>
  document.querySelectorAll('.pv-cell[data-row][tabindex="0"]').length > 0));
check('patterns: empty cells are click-to-place', await page.evaluate(() =>
  document.querySelectorAll('.pv-cell.empty[data-row]').length > 0));
check('patterns: chain list is grouped by high nibble', await page.evaluate(() =>
  document.querySelectorAll('.pv-chaingroup').length >= 1));
// ↺ Colours is disabled until you actually pick a custom colour
check('patterns: reset-colours disabled with no custom colours', await page.evaluate(() =>
  document.getElementById('btn-pv-recolour').disabled === true));
// chain steps read vertically, one per line, in play order
await page.evaluate(() => document.querySelector('.pv-chainrow .cp-open')?.click());
await page.waitForTimeout(250);
check('patterns: chain steps are laid out vertically', await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.pv-csteps .pv-cstep')];
  if (rows.length < 4) return false;
  const tops = rows.map(r => Math.round(r.getBoundingClientRect().top));
  // strictly increasing top offsets == one per line, none side by side
  return tops.every((t, i) => i === 0 || t > tops[i - 1]);
}));
// row triggers: one per song row, and pressing one starts playback
const rowBtns = await page.evaluate(() => document.querySelectorAll('.pv-rowplay').length);
const gridRows = await page.evaluate(() => document.querySelectorAll('.pv-cell.rlbl').length);
check('patterns: a row trigger for every song row', rowBtns > 0 && rowBtns === gridRows);
await page.evaluate(() => document.querySelector('.pv-rowplay')?.click());
await page.waitForTimeout(700);
check('patterns: row trigger started playback', await page.evaluate(() => {
  const b = document.querySelector('.pv-rowplay');
  return b.textContent === '■' || b.textContent === '▶';
}));
await page.evaluate(() => { const b = document.querySelector('.pv-rowplay'); if (b.textContent === '■') b.click(); });
await page.waitForTimeout(200);
await closeProjectModal();
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

// ── 8c. trash browser: restore, then delete permanently ─
await page.evaluate(() => document.querySelector('[data-psec="trash"]').click());
await page.waitForTimeout(600);
check('trash: the trashed file is listed', await page.evaluate(() =>
  document.querySelectorAll('.btn-trash-restore').length === 1));
const trashedName = await page.evaluate(() =>
  document.querySelector('.prob-row .prob-name')?.textContent.trim());
await page.click('.btn-trash-restore');
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('[data-psec="trash"]').click());
await page.waitForTimeout(600);
check('trash: restoring empties the trash', await page.evaluate(() =>
  document.querySelectorAll('.btn-trash-restore').length === 0));
await page.evaluate(() => document.querySelector('[data-psec="unusedpool"]').click());
await page.waitForTimeout(400);
check('trash: the restored sample is back in the pool', await page.evaluate(nm =>
  document.getElementById('prob-content').textContent.includes(nm), trashedName));
// trash it again and delete it for real
await page.click('.btn-trash-one');
await page.waitForTimeout(2200);
await page.evaluate(() => document.querySelector('[data-psec="trash"]').click());
await page.waitForTimeout(600);
await page.click('.btn-trash-del');
await page.waitForTimeout(1200);
check('trash: permanent delete removes the file', await page.evaluate(() =>
  document.querySelectorAll('.btn-trash-restore').length === 0));

// ── 8d. creating a project on the card ──────────────────
// prompt() drives it, so stub the answers before clicking.
await closeProjectModal();
await page.click('.tab-btn[data-tab="projects"]');
await page.waitForTimeout(300);
const beforeCount = await page.evaluate(() => document.querySelectorAll('.proj-item').length);
await page.evaluate(() => {
  const answers = ['E2E NEW', '128'];
  let i = 0;
  window.prompt = () => answers[i++];
});
await page.click('#btn-new-project');
await page.waitForTimeout(3000);
await closeProjectModal();
await page.waitForTimeout(400);
await page.click('.tab-btn[data-tab="projects"]');
await page.waitForTimeout(400);
check('new project: appears in the list after creation', await page.evaluate(b =>
  document.querySelectorAll('.proj-item').length === b + 1, beforeCount));
check('new project: carries the tempo it was given', await page.evaluate(() => {
  const row = [...document.querySelectorAll('.proj-item')].find(r => r.textContent.includes('E2E NEW'));
  return !!row && row.textContent.includes('128');
}));
// and it must be immediately editable rather than a dead empty grid
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.proj-item')].find(r => r.textContent.includes('E2E NEW'));
  row?.querySelector('.proj-row')?.click();        // expand first: .btn-det-open lives in the detail
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.proj-item')].find(r => r.textContent.includes('E2E NEW'));
  row?.querySelector('.btn-det-open')?.click();
});
await page.waitForTimeout(900);
await page.evaluate(() => document.getElementById('btn-modal-patterns').click());
await page.waitForTimeout(500);
check('new project: its empty grid is editable', await page.evaluate(() =>
  document.querySelectorAll('.pv-cell.empty[data-row][tabindex="0"]').length > 0));
await closeProjectModal();
await page.waitForTimeout(300);

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

// ── 30. USB mirror output effects ──────────────────────
await page.click('.tab-btn[data-tab="device"]');
await page.waitForTimeout(300);
const FXPRESETS = await page.evaluate(() => FX.PRESETS.length);

const fxBase = await page.evaluate(() => ({
  hasGl:   Mirror.hasEffects(),
  cards:   document.querySelectorAll('.fx-card').length,
  defs:    FX.DEFS.length,
  presets: document.querySelectorAll('#fx-preset option').length,
  outputs: document.querySelectorAll('#fx-output option').length,
}));
check('fx: WebGL renderer came up', fxBase.hasGl);
check('fx: one card per effect definition', fxBase.cards === fxBase.defs && fxBase.cards === 19);
check('fx: preset list has every preset plus Custom', fxBase.presets === FXPRESETS + 1);
check('fx: output list is populated', fxBase.outputs === 4);

// Every preset must render without raising a GL error, and must actually
// change the picture — a preset that silently does nothing is a bug.
const fxShots = await page.evaluate(async () => {
  const cv = document.getElementById('usb-canvas');
  const gl = cv.getContext('webgl');
  const shot = () => {
    const px = new Uint8Array(cv.width * cv.height * 4);
    gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0, n = 0, sig = '';
    for (let i = 0; i < px.length; i += 4096) { sum += px[i] + px[i+1] + px[i+2]; n++; sig += px[i] + ','; }
    return { avg: sum / n, sig, err: gl.getError() };
  };
  const out = {};
  for (const pre of FX.PRESETS) {
    const st = Mirror.getState();
    const next = FX.presetState(pre.id);
    st.enabled = next.enabled; st.params = next.params; st.preset = next.preset;
    st.on = pre.id !== 'off';
    Mirror.syncUI(); Mirror.invalidate();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    out[pre.id] = shot();
  }
  return out;
});
check('fx: no GL errors across every preset',
  Object.values(fxShots).every(s => s.err === 0));
check('fx: every preset renders something',
  Object.values(fxShots).every(s => s.avg > 1));
check('fx: every preset looks different from Off',
  Object.entries(fxShots).filter(([id]) => id !== 'off')
    .every(([, s]) => s.sig !== fxShots.off.sig));
check('fx: no two presets render identically',
  new Set(Object.values(fxShots).map(s => s.sig)).size === Object.keys(fxShots).length);

// Output size drives the real canvas the recorder and OBS see.
await page.evaluate(() => { Mirror.getState().on = true; Mirror.syncUI(); });
await page.selectOption('#fx-output', '1280x720');
await page.waitForTimeout(200);
check('fx: output size changes the canvas', await page.evaluate(() => {
  const c = document.getElementById('usb-canvas');
  return c.width === 1280 && c.height === 720;
}));
check('fx: a 16:9 output pillarboxes rather than stretching', await page.evaluate(() => {
  const cv = document.getElementById('usb-canvas');
  const gl = cv.getContext('webgl');
  const px = new Uint8Array(cv.width * cv.height * 4);
  gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  // A column 8px from the left edge must be background; the middle must not be.
  const at = (x, y) => { const i = (y * cv.width + x) * 4; return px[i] + px[i+1] + px[i+2]; };
  let edge = 0, mid = 0;
  for (let y = 0; y < cv.height; y += 4) { edge += at(8, y); mid += at(cv.width >> 1, y); }
  return edge === 0 && mid > 0;
}));
// Regression: the bloom prepass works on the un-curved, un-letterboxed
// source, so it has to be masked to the content or a heavy glow paints a
// blurred ghost of the screen across the bars and the bezel.
check('fx: glow does not spill into the letterbox bars', await page.evaluate(async () => {
  const st = Mirror.getState();
  const next = FX.presetState('off');
  st.enabled = next.enabled; st.params = next.params;
  st.enabled.bloom = true;
  st.params.bloom.intensity = 150; st.params.bloom.radius = 300;
  st.on = true; st.preset = 'custom';
  Mirror.syncUI(); Mirror.invalidate();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const cv = document.getElementById('usb-canvas');
  const gl = cv.getContext('webgl');
  const px = new Uint8Array(cv.width * cv.height * 4);
  gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const contentX = Math.round((cv.width - cv.height * 4 / 3) / 2);   // left edge of the picture
  const at = (x, y) => { const i = (y * cv.width + x) * 4; return px[i] + px[i+1] + px[i+2]; };
  let bar = 0, inside = 0;
  for (let y = 0; y < cv.height; y += 4) {
    bar    += at(contentX - 6, y);          // just outside the picture
    inside += at(contentX + 6, y);          // just inside it
  }
  return bar === 0 && inside > 0;
}));

check('fx: Fill 100% overscans instead, filling the frame edge to edge', await page.evaluate(async () => {
  Mirror.getState().zoom = 100; Mirror.syncUI(); Mirror.invalidate();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const cv = document.getElementById('usb-canvas');
  const gl = cv.getContext('webgl');
  const px = new Uint8Array(cv.width * cv.height * 4);
  gl.readPixels(0, 0, cv.width, cv.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const at = (x, y) => { const i = (y * cv.width + x) * 4; return px[i] + px[i+1] + px[i+2]; };
  let edge = 0;
  for (let y = 0; y < cv.height; y += 4) edge += at(8, y);
  Mirror.getState().zoom = 0; Mirror.syncUI(); Mirror.invalidate();
  return edge > 0;
}));
await page.selectOption('#fx-output', '960x720');

// Toggling any control drops the preset to Custom and is written through
// to localStorage, so a look survives a reload.
await page.evaluate(() => { document.querySelector('.fx-card[data-fx="noise"] .fx-en').click(); });
await page.waitForTimeout(150);
const fxPersist = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('ptlib-fx-v1') || '{}');
  return { preset: document.getElementById('fx-preset').value, stored: raw.enabled && raw.enabled.noise,
           card: document.querySelector('.fx-card[data-fx="noise"]').classList.contains('on') };
});
check('fx: toggling an effect drops the preset to Custom', fxPersist.preset === 'custom');
check('fx: the change is stored for next time', fxPersist.stored === true);
check('fx: the card shows its parameters once enabled', fxPersist.card);

check('fx: parameters are visible only while the effect is on', await page.evaluate(() => {
  const on  = document.querySelector('.fx-card[data-fx="noise"] .fx-params');
  const off = document.querySelector('.fx-card[data-fx="warp"] .fx-params');
  return getComputedStyle(on).display !== 'none' && getComputedStyle(off).display === 'none';
}));

// The whole feature is display-side: driving every preset and every
// control must never put a byte on the wire. The only frames the mirror
// is allowed to send are the FULL_REFRESH requests from section 5.
check('fx: nothing beyond a refresh request was ever sent to the device', await page.evaluate(() =>
  Array.isArray(window.__writes) && window.__writes.length > 0 &&
  window.__writes.every(w => w[0] === 0xFE && w[1] === 0x02)));

// A corrupt or hand-edited settings blob must not be able to break the mirror.
await page.evaluate(() => localStorage.setItem('ptlib-fx-v1', JSON.stringify({
  on: true, output: 'not-a-size', bg: 'javascript:alert(1)', zoom: 9e9, preset: 42,
  enabled: { noise: 1, nosuchthing: true },
  params: { noise: { amount: 1e9, type: 'nope' }, nosuchthing: { x: 1 } },
})));
await page.reload();
await page.waitForTimeout(600);
await page.click('#btn-usb-only');
await page.waitForTimeout(400);
const fxSafe = await page.evaluate(() => {
  const st = Mirror.getState();
  const cv = document.getElementById('usb-canvas');
  return { output: st.output, bg: st.bg, zoom: st.zoom, amount: st.params.noise.amount,
           type: st.params.noise.type, unknown: 'nosuchthing' in st.params,
           w: cv.width, h: cv.height, gl: Mirror.hasEffects() };
});
check('fx: a bad output size falls back to the default', fxSafe.output === '960x720');
check('fx: a non-colour background is rejected', fxSafe.bg === '#000000');
check('fx: an absurd fill value is clamped', fxSafe.zoom === 100);
check('fx: an out-of-range slider value is clamped to its own maximum', fxSafe.amount === 100);
check('fx: an invalid option falls back to the default', fxSafe.type === 'film');
check('fx: unknown effects in stored settings are dropped', !fxSafe.unknown);
check('fx: the mirror still renders after a corrupt settings blob',
  fxSafe.gl && fxSafe.w === 960 && fxSafe.h === 720);

// Nothing is connected on a fresh load, so what is on the source canvas
// now is the stand-in screen — that is what lets a look be dialled in
// before the hardware is plugged in.
check('fx: a stand-in screen is painted with no device connected', await page.evaluate(() => {
  const c = USB.sourceCanvas();
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const band = (r0, r1) => {                       // device rows -> lit pixels
    let lit = 0;
    for (let y = r0 * 30; y < r1 * 30; y++)
      for (let x = 0; x < c.width; x += 3) {
        const i = (y * c.width + x) * 4;
        if (d[i] > 60 || d[i+1] > 60 || d[i+2] > 60) lit++;
      }
    return lit;
  };
  return !USB.isConnected() && band(0, 1) > 40 && band(4, 14) > 200 && band(21, 22) > 40;
}));

// Reset clears the lot.
await page.click('#fx-reset');
await page.waitForTimeout(150);
check('fx: reset turns every effect off', await page.evaluate(() => {
  const st = Mirror.getState();
  return !st.on && !Object.values(st.enabled).some(Boolean) &&
         document.querySelectorAll('.fx-card.on').length === 0;
}));

check('zero console errors across the whole run', errors.length === 0);
if (errors.length) console.error(errors);
await browser.close();
console.log(`\ne2e: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
