// Unit tests for the PT picoTracker XML parser.
// Run: node tests/parser.test.mjs
import { PT } from './extract.mjs';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error(`✕ ${name}\n   ${e.message}`); }
}
function eq(a, b, msg) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`${msg ?? 'eq'}: ${ja} !== ${jb}`);
}
function ok(v, msg) { if (!v) throw new Error(msg ?? 'expected truthy'); }

// ── Fixture builders (shapes match PersistencyService output) ──
function hexOf(bytes) { return bytes.map(b => b.toString(16).toUpperCase().padStart(2,'0')).join(''); }
function dataChunks(bytes) {
  // emit like the firmware: 64-byte chunks, run-length when uniform
  let out = '';
  for (let i = 0; i < bytes.length; i += 64) {
    const chunk = bytes.slice(i, i+64);
    const uniform = chunk.every(v => v === chunk[0]);
    out += uniform
      ? `<DATA VALUE="${chunk[0]}" LENGTH="${chunk.length}"/>`
      : `<DATA>${hexOf(chunk)}</DATA>`;
  }
  return out;
}
function u16le(vals) {
  const out = [];
  for (const v of vals) { out.push(v & 0xFF, (v >> 8) & 0xFF); }
  return out;
}

function buildProjectXml(opts = {}) {
  const grid = new Array(128*8).fill(0xFF);
  grid[0] = 0x00;              // row 0 ch 0 → chain 00
  grid[8] = 0x01;              // row 1 ch 0 → chain 01
  grid[1] = 0x02;              // row 0 ch 1 → chain 02
  const chains = new Array(255*16).fill(0xFF);
  chains[0] = 0x00;            // chain 00 step 0 → phrase 00
  chains[1] = 0x01;            // chain 00 step 1 → phrase 01
  chains[16] = 0x02;           // chain 01 step 0 → phrase 02
  chains[32] = 0x00;           // chain 02 step 0 → phrase 00
  const transposes = new Array(255*16).fill(0);
  transposes[1] = 0xFD;        // -3 on chain 00 step 1
  const notes = new Array(128*16).fill(0xFF);
  notes[0] = 60;               // phrase 00 step 0: C3
  notes[1] = 0xFE;             // OFF
  notes[16] = 48;              // phrase 01 step 0
  notes[33] = 72;              // phrase 02 step 1
  const instr = new Array(128*16).fill(0xFF);
  instr[0] = 0x00; instr[16] = 0x00; instr[33] = 0x10;
  const cmd1 = new Array(128*16).fill(0x2D);
  cmd1[2] = 0x1E;              // KIL on phrase 00 step 2
  const par1 = new Array(128*16).fill(0);
  par1[2] = 0x1234;
  const cmd2 = new Array(128*16).fill(0x2D);
  const par2 = new Array(128*16).fill(0);
  return `<PICOTRACKER>
    <PROJECT VERSION="${opts.version ?? '2.3-Beta3'}">
        <PARAMETER NAME="tempo" VALUE="${opts.tempo ?? 138}"/>
        <PARAMETER NAME="master" VALUE="60"/>
        <PARAMETER NAME="channel1vol" VALUE="99"/>
        <PARAMETER NAME="wrap" VALUE="false"/>
        <PARAMETER NAME="transpose" VALUE="${opts.transpose ?? 0}"/>
        <PARAMETER NAME="scale" VALUE="None (Chromatic)"/>
        <PARAMETER NAME="scaleroot" VALUE="C "/>
        <PARAMETER NAME="preview" VALUE="60"/>
    </PROJECT>
    <SONG>
        <SONG>${dataChunks(grid)}</SONG>
        <CHAINS>${dataChunks(chains)}</CHAINS>
        <TRANSPOSES>${dataChunks(transposes)}</TRANSPOSES>
        <NOTES>${dataChunks(notes)}</NOTES>
        <INSTRUMENTS>${dataChunks(instr)}</INSTRUMENTS>
        <COMMAND1>${dataChunks(cmd1)}</COMMAND1>
        <PARAM1>${dataChunks(u16le(par1))}</PARAM1>
        <COMMAND2>${dataChunks(cmd2)}</COMMAND2>
        <PARAM2>${dataChunks(u16le(par2))}</PARAM2>
    </SONG>
    <INSTRUMENTBANK>
        <INSTRUMENT ID="00" VERSION="2.3-Beta3" TYPE="SAMPLE">
            <PARAM NAME="InstrumentName" VALUE="Kick &amp; Co"/>
            <PARAM NAME="sample" VALUE="kick.wav"/>
            <PARAM NAME="volume" VALUE="128"/>
            <PARAM NAME="loopmode" VALUE="none"/>
            <PARAM NAME="table" VALUE="-1"/>
            <PARAM NAME="SL00" VALUE="0"/>
            <PARAM NAME="SL03" VALUE="4410"/>
        </INSTRUMENT>
        <INSTRUMENT ID="10" VERSION="2.3-Beta3" TYPE="MIDI">
            <PARAM NAME="channel" VALUE="4"/>
            <PARAM NAME="program" VALUE="-1"/>
        </INSTRUMENT>
    </INSTRUMENTBANK>
    <TABLES>
        <TABLE ID="00">
            <CMD1><DATA VALUE="45" LENGTH="16"/></CMD1>
            <PARAM1><DATA VALUE="0" LENGTH="32"/></PARAM1>
        </TABLE>
        <TABLE ID="01"/>
    </TABLES>
    <GROOVES>${dataChunks((() => {
      const g = new Array(512).fill(0xFF);
      g[0] = 6; g[1] = 6;         // groove 0 default
      g[16] = 7; g[17] = 5;       // groove 1 swing
      return g;
    })())}</GROOVES>
    <MIXER/>
</PICOTRACKER>`;
}

// ── XML parser basics ──────────────────────────────────
t('parses attributes and entities', () => {
  const el = PT.parseXml('<A X="1 &amp; 2"><B/>text</A>');
  eq(el.attrs.X, '1 & 2');
  eq(el.children.length, 1);
  eq(el.text, 'text');
});
t('rejects mismatched tags', () => {
  let threw = false;
  try { PT.parseXml('<A><B></A></B>'); } catch { threw = true; }
  ok(threw, 'should throw');
});
t('skips XML declaration and comments', () => {
  const el = PT.parseXml('<?xml version="1.0"?><!-- hi --><R><X V="1"/></R>');
  eq(el.name, 'R');
  eq(el.children[0].attrs.V, '1');
});

// ── Hex buffers ────────────────────────────────────────
t('decodes mixed run-length + hex chunks in order', () => {
  const el = PT.parseXml('<B><DATA VALUE="255" LENGTH="4"/><DATA>00FF10</DATA><DATA VALUE="0" LENGTH="2"/></B>');
  const u8 = PT.decodeHexBuffer(el);
  eq([...u8], [255,255,255,255,0,255,16,0,0]);
});
t('u16le pairs little-endian', () => {
  const u16 = PT.u16leFrom(new Uint8Array([0x34,0x12,0xFF,0x00]));
  eq([...u16], [0x1234, 0x00FF]);
});

// ── Project parse ──────────────────────────────────────
const proj = PT.parseProject(buildProjectXml());
t('project parses', () => ok(proj, 'null'));
t('project header fields', () => {
  eq(proj.version, '2.3-Beta3');
  eq(proj.tempo, 138);
  eq(proj.scale, 'None (Chromatic)');
  eq(proj.scaleRoot, 'C');
});
t('negative project transpose decodes (0xFF → -1 style)', () => {
  const p2 = PT.parseProject(buildProjectXml({transpose: 200}));
  eq(p2.transpose, 200 - 256);
});
t('song grid geometry', () => {
  eq(PT.gridCell(proj, 0, 0), 0x00);
  eq(PT.gridCell(proj, 1, 0), 0x01);
  eq(PT.gridCell(proj, 0, 1), 0x02);
  eq(PT.gridCell(proj, 2, 0), 0xFF);
  eq(PT.lastSongRow(proj), 1);
});
t('chain steps and signed transpose', () => {
  eq(PT.chainStep(proj, 0, 0).phrase, 0x00);
  eq(PT.chainStep(proj, 0, 1).phrase, 0x01);
  eq(PT.chainStep(proj, 0, 1).transpose, -3);
});
t('phrase data + u16 params', () => {
  const st = PT.phraseStep(proj, 0, 0);
  eq(st.note, 60); eq(st.instr, 0);
  const st2 = PT.phraseStep(proj, 0, 2);
  eq(st2.cmd1, 0x1E); eq(st2.param1, 0x1234);
});
t('used sets', () => {
  eq([...PT.usedChains(proj)].sort(), [0,1,2]);
  eq([...PT.usedPhrases(proj)].sort(), [0,1,2]);
  eq([...PT.usedInstrumentIds(proj)].sort((a,b)=>a-b), [0x00, 0x10]);
});
t('instruments parse with entities, slices, sparse slots', () => {
  eq(proj.instruments.length, 2);
  const k = proj.instruments[0];
  eq(k.name, 'Kick & Co');
  eq(k.sample, 'kick.wav');
  eq(k.type, 'SAMPLE');
  eq(k.slices, [{index:3, offset:4410}], 'zero slices omitted');
  eq(proj.instruments[1].type, 'MIDI');
  eq(proj.instruments[1].idHex, '10');
});
t('tables: empty self-closed + populated', () => {
  eq(proj.tables.length, 2);
  ok(proj.tables[0].empty, 'table 00 all --- should be empty');
  ok(proj.tables[1].empty, 'self-closed table empty');
});
t('grooves: 0xFF terminates', () => {
  eq(proj.grooves[0], [6,6]);
  eq(proj.grooves[1], [7,5]);
  eq(proj.grooves[2], []);
});

// ── Display helpers ────────────────────────────────────
t('note names (C3=60, octave = v/12-2)', () => {
  eq(PT.noteStr(60), 'C-3');
  eq(PT.noteStr(0), 'C--2');
  eq(PT.noteStr(61), 'C#3');
  eq(PT.noteStr(0xFF), '---');
  eq(PT.noteStr(0xFE), 'OFF');
});
t('command names from frozen FourCC bytes', () => {
  eq(PT.cmdName(0x1E), 'KIL');
  eq(PT.cmdName(0x2D), '---');
  eq(PT.cmdName(0x3E), 'TPO');
  eq(PT.cmdName(0x99), '99?');
});

// ── .pti / .ptt / .config.xml ──────────────────────────
t('pti parses', () => {
  const i = PT.parsePti('<INSTRUMENT VERSION="2.3" TYPE="SAMPLE"><PARAM NAME="InstrumentName" VALUE="Lead"/><PARAM NAME="sample" VALUE="lead.wav"/></INSTRUMENT>');
  eq(i.name, 'Lead'); eq(i.sample, 'lead.wav'); eq(i.type, 'SAMPLE');
});
t('pti unknown future type tolerated', () => {
  const i = PT.parsePti('<INSTRUMENT TYPE="WAVETABLE"><PARAM NAME="x" VALUE="1"/></INSTRUMENT>');
  eq(i.type, 'UNK'); eq(i.rawType, 'WAVETABLE');
});
t('theme parses unpadded hex colors', () => {
  const th = PT.parseTheme('<THEME><Font value="1"/><Color name="BACKGROUND" value="#0"/><Color name="ACCENTCOLOR" value="#F08400"/></THEME>');
  eq(th.font, 1);
  eq(th.colors.BACKGROUND, 0);
  eq(th.colors.ACCENTCOLOR, 0xF08400);
  eq(PT.colorHex(th.colors.ACCENTCOLOR), '#f08400');
});
t('theme bare hex color (firmware parses hex-first, even without #)', () => {
  // Config.cpp tries sscanf %x before the decimal fallback, so "255" is 0x255
  const th = PT.parseTheme('<THEME><Color name="FOREGROUND" value="255"/></THEME>');
  eq(th.colors.FOREGROUND, 0x255);
});
t('config parses (CHAR_LIST as index)', () => {
  const c = PT.parseConfig('<CONFIG VERSION="1"><LINEOUT VALUE="2"/><THEMENAME VALUE="Default"/><Color name="BACKGROUND" value="#0"/></CONFIG>');
  eq(c.values.LINEOUT, '2');
  eq(c.values.THEMENAME, 'Default');
  eq(c.colors.BACKGROUND, 0);
});

// ── Sample ref rewrite (repair path) ───────────────────
t('rewriteSampleRef changes only the target instrument', () => {
  const xml = buildProjectXml();
  const res = PT.rewriteSampleRef(xml, '00', 'kick.wav', 'kick2.wav');
  ok(res.ok, res.error);
  const p2 = PT.parseProject(res.text);
  eq(p2.instruments[0].sample, 'kick2.wav');
  eq(p2.instruments[1].type, 'MIDI', 'other instruments untouched');
  // byte-for-byte outside the changed attr
  eq(res.text.length, xml.length + 1);
});
t('rewriteSampleRef errors are safe', () => {
  const xml = buildProjectXml();
  ok(!PT.rewriteSampleRef(xml, 'ZZ', 'kick.wav', 'x.wav').ok);
  ok(!PT.rewriteSampleRef(xml, '00', 'nope.wav', 'x.wav').ok);
});
t('rewriteSampleRef escapes entities', () => {
  const xml = buildProjectXml().replace('VALUE="kick.wav"', 'VALUE="a &amp; b.wav"');
  const res = PT.rewriteSampleRef(xml, '00', 'a & b.wav', 'c & d.wav');
  ok(res.ok, res.error);
  const p2 = PT.parseProject(res.text);
  eq(p2.instruments[0].sample, 'c & d.wav');
});

// ── MIDI export ────────────────────────────────────────
function readSmf(u8) {
  // independent minimal SMF reader for verification
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = o => String.fromCharCode(u8[o],u8[o+1],u8[o+2],u8[o+3]);
  if (tag(0) !== 'MThd') throw new Error('no MThd');
  const ntrks = dv.getUint16(10), div = dv.getUint16(12);
  let off = 8 + dv.getUint32(4);
  const tracks = [];
  for (let t = 0; t < ntrks; t++) {
    if (tag(off) !== 'MTrk') throw new Error('no MTrk at '+off);
    const len = dv.getUint32(off+4);
    let p = off + 8, end = p + len, tick = 0, run = 0;
    const evs = [];
    while (p < end) {
      let d = 0, b;
      do { b = u8[p++]; d = (d << 7) | (b & 0x7F); } while (b & 0x80);
      tick += d;
      let st = u8[p];
      if (st & 0x80) { p++; run = st; } else st = run;
      if (st === 0xFF) { const ty = u8[p++]; let l = 0; do { b = u8[p++]; l = (l<<7)|(b&0x7F); } while (b & 0x80); p += l; evs.push({tick, meta:ty}); }
      else if ((st & 0xF0) === 0x90 || (st & 0xF0) === 0x80) { evs.push({tick, st: st & 0xF0, note: u8[p], vel: u8[p+1]}); p += 2; }
      else if ((st & 0xF0) === 0xC0 || (st & 0xF0) === 0xD0) p += 1;
      else p += 2;
    }
    tracks.push(evs);
    off = end;
  }
  return { ntrks, div, tracks };
}
t('MIDI export round-trips through an independent reader', () => {
  const bytes = PT.buildMidi(proj, 'TEST');
  ok(bytes, 'null midi');
  const smf = readSmf(bytes);
  eq(smf.div, 24);
  ok(smf.ntrks >= 2, 'meta + at least one track');
  const notes = smf.tracks.flat().filter(e => e.st === 0x90 && e.vel > 0);
  ok(notes.length >= 2, 'expected note-ons, got ' + notes.length);
  // phrase 01 note 48 played through chain 00 step 1 with transpose -3 → 45
  ok(notes.some(e => e.note === 45), 'chain transpose applied');
  ok(notes.some(e => e.note === 60), 'C3 present');
});
t('MIDI export returns null for empty grid', () => {
  const empty = PT.parseProject(buildProjectXml().replace(/<SONG><DATA[^]*?<\/SONG>\n?/, '<SONG><DATA VALUE="255" LENGTH="64"/></SONG>'));
  // grid all empty → null (either via missing rows or no events)
  const out = PT.buildMidi(empty, 'X');
  ok(out === null, 'expected null');
});

// ── Scale detection ────────────────────────────────────
t('scale detection returns ranked candidates', () => {
  const r = PT.detectScales(proj);
  ok(r.total >= 3, 'notes counted');
  ok(r.candidates.length > 0);
  ok(r.candidates[0].score >= r.candidates[r.candidates.length-1].score);
});


// ── Advance (2.x/3.x closed-firmware) format variants ──
// Synthetic fixtures modelled on real ptsav.dat observations:
// 256-row grid, 255 phrases, nested <DATA> wrapper around groove chunks,
// SAMPLESOURCE instrument type, hex-prefixed theme Font value.
function buildAdvanceXml() {
  const grid = new Array(256*8).fill(0xFF); grid[0] = 0x00;
  const chains = new Array(255*16).fill(0xFF); chains[0] = 0x80; // phrase 128 (> pico max)
  const notes = new Array(255*16).fill(0xFF); notes[128*16] = 60;
  const instr = new Array(255*16).fill(0xFF); instr[128*16] = 0;
  const cmd = new Array(255*16).fill(0x2D);
  const par = new Array(255*16).fill(0);
  const grooveBytes = (() => { const g = new Array(512).fill(0xFF); g[0]=6; g[1]=6; return g; })();
  return `<PICOTRACKER>
    <PROJECT VERSION="3.1.0">
        <PARAMETER NAME="tempo" VALUE="140"/>
        <PARAMETER NAME="channel1fx1send" VALUE="0"/>
        <PARAMETER NAME="fx1type" VALUE="reverb"/>
    </PROJECT>
    <SONG>
        <SONG>${dataChunks(grid)}</SONG>
        <CHAINS>${dataChunks(chains)}</CHAINS>
        <TRANSPOSES>${dataChunks(new Array(255*16).fill(0))}</TRANSPOSES>
        <NOTES>${dataChunks(notes)}</NOTES>
        <INSTRUMENTS>${dataChunks(instr)}</INSTRUMENTS>
        <COMMAND1>${dataChunks(cmd)}</COMMAND1>
        <PARAM1>${dataChunks(u16le(par))}</PARAM1>
        <COMMAND2>${dataChunks(cmd)}</COMMAND2>
        <PARAM2>${dataChunks(u16le(par))}</PARAM2>
    </SONG>
    <INSTRUMENTBANK>
        <INSTRUMENT ID="00" VERSION="3.1.0" TYPE="SAMPLESOURCE">
            <PARAM NAME="sample" VALUE="pad.wav"/>
            <PARAM NAME="level" VALUE="100"/>
            <PARAM NAME="voice filter cut" VALUE="255"/>
            <PARAM NAME="lfo1 target" VALUE="none"/>
            <PARAM NAME="SL01" VALUE="4410"/>
            <PARAM NAME="SL31" VALUE="99999"/>
        </INSTRUMENT>
    </INSTRUMENTBANK>
    <TABLES><TABLE ID="00"/></TABLES>
    <GROOVES>
        <DATA>${dataChunks(grooveBytes)}</DATA>
    </GROOVES>
    <MIXER/>
</PICOTRACKER>`;
}
const adv = PT.parseProject(buildAdvanceXml());
t('advance: geometry inferred (256 rows, 255 phrases, 1-byte cmds)', () => {
  eq(adv.geometry, {songRows:256, channels:8, phraseCount:255, cmdWidth:1});
});
t('advance: phrase index above pico max resolves', () => {
  eq(PT.chainStep(adv, 0, 0).phrase, 0x80);
  eq(PT.phraseStep(adv, 0x80, 0).note, 60);
  eq([...PT.usedPhrases(adv)], [0x80]);
});
t('advance: nested DATA wrapper grooves decode', () => {
  eq(adv.grooves[0], [6,6]);
  eq(adv.grooves.length, 32);
});
t('advance: SAMPLESOURCE type + 31-slice range', () => {
  const i = adv.instruments[0];
  eq(i.type, 'SAMPLESOURCE');
  eq(i.typeShort, 'SRC');
  eq(i.sample, 'pad.wav');
  eq(i.slices, [{index:1, offset:4410},{index:31, offset:99999}]);
});
t('advance: 2-byte command buffers decode with warning', () => {
  const wideCmd = [];
  for (let k = 0; k < 255*16; k++) { wideCmd.push(k===0 ? 0x2E : 0x2D, 0x2D); }
  const xml = buildAdvanceXml()
    .replace(/<COMMAND1>[^]*?<\/COMMAND1>/, `<COMMAND1>${dataChunks(wideCmd)}</COMMAND1>`)
    .replace(/<COMMAND2>[^]*?<\/COMMAND2>/, `<COMMAND2>${dataChunks(wideCmd)}</COMMAND2>`);
  const p = PT.parseProject(xml);
  eq(p.geometry.cmdWidth, 2);
  eq(p.phrases.cmd1[0], 0x2E, 'high 0x2D pad stripped');
  eq(p.phrases.cmd1[1], 0x2D);
  ok(p.warnings.some(w => w.includes('2-byte')), 'warning expected');
});
t('advance: theme Font value with # prefix', () => {
  const th = PT.parseTheme('<THEME><Font value="#1"/><Color name="BACKGROUND" value="#100000"/></THEME>');
  eq(th.font, 1);
  eq(th.colors.BACKGROUND, 0x100000);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
