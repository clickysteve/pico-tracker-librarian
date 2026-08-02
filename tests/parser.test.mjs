// Unit tests for the PT picoTracker XML parser.
// Run: node tests/parser.test.mjs
import { PT, FX, AudioReact } from './extract.mjs';

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
function buildTableXml() {
  const run = (v, n) => `<DATA VALUE="${v}" LENGTH="${n}"/>`;
  const tbl = id => `<TABLE ID="${id}">` +
    `<CMD1>${run(45, 16)}</CMD1><PARAM1>${run(0, 32)}</PARAM1>` +
    `<CMD2>${run(45, 16)}</CMD2><PARAM2>${run(0, 32)}</PARAM2>` +
    `<CMD3>${run(45, 16)}</CMD3><PARAM3>${run(0, 32)}</PARAM3></TABLE>`;
  // the base fixture already carries a <TABLES> block (with a self-closing
  // TABLE 01), so swap the whole section for two fully-populated tables
  const src = buildProjectXml();
  const a = src.indexOf('<TABLES>'), b = src.indexOf('</TABLES>') + '</TABLES>'.length;
  if (a < 0 || b < a) throw new Error('fixture TABLES block not found');
  return src.slice(0, a) + `<TABLES>${tbl('00')}${tbl('01')}</TABLES>` + src.slice(b);
}

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
      else if ((st & 0xF0) === 0x90 || (st & 0xF0) === 0x80) { evs.push({tick, st: st & 0xF0, ch: st & 0x0F, note: u8[p], vel: u8[p+1]}); p += 2; }
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


// ── MIDI: GRV + HOP semantics ──────────────────────────
function buildTimingXml() {
  // chain 00: phrase 00 then phrase 01.
  // phrase 00: note C3 at step 0, GRV 01 at step 4 (switch to groove 1),
  //            HOP to step 2 at step 8 (skips rest of phrase 00,
  //            enters phrase 01 at step 2).
  const grid = new Array(128*8).fill(0xFF); grid[0] = 0x00;
  const chains = new Array(255*16).fill(0xFF); chains[0] = 0x00; chains[1] = 0x01;
  const notes = new Array(128*16).fill(0xFF);
  notes[0] = 60;        // phrase 0 step 0
  notes[16+2] = 62;     // phrase 1 step 2 (hop target)
  notes[16+3] = 64;     // phrase 1 step 3
  const instr = new Array(128*16).fill(0xFF); instr[0]=0; instr[18]=0; instr[19]=0;
  const cmd1 = new Array(128*16).fill(0x2D);
  const par1 = new Array(128*16).fill(0);
  cmd1[4] = 0x1A; par1[4] = 1;    // GRV 01
  cmd1[8] = 0x1B; par1[8] = 2;    // HOP -> step 2 of next phrase
  const cmd2 = new Array(128*16).fill(0x2D);
  const par2 = new Array(128*16).fill(0);
  const grooves = (() => {
    const g = new Array(512).fill(0xFF);
    g[0]=6; g[1]=6;      // groove 0: straight 6
    g[16]=4; g[17]=8;    // groove 1: 4/8 swing
    return g;
  })();
  return `<PICOTRACKER><PROJECT VERSION="2.3"><PARAMETER NAME="tempo" VALUE="120"/></PROJECT>
<SONG><SONG>${dataChunks(grid)}</SONG><CHAINS>${dataChunks(chains)}</CHAINS>
<TRANSPOSES>${dataChunks(new Array(255*16).fill(0))}</TRANSPOSES>
<NOTES>${dataChunks(notes)}</NOTES><INSTRUMENTS>${dataChunks(instr)}</INSTRUMENTS>
<COMMAND1>${dataChunks(cmd1)}</COMMAND1><PARAM1>${dataChunks(u16le(par1))}</PARAM1>
<COMMAND2>${dataChunks(cmd2)}</COMMAND2><PARAM2>${dataChunks(u16le(par2))}</PARAM2></SONG>
<INSTRUMENTBANK/><TABLES/><GROOVES>${dataChunks(grooves)}</GROOVES><MIXER/></PICOTRACKER>`;
}
t('MIDI: GRV switches groove timing, HOP skips into next phrase', () => {
  const p = PT.parseProject(buildTimingXml());
  const bytes = PT.buildMidi(p, 'T');
  ok(bytes, 'midi null');
  const smf = readSmf(bytes);
  const ons = smf.tracks.flat().filter(e => e.st === 0x90 && e.vel > 0);
  // Expected ticks: steps 0-3 at groove0 (6 each) = 24; GRV at step 4
  // switches to groove1 (4,8,...): steps 4..7 take 4+8+4+8 = 24; HOP at
  // step 8 (tick 48) jumps to phrase 1 step 2 — notes at phrase1 steps
  // 2 and 3: first at tick 48, next at 48 + groove1[pos] where pos
  // continued (4) -> 52.
  eq(ons.map(e => [e.note, e.tick]), [[60, 0], [62, 48], [64, 52]]);
});


// ── Theme writing ──────────────────────────────────────
t('buildPtt round-trips through parseTheme', () => {
  const th = { font: 1, colors: { BACKGROUND: 0, ACCENTCOLOR: 0x79B5E3, FOREGROUND: 0xEEF1F2 } };
  const back = PT.parseTheme(PT.buildPtt(th));
  eq(back.font, 1);
  eq(back.colors.BACKGROUND, 0);
  eq(back.colors.ACCENTCOLOR, 0x79B5E3);
  ok(PT.buildPtt(th).includes('value="#0"'), 'firmware-style unpadded hex');
});
t('rewriteConfigTheme updates in place and appends missing', () => {
  const cfg = '<CONFIG VERSION="1">\n    <LINEOUT VALUE="2"/>\n    <THEMENAME VALUE="Old"/>\n    <Color name="BACKGROUND" value="#0"/>\n</CONFIG>';
  const out = PT.rewriteConfigTheme(cfg, 'Galazio', { font: 2, colors: { BACKGROUND: 0x101010, ACCENTCOLOR: 0x79B5E3 } });
  const parsed = PT.parseConfig(out);
  eq(parsed.values.THEMENAME, 'Galazio');
  eq(parsed.values.UIFONT, '2');
  eq(parsed.values.LINEOUT, '2', 'untouched values preserved');
  eq(parsed.colors.BACKGROUND, 0x101010);
  eq(parsed.colors.ACCENTCOLOR, 0x79B5E3, 'missing colour appended');
});
t('defaultConfigXml builds a valid config from nothing', () => {
  const parsed = PT.parseConfig(PT.defaultConfigXml('Fresh', { font: 0, colors: { BACKGROUND: 1 } }));
  eq(parsed.values.THEMENAME, 'Fresh');
  eq(parsed.colors.BACKGROUND, 1);
});


// ── Editor plumbing: encode + section rewrite round-trips ──
t('encodeHexBuffer/decodeHexBuffer round-trip incl run-length', () => {
  const src = new Uint8Array(200);
  src.fill(0xFF, 0, 64);              // uniform chunk → run-length form
  for (let i = 64; i < 200; i++) src[i] = (i * 37) & 0xFF;
  const el = PT.parseXml(`<B>${PT.encodeHexBuffer(src)}</B>`);
  const back = PT.decodeHexBuffer(el, 200);
  eq([...back], [...src]);
});
t('noteFromStr parses display names', () => {
  eq(PT.noteFromStr('C-3'), 60);
  eq(PT.noteFromStr('C3'), 60);
  eq(PT.noteFromStr('C#3'), 61);
  eq(PT.noteFromStr('B7'), 119);
  eq(PT.noteFromStr('---'), 0xFF);
  eq(PT.noteFromStr('OFF'), 0xFE);
  eq(PT.noteFromStr('H2'), null);
});
t('rewriteSongSections: unchanged data is byte-equivalent on re-parse', () => {
  const xml = buildProjectXml();
  const p = PT.parseProject(xml);
  const res = PT.rewriteSongSections(xml, p);
  ok(res.ok, res.error);
  const p2 = PT.parseProject(res.text);
  eq([...p2.phrases.notes], [...p.phrases.notes]);
  eq([...p2.phrases.cmd1], [...p.phrases.cmd1]);
  eq([...p2.phrases.param1], [...p.phrases.param1]);
  eq(p2.instruments.length, p.instruments.length, 'instrument bank untouched');
  eq([...p2.grid], [...p.grid], 'grid untouched');
  eq(p2.tables.length, p.tables.length, 'tables untouched');
});
t('rewriteSongSections: an edit lands and only that edit', () => {
  const xml = buildProjectXml();
  const p = PT.parseProject(xml);
  p.phrases.notes[5] = 72;
  p.phrases.cmd1[5] = 0x45; p.phrases.param1[5] = 0x1234;
  const res = PT.rewriteSongSections(xml, p);
  ok(res.ok, res.error);
  const p2 = PT.parseProject(res.text);
  eq(p2.phrases.notes[5], 72);
  eq(p2.phrases.cmd1[5], 0x45);
  eq(p2.phrases.param1[5], 0x1234);
  eq(p2.phrases.notes[0], 60, 'neighbours untouched');
});
t('rewriteSongSections refuses legacy 2-byte command files', () => {
  const p = { geometry: { cmdWidth: 2 }, phrases: {} };
  ok(!PT.rewriteSongSections('<X/>', p).ok);
});

// ── Event timeline ─────────────────────────────────────
t('buildEventTimeline matches MIDI timing incl GRV/HOP', () => {
  const p = PT.parseProject(buildTimingXml());
  const tl = PT.buildEventTimeline(p);
  ok(tl, 'null timeline');
  const ons = tl.events.filter(e => e.type === 'on');
  // 120 BPM → tick = 60/(120*24) s; expected ticks 0, 48, 52 (from MIDI test)
  const tick = 60 / (120 * 24);
  eq(ons.map(e => [e.note, Math.round(e.time / tick)]), [[60, 0], [62, 48], [64, 52]]);
  ok(tl.duration > ons[2].time, 'duration covers events');
});

// ── Real Advance files (if present): rewrite must round-trip ──
import { readFileSync, existsSync } from 'node:fs';
const REAL = '/mnt/user-data/uploads/pico-tracker-advance/source-examples/projects';
if (existsSync(REAL)) {
  for (const name of ['FIRST', 'THREE', 'oneCycAc']) {
    t(`real card ${name}: section rewrite round-trips losslessly`, () => {
      const xml = readFileSync(`${REAL}/${name}/ptsav.dat`, 'utf8');
      const p = PT.parseProject(xml);
      const res = PT.rewriteSongSections(xml, p);
      ok(res.ok, res.error);
      const p2 = PT.parseProject(res.text);
      eq([...p2.phrases.notes], [...p.phrases.notes]);
      eq([...p2.phrases.cmd1], [...p.phrases.cmd1]);
      eq([...p2.phrases.param2], [...p.phrases.param2]);
      eq(p2.instruments.map(i => i.name), p.instruments.map(i => i.name));
      eq(p2.grooves.length, p.grooves.length);
    });
  }
  t('real card SECOND: slice rewrite round-trips', () => {
    const xml = readFileSync(`${REAL}/SECOND/ptsav.dat`, 'utf8');
    const p = PT.parseProject(xml);
    const inst = p.instruments.find(i => i.slices.length);
    ok(inst, 'no sliced instrument found');
    const res = PT.rewriteInstrumentSlices(xml, inst.idHex, inst.slices);
    ok(res.ok, res.error);
    const p2 = PT.parseProject(res.text);
    const ni = p2.instruments.find(i => i.idHex === inst.idHex);
    eq(ni.slices, inst.slices);
    eq(p2.instruments.length, p.instruments.length);
    eq([...p2.phrases.notes], [...p.phrases.notes], 'song data untouched');
  });
}


// ── Slice editing ──────────────────────────────────────
t('rewriteInstrumentSlices replaces the SLnn set surgically', () => {
  const xml = buildProjectXml();   // instrument 00 has SL00(dropped)+SL03
  const res = PT.rewriteInstrumentSlices(xml, '00', [
    { index: 1, offset: 1000 }, { index: 2, offset: 2500.7 }, { index: 3, offset: 0 }]);
  ok(res.ok, res.error);
  const p = PT.parseProject(res.text);
  eq(p.instruments[0].slices, [{index:1, offset:1000}, {index:2, offset:2501}], 'zero-offset dropped, rounded');
  eq(p.instruments[0].sample, 'kick.wav', 'other params untouched');
  eq(p.instruments[1].type, 'MIDI', 'other instruments untouched');
});
t('rewriteInstrumentSlices can clear all slices', () => {
  const res = PT.rewriteInstrumentSlices(buildProjectXml(), '00', []);
  ok(res.ok, res.error);
  eq(PT.parseProject(res.text).instruments[0].slices, []);
});
t('rewriteInstrumentSlices errors on unknown instrument', () => {
  ok(!PT.rewriteInstrumentSlices(buildProjectXml(), 'ZZ', []).ok);
});
t('detectOnsets finds drum hits in a synthetic break', () => {
  const sr = 22050, beat = Math.round(sr * 0.4);
  const data = new Float64Array(beat * 4);
  for (const start of [0, beat, beat * 2, beat * 3])
    for (let i = 0; i < 800; i++)
      data[start + i] = Math.sin(i * 0.5) * Math.exp(-i / 150);
  const on = PT.detectOnsets(data, sr, 16, 1.0);
  // first hit is the implicit slice 0; expect ~3 detected onsets near beats 2-4
  ok(on.length >= 2 && on.length <= 4, 'got ' + on.length);
  for (const o of on) {
    const nearBeat = [beat, beat*2, beat*3].some(b => Math.abs(o - b) < sr * 0.06);
    ok(nearBeat, `onset ${o} not near a beat`);
  }
});
t('snapZeroCross lands on a sign change', () => {
  const data = new Float64Array(4000);
  for (let i = 0; i < 4000; i++) data[i] = Math.sin(i / 50);
  const o = PT.snapZeroCross(data, 100);
  ok(Math.sign(data[o - 1] || 1) !== Math.sign(data[o] || 1) || data[o] === 0, 'not a crossing');
});

// ── Regression tests for the v0.4.2 review-pass fixes ──
t('regression: transpose 0x80 decodes as -128', () => {
  eq(PT.parseProject(buildProjectXml({transpose: 128})).transpose, -128);
});
t('regression: sharps in negative octaves round-trip', () => {
  for (let v = 0; v <= 119; v++) eq(PT.noteFromStr(PT.noteStr(v)), v, 'note ' + v);
});
t('regression: $-sequences in names cannot inject', () => {
  const xml = buildProjectXml().replace('VALUE="kick.wav"', 'VALUE="bass$1.wav"');
  const res = PT.rewriteSampleRef(xml, '00', 'bass$1.wav', 'x$&y.wav');
  ok(res.ok, res.error);
  eq(PT.parseProject(res.text).instruments[0].sample, 'x$&y.wav');
  const cfg = PT.rewriteConfigTheme('<CONFIG VERSION="1">\n</CONFIG>', 'my$&theme', {font:0, colors:{BACKGROUND:1}});
  const parsed = PT.parseConfig(cfg);
  eq(parsed.values.THEMENAME, 'my$&theme');
  eq(parsed.colors.BACKGROUND, 1);
});
t('regression: apostrophes in sample names (&apos; form) repairable', () => {
  const xml = buildProjectXml().replace('VALUE="kick.wav"', 'VALUE="don&apos;t.wav"');
  const res = PT.rewriteSampleRef(xml, '00', "don't.wav", 'fixed.wav');
  ok(res.ok, res.error);
  eq(PT.parseProject(res.text).instruments[0].sample, 'fixed.wav');
});
t('regression: rewriteSongSections cannot touch TABLES PARAM sections', () => {
  // craft a file whose SONG lacks PARAM2 but whose TABLES has one
  let xml = buildProjectXml();
  const p2open = xml.indexOf('<PARAM2>'), p2close = xml.indexOf('</PARAM2>') + '</PARAM2>'.length;
  xml = xml.slice(0, p2open) + xml.slice(p2close);   // remove SONG's PARAM2
  xml = xml.replace('<TABLE ID="01"/>',
    '<TABLE ID="01"><PARAM2><DATA VALUE="7" LENGTH="32"/></PARAM2></TABLE>');
  const p = PT.parseProject(xml);
  const res = PT.rewriteSongSections(xml, p);
  ok(!res.ok, 'must refuse rather than corrupt the table');
  ok(res.error.includes('PARAM2'), res.error);
});
t('regression: attribute-form SLnn stripped on slice rewrite', () => {
  const xml = buildProjectXml().replace('<INSTRUMENT ID="00" VERSION="2.3-Beta3" TYPE="SAMPLE">',
    '<INSTRUMENT ID="00" VERSION="2.3-Beta3" TYPE="SAMPLE" SL05="777">');
  const res = PT.rewriteInstrumentSlices(xml, '00', [{index: 1, offset: 9000}]);
  ok(res.ok, res.error);
  eq(PT.parseProject(res.text).instruments[0].slices, [{index:1, offset:9000}]);
});
t('regression: buildMidi survives a fully dense song', () => {
  const grid = new Array(128*8).fill(0x00);       // every cell -> chain 0
  const chains = new Array(255*16).fill(0x00);    // every step -> phrase 0
  const notes = new Array(128*16).fill(60);       // every step a note
  const instr = new Array(128*16).fill(0);
  const zeros = new Array(128*16).fill(0);
  const none = new Array(128*16).fill(0x2D);
  const xml = `<PICOTRACKER><PROJECT VERSION="2.3"><PARAMETER NAME="tempo" VALUE="200"/></PROJECT>
<SONG><SONG>${dataChunks(grid)}</SONG><CHAINS>${dataChunks(chains)}</CHAINS>
<TRANSPOSES>${dataChunks(new Array(255*16).fill(0))}</TRANSPOSES>
<NOTES>${dataChunks(notes)}</NOTES><INSTRUMENTS>${dataChunks(instr)}</INSTRUMENTS>
<COMMAND1>${dataChunks(none)}</COMMAND1><PARAM1>${dataChunks(u16le(zeros))}</PARAM1>
<COMMAND2>${dataChunks(none)}</COMMAND2><PARAM2>${dataChunks(u16le(zeros))}</PARAM2></SONG>
<INSTRUMENTBANK/><TABLES/><GROOVES>${dataChunks(new Array(512).fill(255))}</GROOVES><MIXER/></PICOTRACKER>`;
  const p = PT.parseProject(xml);
  const bytes = PT.buildMidi(p, 'DENSE');   // 128 rows x 16 chain steps x 16 phrase steps x 8ch
  ok(bytes && bytes.length > 100000, 'expected a large valid file, got ' + (bytes ? bytes.length : null));
  const smf = readSmf(bytes);
  ok(smf.ntrks === 9, 'tracks: ' + smf.ntrks);
});


t('rewriteInstrumentParams edits only existing params of the target', () => {
  const xml = buildProjectXml();
  const res = PT.rewriteInstrumentParams(xml, '00', { volume: '90', loopmode: 'loop', nonexistent: '5' });
  ok(res.ok, res.error);
  eq(res.applied.sort(), ['loopmode', 'volume']);
  const p = PT.parseProject(res.text);
  eq(p.instruments[0].params.volume, '90');
  eq(p.instruments[0].params.loopmode, 'loop');
  eq(p.instruments[0].params.table, '-1', 'untouched param preserved');
  eq(p.instruments[1].type, 'MIDI', 'other instruments untouched');
});
t('rewriteInstrumentParams escapes values safely', () => {
  const res = PT.rewriteInstrumentParams(buildProjectXml(), '00', { volume: '1 & "2" <3> $&' });
  ok(res.ok, res.error);
  eq(PT.parseProject(res.text).instruments[0].params.volume, '1 & "2" <3> $&');
});

// ── v0.7: single-phrase audition timeline ──────────────
t('buildEventTimeline phrase mode plays only that phrase', () => {
  const p = PT.parseProject(buildProjectXml());
  // phrase 00 has C3 at step 0, OFF at step 1, KIL at step 2
  const tl = PT.buildEventTimeline(p, { phrase: 0x00 });
  ok(tl, 'expected a timeline');
  const ons = tl.events.filter(e => e.type === 'on');
  eq(ons.length, 1, 'one note on');
  eq(ons[0].note, 60);
  eq(ons[0].ch, 0, 'previewed on channel 0');
  eq(ons[0].transpose, 0, 'no chain transpose applied in phrase mode');
  // phrase 02 has a note at step 1 only
  const tl2 = PT.buildEventTimeline(p, { phrase: 0x02 });
  const ons2 = tl2.events.filter(e => e.type === 'on');
  eq(ons2.length, 1);
  eq(ons2[0].note, 72);
});
t('buildEventTimeline phrase mode ignores the song grid entirely', () => {
  const p = PT.parseProject(buildProjectXml());
  // an empty phrase yields a timeline with no note-ons, not the whole song
  const tl = PT.buildEventTimeline(p, { phrase: 0x7F });
  ok(tl, 'expected a timeline even for an empty phrase');
  eq(tl.events.filter(e => e.type === 'on').length, 0);
});
t('buildEventTimeline still builds the full song when no opts given', () => {
  const p = PT.parseProject(buildProjectXml());
  const full = PT.buildEventTimeline(p);
  const solo = PT.buildEventTimeline(p, { phrase: 0x00 });
  ok(full.events.filter(e => e.type === 'on').length >
     solo.events.filter(e => e.type === 'on').length, 'song has more notes than one phrase');
  ok(full.events.some(e => e.ch > 0), 'song spans multiple channels');
});
t('buildEventTimeline chain mode unaffected by the phrase-mode change', () => {
  const p = PT.parseProject(buildProjectXml());
  const tl = PT.buildEventTimeline(p, { chain: 0x00 });
  const ons = tl.events.filter(e => e.type === 'on');
  // chain 00: phrase 00 (C3) then phrase 01 (note 48, transpose -3)
  eq(ons.length, 2);
  eq(ons[0].note, 60);
  eq(ons[1].note, 48);
  eq(ons[1].transpose, -3, 'chain transpose still applied');
});

// ── v0.7: OS junk-file filter (pure fn lifted out of Scanner) ──
t('isJunkName hides macOS AppleDouble and dot files, keeps real content', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const m = /function isJunkName\(name\) \{[\s\S]*?\n  \}/.exec(html);
  ok(m, 'isJunkName not found in index.html');
  const isJunkName = new Function(`${m[0]}; return isJunkName;`)();
  // the exact thing Steve saw on his card
  ok(isJunkName('._fatbrass.wav'), '._fatbrass.wav should be hidden');
  ok(isJunkName('._guitar1.wav'), '._guitar1.wav should be hidden');
  ok(isJunkName('.DS_Store'));
  ok(isJunkName('.Spotlight-V100'));
  ok(isJunkName('.Trashes'));
  ok(isJunkName('Thumbs.db'));
  ok(isJunkName('thumbs.db'), 'case-insensitive');
  // real card content must survive
  ok(!isJunkName('fatbrass.wav'));
  ok(!isJunkName('ptsav.dat'));
  ok(!isJunkName('lgptsav.dat'));
  ok(!isJunkName('BREAKS-90'));
  ok(!isJunkName('my.theme.ptt'), 'dots elsewhere in the name are fine');
});

// ── v0.7: setlist export folder numbering ──────────────
t('setlistFolderName numbers folders so the device sorts them in play order', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const m = /function setlistFolderName\(dirName, idx\) \{[\s\S]*?\n  \}/.exec(html);
  ok(m, 'setlistFolderName not found in index.html');
  const fn = new Function(`${m[0]}; return setlistFolderName;`)();
  eq(fn('OPENER', 0), '01_OPENER');
  eq(fn('CLOSER', 9), '10_CLOSER');
  eq(fn('ENCORE', 98), '99_ENCORE');
  // the whole point: alphabetical order === setlist order
  const set = ['ZED', 'ALPHA', 'MID'];
  const named = set.map(fn);
  eq([...named].sort(), named, 'numbered names sort into setlist order');
});

// ── play-from-row (startRow), firmware semantics ───────
t('buildEventTimeline startRow plays every channel from that row', () => {
  const p = PT.parseProject(buildProjectXml());
  const tl = PT.buildEventTimeline(p, { startRow: 0 });
  ok(tl, 'expected a timeline');
  const ons = tl.events.filter(e => e.type === 'on');
  const chans = new Set(ons.map(e => e.ch));
  ok(chans.has(0) && chans.has(1), 'both populated channels sound, got ' + [...chans]);
  ok(!ons.some(e => e.ch > 1), 'silent channels contribute nothing');
});
t('buildEventTimeline startRow 1: a channel empty there stays silent', () => {
  const p = PT.parseProject(buildProjectXml());
  // row 1: only ch0 has a chain; ch1 is empty at row 1, and per the
  // firmware a channel does not search forward from an empty start.
  const tl = PT.buildEventTimeline(p, { startRow: 1 });
  const chans = new Set(tl.events.filter(e => e.type === 'on').map(e => e.ch));
  ok(chans.has(0) && !chans.has(1), [...chans].join(','));
});
t('buildEventTimeline startRow out of range returns null', () => {
  const p = PT.parseProject(buildProjectXml());
  eq(PT.buildEventTimeline(p, { startRow: 99 }), null);
});

// ── per-channel group looping, verified against Player.cpp ──
function loopFixtureProj() {
  // ch0: rows 0-2 then a gap then rows 4-5; ch1: rows 0-5 straight.
  const geom = { songRows: 16, channels: 8, phraseCount: 128, cmdWidth: 1 };
  const grid = new Array(16 * 8).fill(PT.EMPTY);
  for (const r of [0, 1, 2, 4, 5]) grid[r * 8 + 0] = 0;
  for (const r of [0, 1, 2, 3, 4, 5]) grid[r * 8 + 1] = 1;
  const chains = new Array(255 * 16).fill(PT.EMPTY);
  chains[0] = 0; chains[16] = 1;
  const P = 128 * 16;
  const notes = new Array(P).fill(PT.EMPTY); notes[0] = 60; notes[16] = 64;
  const instr = new Array(P).fill(PT.EMPTY); instr[0] = 0; instr[16] = 0;
  const none = () => new Array(P).fill(0x2D), zero = () => new Array(P).fill(0);
  return { tempo: 120, transpose: 0, geometry: geom, grid, chains,
    transposes: new Array(255 * 16).fill(0),
    phrases: { notes, instr, cmd1: none(), param1: zero(), cmd2: none(), param2: zero() },
    grooves: [[6, 6]], grooveRaw: null, instruments: [{ id: 0 }] };
}
t('loop: a channel loops its group at a gap instead of stopping or skipping', () => {
  const tl = PT.buildEventTimeline(loopFixtureProj(), {});
  const ch0rows = [...new Set(tl.marks.filter(m => m.ch === 0).map(m => m.row))].sort((a, b) => a - b);
  eq(ch0rows, [0, 1, 2], 'the group before the gap loops; rows past the gap never play from the top');
  const ch0 = tl.events.filter(e => e.type === 'on' && e.ch === 0).length;
  const ch1 = tl.events.filter(e => e.type === 'on' && e.ch === 1).length;
  eq(ch1, 6, 'the straight channel plays its six rows once');
  eq(ch0, 6, 'the looping channel fills the same time with two passes of three');
});
t('loop: content below a gap is reachable by starting playback there', () => {
  const tl = PT.buildEventTimeline(loopFixtureProj(), { startRow: 4 });
  const ch0rows = [...new Set(tl.marks.filter(m => m.ch === 0).map(m => m.row))].sort((a, b) => a - b);
  eq(ch0rows, [4, 5]);
});
t('loop: starting mid-group loops back to the top of the group, not the start row', () => {
  const tl = PT.buildEventTimeline(loopFixtureProj(), { startRow: 1 });
  // ch0's group is rows 0-2; after row 2 the firmware scans up past the
  // start row to the blank above row 0, so row 0 plays on the second pass.
  const ch0rows = [...new Set(tl.marks.filter(m => m.ch === 0).map(m => m.row))].sort((a, b) => a - b);
  ok(ch0rows.includes(0), 'rows visited: ' + ch0rows.join(','));
});
t('loop: a chain ends at its first empty step', () => {
  const proj = loopFixtureProj();
  // chain 2: phrase at step 0, EMPTY at step 1, phrase again at step 2.
  proj.chains[2 * 16 + 0] = 0;
  proj.chains[2 * 16 + 2] = 1;
  proj.grid.fill(PT.EMPTY);
  proj.grid[0 * 8 + 0] = 2;
  const tl = PT.buildEventTimeline(proj, {});
  const steps = [...new Set(tl.marks.filter(m => m.ch === 0).map(m => m.step))];
  eq(steps, [0], 'step 2 must never play — the empty step 1 ends the chain');
});
t('loop: the walk terminates on a pathological all-loop grid', () => {
  const proj = loopFixtureProj();
  const tl = PT.buildEventTimeline(proj, {});
  ok(isFinite(tl.duration) && tl.duration > 0 && tl.events.length < 100000);
});
t('buildEventTimeline songRow does not disturb chain or phrase modes', () => {
  const p = PT.parseProject(buildProjectXml());
  eq(PT.buildEventTimeline(p, { chain: 0x00 }).events.filter(e => e.type === 'on').length, 2);
  eq(PT.buildEventTimeline(p, { phrase: 0x00 }).events.filter(e => e.type === 'on').length, 1);
});

// ── v0.9.15: islands, multi-pass emission, pingpong buffers ──
function islandFixtureProj() {
  // rows 0-1 blank · island A rows 2-3 · blank · island B row 5 (chain FE)
  const proj = loopFixtureProj();
  proj.grid.fill(PT.EMPTY);
  proj.grid[2 * 8 + 0] = 0;
  proj.grid[3 * 8 + 0] = 1;
  proj.grid[5 * 8 + 0] = 0xFE;
  proj.chains[0xFE * 16 + 0] = 1;     // chain FE is the LAST valid chain
  return proj;
}
t('island: mainIsland finds the longest contiguous block', () => {
  const isl = PT.mainIsland(islandFixtureProj());
  eq({ start: isl.start, end: isl.end }, { start: 2, end: 3 });
});
t('island: a fully blank grid has no island', () => {
  const proj = loopFixtureProj();
  proj.grid.fill(PT.EMPTY);
  eq(PT.mainIsland(proj), null);
});
t('island: an unbroken song is one island from row 0', () => {
  const isl = PT.mainIsland(loopFixtureProj());
  eq({ start: isl.start, end: isl.end }, { start: 0, end: 5 });
});
t('island: the default preview starts at the longest island, not row 00', () => {
  const tl = PT.buildEventTimeline(islandFixtureProj(), {});
  ok(tl, 'blank leading rows must not kill the preview');
  const rows = [...new Set(tl.marks.map(m => m.row))].sort((a, b) => a - b);
  eq(rows, [2, 3], 'the preview plays island A and nothing else');
});
t('island: an explicit startRow still wins (device cursor semantics)', () => {
  const tl = PT.buildEventTimeline(islandFixtureProj(), { startRow: 5 });
  const rows = [...new Set(tl.marks.map(m => m.row))];
  eq(rows, [5], 'row play loops between the blank rows around it');
});
t('island: chain FE (the last valid chain) is playable', () => {
  const tl = PT.buildEventTimeline(islandFixtureProj(), { startRow: 5 });
  ok(tl && tl.events.some(e => e.type === 'on'), 'chain 0xFE must resolve, 0xFF is empty');
});
t('passes: a 3-pass emission is the one-pass stream repeated', () => {
  const proj = islandFixtureProj();
  const one = PT.buildEventTimeline(proj, {});
  const three = PT.buildEventTimeline(proj, { passes: 3 });
  eq(three.duration, one.duration, 'duration stays a single pass');
  ok(Math.abs(three.span - one.duration * 3) < 1e-9, 'span covers all passes');
  const ons = tl => tl.events.filter(e => e.type === 'on');
  eq(ons(three).length, ons(one).length * 3);
  // pass 2 is pass 1 shifted by exactly one duration
  const a = ons(one), b = ons(three).slice(a.length, a.length * 2);
  for (let i = 0; i < a.length; i++) {
    ok(Math.abs(b[i].time - (a[i].time + one.duration)) < 1e-6, `event ${i} misaligned`);
    eq(b[i].note, a[i].note);
  }
});
t('pingpong: the composite mirrors the loop interior without doubling endpoints', () => {
  const actx = { createBuffer: (ch, len, rate) => {
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: rate,
             duration: len / rate, getChannelData: c => data[c] };
  } };
  const src = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const buf = { numberOfChannels: 1, length: 10, sampleRate: 10,
                duration: 1, getChannelData: () => src };
  const pp = PT.pingpongBuffer(actx, buf, 3 / 10, 8 / 10);
  ok(pp, 'a 5-frame region must build');
  eq([...pp.buf.getChannelData(0)], [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4]);
  ok(Math.abs(pp.loopStart - 0.3) < 1e-9 && Math.abs(pp.loopEnd - 1.1) < 1e-9,
     `loop points ${pp.loopStart}..${pp.loopEnd}`);
});
t('pingpong: a too-short region falls back (returns null)', () => {
  const actx = { createBuffer: () => { throw new Error('must not build'); } };
  const src = Float32Array.from([0, 1, 2, 3]);
  const buf = { numberOfChannels: 1, length: 4, sampleRate: 10, duration: .4, getChannelData: () => src };
  eq(PT.pingpongBuffer(actx, buf, 0.1, 0.2), null);
});
t('pingpong: loop end past the buffer is clamped', () => {
  const actx = { createBuffer: (ch, len, rate) => {
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: rate,
             duration: len / rate, getChannelData: c => data[c] };
  } };
  const src = Float32Array.from([0, 1, 2, 3, 4]);
  const buf = { numberOfChannels: 1, length: 5, sampleRate: 10, duration: .5, getChannelData: () => src };
  const pp = PT.pingpongBuffer(actx, buf, 0, 2);   // asks past the end
  ok(pp && pp.buf.length === 5 + 3, 'mirror of the clamped region');
  eq([...pp.buf.getChannelData(0)], [0, 1, 2, 3, 4, 3, 2, 1]);
});
t('passes: eventsOnly skips marks but emits identical events', () => {
  const proj = islandFixtureProj();
  const a = PT.buildEventTimeline(proj, { passes: 2 });
  const b = PT.buildEventTimeline(proj, { passes: 2, eventsOnly: true });
  eq(b.marks.length, 0, 'no marks in a scheduling walk');
  eq(b.events.length, a.events.length);
  eq(b.duration, a.duration);
});
t('midi: the export walks the main island, matching the preview', () => {
  const proj = islandFixtureProj();
  const bytes = PT.buildMidi(proj, 'ISLANDS');
  ok(bytes && bytes.length > 30, 'an island song must export');
});

// ── v1.0.1: MIDI instruments and MIDI stems ────────────
function midiFixtureProj() {
  const proj = loopFixtureProj();
  proj.grid.fill(PT.EMPTY);
  proj.grid[0 * 8 + 0] = 0;   // ch0 → chain 0 → phrase 0 (note 60, instr 0: MIDI)
  proj.grid[0 * 8 + 1] = 1;   // ch1 → chain 1 → phrase 1 (note 64, instr 1: SAMPLE)
  proj.phrases.instr[16] = 1;
  proj.instruments = [
    { id: 0, type: 'MIDI', params: { channel: '5', 'note length': '4' } },
    { id: 1, type: 'SAMPLE', params: {} },
  ];
  return proj;
}
t('midi: a MIDI instrument exports on ITS channel, fw velocity, note length', () => {
  const smf = readSmf(PT.buildMidi(midiFixtureProj(), 'M'));
  const evs = smf.tracks.flat();
  const on5 = evs.find(e => e.st === 0x90 && e.ch === 5);
  ok(on5, 'MIDI instrument note-on lands on its configured channel 5');
  eq(on5.vel, 0x7F, 'firmware initial velocity');
  const off5 = evs.find(e => e.st === 0x80 && e.ch === 5);
  ok(off5 && off5.tick - on5.tick === 4,
     `note length 4 device ticks (got ${off5 ? off5.tick - on5.tick : 'no off'})`);
  const onSmp = evs.find(e => e.st === 0x90 && e.ch === 1);
  ok(onSmp && onSmp.vel === 100, 'sample instrument stays on its track channel at vel 100');
});
t('midi: a step without an instrument keeps the channel\'s last one', () => {
  const proj = midiFixtureProj();
  // phrase 0: second note at step 4 with NO instrument — still the MIDI one
  proj.phrases.notes[4] = 62;
  const evs = readSmf(PT.buildMidi(proj, 'M')).tracks.flat();
  const ons5 = evs.filter(e => e.st === 0x90 && e.ch === 5);
  eq(ons5.length, 2, 'both notes ride the MIDI instrument channel');
});
t('midi stems: one type-1 file per playing channel, same division', () => {
  const files = PT.buildMidiStems(midiFixtureProj(), 'M');
  ok(files && files.length === 2, `expected 2 stems, got ${files && files.length}`);
  eq(files.map(f => f.name), ['ch1.mid', 'ch2.mid']);
  for (const f of files) {
    const smf = readSmf(f.bytes);
    eq(smf.ntrks, 2, 'tempo track + the channel track');
    eq(smf.div, 24);
  }
  const a = readSmf(files[0].bytes).tracks.flat().filter(e => e.st === 0x90);
  const b = readSmf(files[1].bytes).tracks.flat().filter(e => e.st === 0x90);
  ok(a.length && a.every(e => e.ch === 5), 'stem 1 carries only the MIDI-channel notes');
  ok(b.length && b.every(e => e.ch === 1), 'stem 2 carries only the sample-track notes');
});
t('midi stems: null for an empty grid', () => {
  const proj = loopFixtureProj();
  proj.grid.fill(PT.EMPTY);
  eq(PT.buildMidiStems(proj, 'X'), null);
});

// ── v0.8: chain colours grouped by high nibble ─────────
t('groupChainColor gives each nibble group its own hue family', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const hues = /const CHAIN_HUES = \[[\s\S]*?\];/.exec(html);
  const gc = /function groupChainColor\(c\) \{[\s\S]*?\n  \}/.exec(html);
  const hh = /function hslHex\(h, s, l\) \{[\s\S]*?\n  \}/.exec(html);
  ok(hues && gc && hh, 'colour helpers not found in index.html');
  const fn = new Function(`${hues[0]}\n${hh[0]}\n${gc[0]}; return groupChainColor;`)();
  const hex = /^#[0-9a-f]{6}$/;
  for (const c of [0x00, 0x0F, 0x10, 0x3A, 0x7F, 0xFE]) ok(hex.test(fn(c)), `bad hex for ${c}: ${fn(c)}`);
  // Hue is what makes a group read as a family. (Raw RGB distance can't be
  // the test: a dark red sits nearer a dark orange than a light red does.)
  const hueOf = h => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return 0;
    const q = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (q * 60 + 360) % 360;
  };
  const dHue = (a, b) => { const x = Math.abs(hueOf(a) - hueOf(b)); return Math.min(x, 360 - x); };
  for (let g = 0; g < 16; g++) {
    const base = fn(g << 4);
    for (let s = 1; s < 16; s++)
      ok(dHue(base, fn((g << 4) | s)) < 3, `chain ${((g<<4)|s).toString(16)} left its group's hue`);
  }
  for (let g = 0; g < 16; g++)
    for (let g2 = g + 1; g2 < 16; g2++)
      ok(dHue(fn(g << 4), fn(g2 << 4)) > 8, `groups ${g} and ${g2} share a hue`);
  // neighbours inside a group still differ (no two chains share a swatch)
  const swatches = new Set();
  for (let c = 0x20; c <= 0x2F; c++) swatches.add(fn(c));
  eq(swatches.size, 16, 'all 16 chains in a group get distinct colours');
  // and consecutive chains must be *visibly* apart, not a 1% lightness step:
  // songs use 00,01,02,03 side by side and they have to be tellable apart
  const rgbOf = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  for (let g = 0; g < 16; g++)
    for (let s = 0; s < 15; s++) {
      const [a1, a2, a3] = rgbOf(fn((g << 4) | s)), [b1, b2, b3] = rgbOf(fn((g << 4) | (s + 1)));
      const d = Math.hypot(a1 - b1, a2 - b2, a3 - b3);
      ok(d > 55, `chains ${((g<<4)|s).toString(16)} and ${((g<<4)|s+1).toString(16)} are too close (Δrgb ${d.toFixed(0)})`);
    }
  // Vibrancy: the by-group palette replaced a hand-picked vivid one, and
  // muted pastels were the first thing anyone noticed. Hold the line at
  // the old palette's average chroma.
  const chromaOf = h => { const [r, g2, b] = rgbOf(h); return Math.max(r, g2, b) - Math.min(r, g2, b); };
  let total = 0, count = 0;
  for (let c = 0; c <= 0xFF; c++) { total += chromaOf(fn(c)); count++; }
  const avgChroma = total / count;
  ok(avgChroma >= 150, `palette is washed out: average chroma ${avgChroma.toFixed(0)}, want >= 150`);
});

// ── v0.9: slice/loop windows are computed in SECONDS ───
// Regression guard for the unit bug that detuned every sliced sample in
// the player: SLnn offsets are frames at the WAV's own rate, but they were
// divided by the decoded AudioBuffer's rate (the AudioContext rate).
const SLICES = [{index: 0, offset: 0}, {index: 1, offset: 22050}, {index: 2, offset: 44100}];
t('sliceWindow converts native frames to seconds using the source rate', () => {
  // 22050 Hz sample, 4s long. Slice 1 starts at frame 22050 = 1.0s.
  const w = PT.sliceWindow(SLICES, 1, 22050, 4);
  eq(w.offset, 1, 'slice 1 starts at 1.0s');
  eq(w.dur, 1, 'and runs to slice 2 at 2.0s');
});
t('sliceWindow is independent of the AudioContext rate', () => {
  // The decoded buffer rate must not enter the maths at all: the same card
  // must sound identical on a 44.1k and a 48k machine.
  const a = PT.sliceWindow(SLICES, 1, 22050, 4);
  const b = PT.sliceWindow(SLICES, 1, 22050, 4);
  eq(a.offset, b.offset);
  // and a differently-rated source gives a correspondingly different time
  eq(PT.sliceWindow(SLICES, 1, 44100, 4).offset, 0.5, '44.1k source halves the time');
});
t('sliceWindow last slice runs to the end of the buffer', () => {
  const w = PT.sliceWindow(SLICES, 2, 22050, 4);
  eq(w.offset, 2);
  eq(w.dur, 2, 'last slice runs to the 4s end');
});
t('sliceWindow rejects missing and degenerate slices', () => {
  eq(PT.sliceWindow(SLICES, 7, 22050, 4), null, 'inactive pad is silence');
  eq(PT.sliceWindow(SLICES, 1, 0, 4), null, 'no source rate');
  eq(PT.sliceWindow(SLICES, 1, 22050, 0), null, 'empty buffer');
  eq(PT.sliceWindow([], 1, 22050, 4), null, 'no slices at all');
  eq(PT.sliceWindow(SLICES, 99, 22050, 4), null, 'index beyond the pad count');
});
t('sliceWindow clamps a slice that overruns the buffer', () => {
  const w = PT.sliceWindow(SLICES, 1, 22050, 1.5);
  eq(w.offset, 1);
  eq(w.dur, 0.5, 'truncated at the buffer end rather than running past it');
});
// SampleInstrument::isSliceIndexActive — slice 0 is live whenever ANY point
// is set, and computeSliceStart returns 0 when SL00 itself is unset. Dropping
// it silenced real notes (12 of them in SECOND on the reference card).
t('sliceWindow plays slice 0 from the head when SL00 is unset', () => {
  const w = PT.sliceWindow([{index: 1, offset: 22050}], 0, 22050, 4);
  ok(w, 'note 48 must sound, not be silenced');
  eq(w.offset, 0, 'starts at the head of the sample');
  eq(w.dur, 1, 'runs to the first marker');
});
t('sliceWindow honours an explicit SL00', () => {
  const w = PT.sliceWindow([{index: 0, offset: 11025}, {index: 1, offset: 22050}], 0, 22050, 4);
  eq(w.offset, 0.5);
  eq(w.dur, 0.5);
});
t('sliceWindow with no points at all is silent even for slice 0', () => {
  eq(PT.sliceWindow([], 0, 22050, 4), null);
});
// computeSliceEnd takes the SMALLEST later point above start, not the next
// by index — slice points are not required to ascend.
t('sliceWindow ends at the nearest later marker, not the next index', () => {
  const jumbled = [{index: 1, offset: 22050}, {index: 2, offset: 88200}, {index: 3, offset: 44100}];
  const w = PT.sliceWindow(jumbled, 1, 22050, 8);
  eq(w.offset, 1);
  eq(w.dur, 1, 'ends at frame 44100 (index 3), the nearest marker above start');
});
t('slicePadCount is 32 on Advance SAMPLESOURCE and 16 on pico SAMPLE', () => {
  eq(PT.slicePadCount({ type: 'SAMPLESOURCE' }), 32);
  eq(PT.slicePadCount({ type: 'SAMPLE' }), 16);
  // a 16-pad instrument must not swallow note 64+ as a pad
  eq(PT.sliceWindow([{index: 1, offset: 22050}], 16, 22050, 4, 16), null);
});
t('loopWindow converts loop points from native frames too', () => {
  const w = PT.loopWindow(11025, 33075, 22050, 4);
  eq(w.start, 0.5);
  eq(w.end, 1.5);
});
t('loopWindow rejects inverted, empty and unrated loops', () => {
  eq(PT.loopWindow(1000, 1000, 22050, 4), null, 'zero length');
  eq(PT.loopWindow(2000, 1000, 22050, 4), null, 'inverted');
  eq(PT.loopWindow(0, 1000, 0, 4), null, 'no source rate');
});
t('loopWindow clamps loop points to the decoded buffer', () => {
  const w = PT.loopWindow(0, 22050 * 99, 22050, 2);
  eq(w.start, 0);
  eq(w.end, 2, 'loop end clamped to the 2s buffer');
});

// ── v0.9.2: arrangement editing round-trips ────────────
// The song grid is a <SONG> element nested inside the outer <SONG>, so a
// naive open/close search splices out the whole arrangement.
t('rewriteSongSections round-trips an edited song grid', () => {
  const p = PT.parseProject(buildProjectXml());
  p.grid[0 * PT.CHANNELS + 3] = 0x05;          // put chain 05 on row 0, ch 4
  p.grid[1 * PT.CHANNELS + 0] = PT.EMPTY;      // clear row 1, ch 1
  const res = PT.rewriteSongSections(buildProjectXml(), p);
  ok(res.ok, res.error);
  const back = PT.parseProject(res.text);
  ok(back, 'rewritten file must still parse');
  eq(PT.gridCell(back, 0, 3), 0x05);
  eq(PT.gridCell(back, 1, 0), PT.EMPTY);
  eq(PT.gridCell(back, 0, 0), 0x00, 'untouched cells preserved');
});
t('rewriteSongSections preserves everything else when the grid changes', () => {
  const src = buildProjectXml();
  const p = PT.parseProject(src);
  p.grid[7] = 0x09;
  const back = PT.parseProject(PT.rewriteSongSections(src, p).text);
  eq(back.tempo, p.tempo, 'project settings intact');
  eq(back.instruments.length, p.instruments.length, 'instrument bank intact');
  eq(back.tables.length, p.tables.length, 'tables intact');
  eq([...back.phrases.notes].join(), [...p.phrases.notes].join(), 'phrases intact');
  eq([...back.grooves.map(g => g.join('.'))].join(), [...p.grooves.map(g => g.join('.'))].join(), 'grooves intact');
});
t('rewriteSongSections round-trips edited chain steps and transposes', () => {
  const src = buildProjectXml();
  const p = PT.parseProject(src);
  p.chains[0 * PT.STEPS + 2] = 0x07;                    // chain 00 step 2 -> phrase 07
  p.transposes[0 * PT.STEPS + 2] = 0xF4;                // -12
  p.chains[0 * PT.STEPS + 0] = PT.EMPTY;                // clear step 0
  const res = PT.rewriteSongSections(src, p);
  ok(res.ok, res.error);
  const back = PT.parseProject(res.text);
  eq(PT.chainStep(back, 0, 2).phrase, 0x07);
  eq(PT.chainStep(back, 0, 2).transpose, -12, 'negative transpose survives the round trip');
  eq(PT.chainStep(back, 0, 0).phrase, PT.EMPTY);
  eq(PT.chainStep(back, 1, 0).phrase, 0x02, 'other chains untouched');
});
t('rewriteSongSections keeps the nested SONG structure intact', () => {
  const src = buildProjectXml();
  const p = PT.parseProject(src);
  p.grid[0] = 0x04;
  const out = PT.rewriteSongSections(src, p).text;
  // one outer <SONG> plus one nested grid <SONG>, and matching closes
  const opens = (out.match(/<SONG>/g) || []).length;
  const closes = (out.match(/<\/SONG>/g) || []).length;
  eq(opens, 2, 'outer SONG + nested grid SONG');
  eq(closes, 2, 'both closed');
  ok(out.includes('<CHAINS>') && out.includes('<TRANSPOSES>'), 'sibling sections survive');
  ok(out.indexOf('<INSTRUMENTBANK') > out.indexOf('</SONG>'), 'bank still follows the song');
});
t('rewriteSongSections still refuses legacy 2-byte command files', () => {
  const p = PT.parseProject(buildProjectXml());
  p.geometry = { ...(p.geometry || {}), cmdWidth: 2 };
  const res = PT.rewriteSongSections(buildProjectXml(), p);
  ok(!res.ok, 'must refuse');
});

// ── v0.9.8: new-project template, groove and table writers ──
t('buildEmptyProject chunks buffers the way the firmware does', () => {
  // A single giant <DATA LENGTH="4096"/> parses here but is not a shape the
  // firmware is known to emit; every other writer chunks at 64 bytes.
  const xml = PT.buildEmptyProject({});
  const lens = [...xml.matchAll(/LENGTH="(\d+)"/g)].map(m => +m[1]);
  ok(lens.length, 'expected run-length chunks');
  eq(Math.max(...lens), 64, 'no chunk may exceed the 64-byte convention');
});
t('buildEmptyProject round-trips through the parser', () => {
  const xml = PT.buildEmptyProject({ tempo: 132, version: '3.0' });
  const p = PT.parseProject(xml);
  ok(p, 'template must parse');
  eq(p.tempo, 132);
  eq(PT.lastSongRow(p), -1, 'song grid starts empty');
  eq(p.instruments.length, 1, 'one instrument slot');
  eq(p.tables.length, PT.TABLE_COUNT, 'full table bank');
  ok(p.grooveRaw, 'groove buffer present');
  eq(p.grooves[0].join(','), '6,6', 'groove 0 defaults to 6/6');
  eq(p.geometry.cmdWidth, 1, 'modern command encoding');
});
t('an empty project is immediately editable and re-serialises', () => {
  const xml = PT.buildEmptyProject({});
  const p = PT.parseProject(xml);
  p.grid[0] = 0x00;
  p.chains[0] = 0x00;
  p.phrases.notes[0] = 60;
  const res = PT.rewriteSongSections(xml, p);
  ok(res.ok, res.error);
  const back = PT.parseProject(res.text);
  eq(PT.gridCell(back, 0, 0), 0x00);
  eq(PT.chainStep(back, 0, 0).phrase, 0x00);
  eq(back.phrases.notes[0], 60);
});
t('rebuildGrooveDigest makes an edited groove reach playback', () => {
  // The timeline reads proj.grooves, not proj.grooveRaw. Without the rebuild
  // the edit shows in the UI and on the card but never in a preview or render.
  const p = PT.parseProject(buildProjectXml());
  const before = PT.buildEventTimeline(p).duration;
  ok(before > 0, 'baseline duration');
  for (let st = 0; st < PT.STEPS; st++) p.grooveRaw[st] = st < 2 ? 24 : 255;
  eq(PT.buildEventTimeline(p).duration, before, 'raw edit alone changes nothing');
  PT.rebuildGrooveDigest(p);
  eq(p.grooves[0].join(','), '24,24');
  ok(PT.buildEventTimeline(p).duration > before * 2,
    'after the rebuild the slower groove lengthens the song');
});
t('rebuildGrooveDigest tolerates a project with no groove buffer', () => {
  const p = PT.parseProject(buildProjectXml());
  delete p.grooveRaw;
  PT.rebuildGrooveDigest(p);      // must not throw
  ok(true);
});
t('rewriteGrooves round-trips an edited groove', () => {
  const xml = buildProjectXml();
  const p = PT.parseProject(xml);
  ok(p.grooveRaw, 'fixture exposes a groove buffer');
  p.grooveRaw[0] = 8; p.grooveRaw[1] = 4; p.grooveRaw[2] = 255;
  const res = PT.rewriteGrooves(xml, p);
  ok(res.ok, res.error);
  const back = PT.parseProject(res.text);
  eq(back.grooves[0].join(','), '8,4');
  eq([...back.grooveRaw.slice(0, 3)].join(','), '8,4,255');
});
t('rewriteGrooves leaves the rest of the file alone', () => {
  const xml = buildProjectXml();
  const p = PT.parseProject(xml);
  p.grooveRaw[0] = 9;
  const back = PT.parseProject(PT.rewriteGrooves(xml, p).text);
  eq(back.tempo, p.tempo);
  eq(back.instruments.length, p.instruments.length);
  eq([...back.phrases.notes].join(), [...p.phrases.notes].join());
  eq([...back.grid].join(), [...p.grid].join());
});
t('rewriteTable edits only the target table', () => {
  const xml = buildTableXml();
  const p = PT.parseProject(xml);
  ok(p.tables.length >= 2, 'fixture has two tables');
  p.tables[0].cmd[0][0] = 0x45;      // VOL
  p.tables[0].param[0][0] = 0x1234;
  const res = PT.rewriteTable(xml, PT.hx2(p.tables[0].id), p.tables[0]);
  ok(res.ok, res.error);
  const back = PT.parseProject(res.text);
  eq(back.tables[0].cmd[0][0], 0x45);
  eq(back.tables[0].param[0][0], 0x1234);
  eq(back.tables[1].cmd[0][0], PT.CMD_NONE, 'the other table is untouched');
  eq(back.tables[1].param[0][0], 0, 'and its params too');
});
t('rewriteTable refuses an unknown table id', () => {
  const p = PT.parseProject(buildTableXml());
  const res = PT.rewriteTable(buildTableXml(), 'ZZ', p.tables[0]);
  ok(!res.ok, 'must refuse');
});

// ── Output effects (FX) ────────────────────────────────
t('FX: every definition has an id, a label, a hint and params', () => {
  const seen = new Set();
  for (const d of FX.DEFS) {
    ok(d.id && !seen.has(d.id), `duplicate or missing id: ${d.id}`);
    seen.add(d.id);
    ok(d.label && d.hint, `${d.id} needs a label and a hint`);
    ok(d.params.length > 0, `${d.id} has no params`);
  }
  eq(FX.ORDER, FX.DEFS.map(d => d.id), 'ORDER matches DEFS');
});
t('FX: every range param has a default inside its own bounds', () => {
  for (const d of FX.DEFS) for (const p of d.params) {
    if (p.type === 'seg') {
      ok(p.opts.some(o => o[0] === p.def), `${d.id}.${p.key} default is not one of its options`);
    } else {
      ok(typeof p.def === 'number', `${d.id}.${p.key} default is not a number`);
      ok(p.def >= p.min && p.def <= p.max, `${d.id}.${p.key} default ${p.def} outside ${p.min}..${p.max}`);
      ok(p.step > 0, `${d.id}.${p.key} step must be positive`);
      ok(typeof p.fmt === 'function', `${d.id}.${p.key} needs a formatter`);
    }
  }
});
t('FX: defaults() covers every effect and every key', () => {
  const d = FX.defaults();
  eq(Object.keys(d).sort(), FX.DEFS.map(x => x.id).sort());
  for (const def of FX.DEFS)
    eq(Object.keys(d[def.id]).sort(), def.params.map(p => p.key).sort(), def.id);
});
t('FX: presets only name real effects and real parameters', () => {
  const byId = new Map(FX.DEFS.map(d => [d.id, d]));
  for (const pre of FX.PRESETS) {
    ok(pre.id && pre.label, 'preset needs an id and a label');
    for (const id of pre.on) ok(byId.has(id), `${pre.id} enables unknown effect ${id}`);
    for (const id in pre.p) {
      const def = byId.get(id);
      ok(def, `${pre.id} overrides unknown effect ${id}`);
      for (const key in pre.p[id]) {
        const par = def.params.find(x => x.key === key);
        ok(par, `${pre.id}.${id} overrides unknown param ${key}`);
        if (par.type === 'seg')
          ok(par.opts.some(o => o[0] === pre.p[id][key]), `${pre.id}.${id}.${key} is not a valid option`);
        else
          ok(pre.p[id][key] >= par.min && pre.p[id][key] <= par.max,
             `${pre.id}.${id}.${key} = ${pre.p[id][key]} outside ${par.min}..${par.max}`);
      }
    }
  }
});
t('FX: presetState turns on exactly what the preset lists', () => {
  for (const pre of FX.PRESETS) {
    const st = FX.presetState(pre.id);
    for (const d of FX.DEFS)
      eq(st.enabled[d.id], pre.on.includes(d.id), `${pre.id}: ${d.id}`);
    eq(st.preset, pre.id);
  }
});
t('FX: presetState overrides land and the rest stay at defaults', () => {
  const st = FX.presetState('crt');
  eq(st.params.scanlines.variant, 'medium');
  eq(st.params.rgbshift.shiftH, 25);
  eq(st.params.rgbshift.shiftV, FX.DEFS.find(d => d.id === 'rgbshift').params.find(p => p.key === 'shiftV').def);
  // an unlisted effect keeps a full, valid parameter set even when off
  eq(st.params.noise, FX.defaults().noise);
});
t('FX: presetState hands back a fresh object each time', () => {
  const a = FX.presetState('crt'), b = FX.presetState('crt');
  a.params.scanlines.mix = 3;
  eq(b.params.scanlines.mix, 65, 'presets must not share mutable state');
  a.enabled.noise = true;
  eq(b.enabled.noise, false);
});
t('FX: unknown preset id falls back to Off rather than throwing', () => {
  const st = FX.presetState('nope');
  eq(st.preset, 'off');
  ok(!Object.values(st.enabled).some(Boolean), 'nothing enabled');
});
t('FX: the Off preset really is off', () => {
  const st = FX.presetState('off');
  ok(!Object.values(st.enabled).some(Boolean));
});
t('FX: output sizes are sane and unique', () => {
  const seen = new Set();
  for (const o of FX.OUTPUTS) {
    ok(!seen.has(o.id), `duplicate output ${o.id}`);
    seen.add(o.id);
    eq(o.id, `${o.w}x${o.h}`, 'id encodes the size');
    ok(o.w >= FX.SRC_W && o.h >= FX.SRC_H, `${o.id} is smaller than the source`);
  }
});
t('FX: source canvas is a whole multiple of the device screen', () => {
  eq(FX.SRC_W % FX.DEV_W, 0);
  eq(FX.SRC_H % FX.DEV_H, 0);
  eq(FX.SRC_W / FX.DEV_W, FX.SRC_H / FX.DEV_H, 'square pixels');
});
t('FX: hexToRgb normalises and survives junk', () => {
  eq(FX.hexToRgb('#000000'), [0, 0, 0]);
  eq(FX.hexToRgb('#ffffff'), [1, 1, 1]);
  eq(FX.hexToRgb('#f00'), [1, 0, 0], 'short form');
  eq(FX.hexToRgb(''), [0, 0, 0], 'empty falls back to black');
  eq(FX.hexToRgb('not a colour'), [0, 0, 0]);
});

// ── Generators ─────────────────────────────────────────
const show = a => a.map(v => v ? 'x' : '.').join('');
t('euclid: spreads hits as evenly as the step count allows', () => {
  eq(show(PT.euclid(3, 8)), 'x..x..x.', 'tresillo');
  eq(show(PT.euclid(4, 16)), 'x...x...x...x...');
  eq(show(PT.euclid(1, 4)), 'x...');
});
t('euclid: rotation 0 always puts a hit on the downbeat', () => {
  // Otherwise the default settings clear step 00, which is exactly where
  // the kick was, and the "clear the rest" option then blanks it.
  for (let steps = 1; steps <= 32; steps++)
    for (let hits = 1; hits <= steps; hits++)
      ok(PT.euclid(hits, steps)[0], `E(${hits},${steps}) missed the downbeat`);
});
t('euclid: the gaps between hits never differ by more than one', () => {
  for (const [h, st] of [[3, 8], [5, 8], [5, 16], [7, 16], [9, 16], [4, 9]]) {
    const at = PT.euclid(h, st).map((v, i) => v ? i : -1).filter(i => i >= 0);
    const gaps = at.map((v, i) => (i ? v - at[i - 1] : v + st - at[at.length - 1]));
    ok(Math.max(...gaps) - Math.min(...gaps) <= 1,
       `E(${h},${st}) gaps ${gaps.join(',')} are not even`);
  }
});
t('euclid: hit count always comes out right', () => {
  for (let steps = 1; steps <= 32; steps++)
    for (let hits = 0; hits <= steps; hits++)
      eq(PT.euclid(hits, steps).filter(Boolean).length, hits, `${hits} of ${steps}`);
});
t('euclid: rotation moves the figure without changing it', () => {
  const base = PT.euclid(5, 16);
  for (let r = 0; r < 16; r++) {
    const rot = PT.euclid(5, 16, r);
    eq(rot.length, 16);
    eq(rot.filter(Boolean).length, 5, `rotation ${r} changed the hit count`);
  }
  eq(show(PT.euclid(3, 8, 8)), show(PT.euclid(3, 8)), 'a full turn is no turn');
  eq(show(PT.euclid(3, 8, -1)), show(PT.euclid(3, 8, 7)), 'negative rotation wraps');
});
t('euclid: nonsense input is clamped rather than throwing', () => {
  eq(PT.euclid(0, 8).filter(Boolean).length, 0);
  eq(PT.euclid(99, 8).filter(Boolean).length, 8, 'more hits than steps fills it');
  eq(PT.euclid(-4, 8).filter(Boolean).length, 0);
  eq(PT.euclid(2, 0).length, 1, 'zero steps still returns something');
  eq(PT.euclid(2, 1e9).length, 256, 'and a silly step count is capped');
});

t('arp: walks the chord in the pattern asked for', () => {
  const min7 = PT.CHORDS.find(c => c.n === 'min7').iv;
  eq(PT.arpSequence(57, min7, 'up', 1, 4), [57, 60, 64, 67]);
  eq(PT.arpSequence(57, min7, 'down', 1, 4), [67, 64, 60, 57]);
  eq(PT.arpSequence(57, min7, 'up', 2, 8), [57, 60, 64, 67, 69, 72, 76, 79]);
  eq(PT.arpSequence(57, min7, 'up', 1, 6), [57, 60, 64, 67, 57, 60], 'it repeats');
  const ud = PT.arpSequence(57, min7, 'updown', 1, 6);
  eq(ud, [57, 60, 64, 67, 64, 60], 'up then back without repeating the ends');
});
t('arp: stays inside the note range and copes with edge input', () => {
  const maj = PT.CHORDS.find(c => c.n === 'maj').iv;
  for (const seq of [PT.arpSequence(115, maj, 'up', 4, 16), PT.arpSequence(0, maj, 'down', 4, 16)])
    for (const v of seq) ok(v >= 0 && v <= 119, `note ${v} out of range`);
  eq(PT.arpSequence(60, maj, 'up', 1, 0), []);
  eq(PT.arpSequence(60, [], 'up', 1, 4).length, 4, 'no intervals means the root alone');
  eq(PT.arpSequence(60, null, 'up', 1, 4), [60, 60, 60, 60]);
});
t('arp: random is random but reproducible', () => {
  const maj = PT.CHORDS.find(c => c.n === 'maj').iv;
  const a = PT.arpSequence(60, maj, 'random', 2, 16, 42);
  const b = PT.arpSequence(60, maj, 'random', 2, 16, 42);
  eq(a, b, 'the same seed must give the same phrase');
  ok(JSON.stringify(a) !== JSON.stringify(PT.arpSequence(60, maj, 'random', 2, 16, 43)),
     'a different seed should not');
  const pool = new Set(PT.arpSequence(60, maj, 'up', 2, 6));
  for (const v of a) ok(pool.has(v), `${v} is not in the chord`);
});
t('arp: every chord in the table is usable', () => {
  for (const c of PT.CHORDS) {
    ok(c.iv.length >= 2, `${c.n} needs at least two notes`);
    eq(c.iv[0], 0, `${c.n} should start on the root`);
    const seq = PT.arpSequence(60, c.iv, 'up', 1, c.iv.length);
    eq(seq.length, c.iv.length, c.n);
  }
});

t('vary: 100% similarity changes nothing', () => {
  const src = [57, PT.EMPTY, 60, PT.NOTE_OFF, 64, PT.EMPTY, 67, PT.EMPTY];
  eq(PT.varyNotes(src, 100, 1, null), src);
});
t('vary: the same seed always gives the same result', () => {
  const src = [57, PT.EMPTY, 60, PT.EMPTY, 64, PT.EMPTY, 67, PT.EMPTY];
  eq(PT.varyNotes(src, 50, 9, null), PT.varyNotes(src, 50, 9, null));
  ok(JSON.stringify(PT.varyNotes(src, 50, 9, null)) !== JSON.stringify(PT.varyNotes(src, 50, 10, null)),
     'a different seed should differ');
});
t('vary: lower similarity changes more', () => {
  const src = new Array(16).fill(0).map((_, i) => 60 + (i % 5));
  const diff = sim => PT.varyNotes(src, sim, 3, null).filter((v, i) => v !== src[i]).length;
  ok(diff(90) < diff(20), `90% changed ${diff(90)}, 20% changed ${diff(20)}`);
});
t('vary: never leaves the note range, and never invents a note-off', () => {
  const src = [0, 119, 60, PT.NOTE_OFF, PT.EMPTY, 1, 118, 60];
  for (let seed = 1; seed < 40; seed++) {
    const out = PT.varyNotes(src, 10, seed, null);
    eq(out.length, src.length);
    for (const v of out)
      ok(v === PT.EMPTY || v === PT.NOTE_OFF || (v >= 0 && v <= 119), `bad note ${v} at seed ${seed}`);
    eq(out[3], PT.NOTE_OFF, 'an explicit note-off is left alone');
  }
});
t('vary: with a mask, everything it writes stays in the key', () => {
  const mask = PT.scaleMask('A', 'Nat. Minor');
  const src = [57, 59, 60, 62, 64, 65, 67, PT.EMPTY];
  for (let seed = 1; seed < 40; seed++) {
    const out = PT.varyNotes(src, 25, seed, mask);
    for (const v of out) ok(PT.inScale(v, mask), `${v} left the key at seed ${seed}`);
  }
});
t('vary: does not mutate the notes it was handed', () => {
  const src = [57, PT.EMPTY, 60, PT.EMPTY];
  const before = src.slice();
  PT.varyNotes(src, 10, 5, null);
  eq(src, before);
});

t('humanise: writes a level for notes and nothing for gaps', () => {
  const src = [60, PT.EMPTY, 64, PT.NOTE_OFF, 67];
  const v = PT.humaniseVols(src, { seed: 1 });
  eq(v.length, src.length);
  eq(v[1], null, 'no note, no level');
  eq(v[3], null, 'note-off is not a note');
  for (const x of [v[0], v[2], v[4]]) ok(x >= 0 && x <= 255, `level ${x} out of range`);
});
t('humanise: accents land on the beat', () => {
  const src = new Array(16).fill(60);
  const v = PT.humaniseVols(src, { base: 0x40, spread: 0, accent: 0x30, accentEvery: 4, seed: 1 });
  for (let i = 0; i < 16; i++) eq(v[i], i % 4 === 0 ? 0x70 : 0x40, `step ${i}`);
});
t('humanise: stays in range at the extremes', () => {
  const src = new Array(16).fill(60);
  for (const opts of [{ base: 255, spread: 127, accent: 127 }, { base: 0, spread: 127, accent: 0 }])
    for (const x of PT.humaniseVols(src, { ...opts, seed: 2 }))
      ok(x >= 0 && x <= 255, `level ${x} from ${JSON.stringify(opts)}`);
});
t('humanise: the same seed gives the same levels', () => {
  const src = new Array(16).fill(60);
  eq(PT.humaniseVols(src, { seed: 8 }), PT.humaniseVols(src, { seed: 8 }));
});
t('rng: deterministic, in range, and not obviously stuck', () => {
  const a = PT.rng(1234), b = PT.rng(1234);
  const seq = Array.from({ length: 200 }, () => a());
  eq(seq, Array.from({ length: 200 }, () => b()));
  for (const v of seq) ok(v >= 0 && v < 1, `out of range: ${v}`);
  ok(new Set(seq).size > 190, 'too many repeats');
  const mean = seq.reduce((s, v) => s + v, 0) / seq.length;
  ok(mean > 0.4 && mean < 0.6, `mean ${mean}`);
  ok(PT.rng(0)() !== PT.rng(1)(), 'a zero seed must still work');
});

// ── Random look ────────────────────────────────────────
t('random: deterministic under a seeded rng, varies across seeds', () => {
  const a = FX.randomLook(PT.rng(11)), b = FX.randomLook(PT.rng(11));
  eq(JSON.stringify(a), JSON.stringify(b));
  ok(JSON.stringify(a) !== JSON.stringify(FX.randomLook(PT.rng(12))));
});
t('random: always produces a look, never an empty or absurd one', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const look = FX.randomLook(PT.rng(seed));
    const on = Object.entries(look.enabled).filter(([, v]) => v).map(([k]) => k);
    ok(on.length >= 2, `seed ${seed}: only ${on.length} effects`);
    ok(on.length <= 8, `seed ${seed}: ${on.length} effects is soup`);
  }
});
t('random: every parameter it writes is inside its own slider range and on its step', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const look = FX.randomLook(PT.rng(seed));
    for (const d of FX.DEFS)
      for (const par of d.params) {
        const v = look.params[d.id][par.key];
        if (par.type === 'seg') { ok(par.opts.some(o => o[0] === v), `seed ${seed} ${d.id}.${par.key}`); continue; }
        ok(v >= par.min && v <= par.max, `seed ${seed} ${d.id}.${par.key} = ${v}`);
        const steps = (v - par.min) / par.step;
        ok(Math.abs(steps - Math.round(steps)) < 1e-6, `seed ${seed} ${d.id}.${par.key} off-step ${v}`);
      }
  }
});
t('random: keeps the destructive extremes off the table', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const look = FX.randomLook(PT.rng(seed));
    if (look.enabled.noise) ok(look.params.noise.amount <= 40, `seed ${seed} noise ${look.params.noise.amount}`);
    if (look.enabled.grade) {
      ok(look.params.grade.brightness >= 85 && look.params.grade.brightness <= 125, `seed ${seed}`);
    }
    if (look.enabled.chswap) ok(look.params.chswap.mode !== 'rgb', `seed ${seed}: chswap doing nothing`);
    if (look.enabled.trails) ok(look.params.trails.decay <= 92, `seed ${seed}: trails would never fade`);
  }
});
t('random: any routes it wires are valid', () => {
  const srcs = ['low', 'mid', 'high', 'level', 'hit'];
  for (let seed = 1; seed <= 60; seed++) {
    const look = FX.randomLook(PT.rng(seed));
    for (const [id, routes] of Object.entries(look.react)) {
      for (const r of routes) {
        ok(FX.REACT_TARGET[id], `seed ${seed}: route on unreactable ${id}`);
        ok(look.enabled[id], `seed ${seed}: route on a disabled effect`);
        ok(srcs.includes(r.src) && r.depth >= -100 && r.depth <= 100 && r.param === FX.REACT_TARGET[id],
           `seed ${seed}: bad route ${JSON.stringify(r)}`);
      }
    }
  }
});

// ── Scale helpers ──────────────────────────────────────
t('scale: a named scale and root become a 12-note mask', () => {
  const m = PT.scaleMask('A', 'Nat. Minor');
  eq(m.map((v, i) => v ? PT.NOTE_NAMES[i] : null).filter(Boolean), ['C','D','E','F','G','A','B']);
  const c = PT.scaleMask('C', 'Major');
  eq(c.map((v, i) => v ? PT.NOTE_NAMES[i] : null).filter(Boolean), ['C','D','E','F','G','A','B']);
});
t('scale: chromatic and unknown names mean no constraint', () => {
  eq(PT.scaleMask('C', 'None (Chromatic)'), null);
  eq(PT.scaleMask('C', 'Chromatic'), null);
  eq(PT.scaleMask('C', ''), null);
  eq(PT.scaleMask('C', null), null);
  eq(PT.scaleMask('C', 'Bebop Klezmer'), null, 'a scale we do not know is not a constraint');
  eq(PT.scaleMask('H', 'Major'), null, 'nor is a root we cannot read');
});
t('scale: the firmware writes a padded root, which still has to parse', () => {
  ok(PT.scaleMask('A ', 'Dorian'), 'trailing space from the project file');
  const p = PT.projectScale({ scale: 'Dorian', scaleRoot: 'A ' });
  eq(p.root, 'A'); eq(p.name, 'Dorian');
  eq(PT.projectScale({ scale: 'None (Chromatic)', scaleRoot: 'C ' }), null);
  eq(PT.projectScale(null), null);
});
t('scale: inScale leaves empty and note-off alone', () => {
  const m = PT.scaleMask('C', 'Major');
  ok(PT.inScale(PT.EMPTY, m));
  ok(PT.inScale(PT.NOTE_OFF, m));
  ok(PT.inScale(60, m), 'C is in C major');
  ok(!PT.inScale(61, m), 'C# is not');
  ok(PT.inScale(61, null), 'no mask means everything is in scale');
});
t('scale: snapping moves a note to the nearest one in the key', () => {
  const m = PT.scaleMask('C', 'Major');
  eq(PT.snapToScale(61, m, 0), 60, 'C# down to C');
  eq(PT.snapToScale(61, m, 1), 62, 'forced upward to D');
  eq(PT.snapToScale(61, m, -1), 60);
  eq(PT.snapToScale(60, m, 0), 60, 'already in scale, left alone');
  eq(PT.snapToScale(PT.EMPTY, m, 0), PT.EMPTY);
  eq(PT.snapToScale(PT.NOTE_OFF, m, 0), PT.NOTE_OFF);
  eq(PT.snapToScale(61, null, 0), 61, 'no mask, no change');
});
t('scale: snapping never leaves the note range', () => {
  const m = PT.scaleMask('C', 'Major');
  for (const v of [0, 1, 118, 119]) {
    const out = PT.snapToScale(v, m, 0);
    ok(out >= 0 && out <= 119, `${v} -> ${out}`);
  }
  ok(PT.snapToScale(119, m, 1) <= 119, 'forced up at the top of the range');
  ok(PT.snapToScale(0, m, -1) >= 0, 'forced down at the bottom');
});
t('scale: transposing by degree walks the scale, not the semitones', () => {
  const m = PT.scaleMask('A', 'Nat. Minor');   // A B C D E F G
  const A = 57;
  eq(PT.noteStr(PT.transposeInScale(A, m, 1)), PT.noteStr(59), 'A up one degree is B');
  eq(PT.noteStr(PT.transposeInScale(A, m, 2)), PT.noteStr(60), 'then C');
  eq(PT.transposeInScale(A, m, -1), 55, 'and down one degree is G');
  eq(PT.transposeInScale(A, m, 7), A + 12, 'seven degrees is an octave');
  eq(PT.transposeInScale(A, m, 0), A);
  eq(PT.transposeInScale(A, null, 3), A, 'no mask, no move');
  eq(PT.transposeInScale(PT.NOTE_OFF, m, 3), PT.NOTE_OFF);
});
t('scale: a degree transpose of an out-of-scale note lands in the scale', () => {
  const m = PT.scaleMask('C', 'Major');
  ok(PT.inScale(PT.transposeInScale(61, m, 1), m), 'C# up a degree');
  ok(PT.inScale(PT.transposeInScale(61, m, -1), m), 'C# down a degree');
});
t('scale: degree transpose stays inside the note range', () => {
  const m = PT.scaleMask('C', 'Major');
  ok(PT.transposeInScale(119, m, 20) <= 119);
  ok(PT.transposeInScale(0, m, -20) >= 0);
});
t('scale: every scale in the table produces a usable mask', () => {
  for (const sc of PT.SCALES)
    for (const root of PT.NOTE_NAMES) {
      const m = PT.scaleMask(root, sc.n);
      ok(m && m.filter(Boolean).length === new Set(sc.iv).size,
         `${root} ${sc.n} produced ${m ? m.filter(Boolean).length : 'null'}`);
      // Snapping must terminate and stay in range for every note.
      for (let v = 0; v <= 119; v++) {
        const out = PT.snapToScale(v, m, 0);
        ok(out >= 0 && out <= 119 && m[out % 12], `${root} ${sc.n}: ${v} -> ${out}`);
      }
    }
});

// ── Audio-reactive analysis and modulation ─────────────
const noteBins = (loud) => {                 // synthetic byte FFT
  const f = new Uint8Array(1024).fill(0);
  for (const [fromHz, toHz, v] of loud) {
    const lo = Math.round(fromHz / 24000 * 1024), hi = Math.round(toHz / 24000 * 1024);
    for (let i = lo; i <= hi && i < 1024; i++) f[i] = v;
  }
  return f;
};
const wave = (amp) => {
  const t = new Uint8Array(2048);
  for (let i = 0; i < t.length; i++) t[i] = 128 + Math.round(amp * 127 * Math.sin(i / 8));
  return t;
};
const settle = (freq, time, gain = 1, n = 40) => {
  const env = AudioReact.blankEnv();
  let out;
  for (let i = 0; i < n; i++) out = AudioReact.analyse(freq, time, 48000, env, gain);
  return out;
};

t('audio: silence reads as silence on every source', () => {
  const out = settle(noteBins([]), new Uint8Array(2048).fill(128));
  for (const k of ['low', 'mid', 'high', 'level', 'hit']) ok(out[k] < 0.001, `${k} = ${out[k]}`);
});
t('audio: energy lands in the band it belongs to', () => {
  const bass = settle(noteBins([[25, 160, 240]]), wave(0.5));
  ok(bass.low > 0.8, `low ${bass.low}`);
  ok(bass.high < 0.05, `high leaked: ${bass.high}`);
  const treble = settle(noteBins([[2000, 10000, 240]]), wave(0.5));
  ok(treble.high > 0.8, `high ${treble.high}`);
  ok(treble.low < 0.05, `low leaked: ${treble.low}`);
});
t('audio: analyse never returns anything outside 0..1', () => {
  for (const gain of [0.1, 1, 4, 400]) {
    const out = settle(noteBins([[20, 12000, 255]]), wave(1), gain);
    for (const k of ['low', 'mid', 'high', 'level', 'hit'])
      ok(out[k] >= 0 && out[k] <= 1, `${k} = ${out[k]} at gain ${gain}`);
  }
});
t('audio: a bass hit fires the transient, and it decays once the hit passes', () => {
  const env = AudioReact.blankEnv();
  const quiet = noteBins([[25, 160, 10]]), loud = noteBins([[25, 160, 250]]);
  for (let i = 0; i < 40; i++) AudioReact.analyse(quiet, wave(0.1), 48000, env, 1);
  const before = env.hit;
  const hit = AudioReact.analyse(loud, wave(0.9), 48000, env, 1);
  ok(before < 0.2, `should be settled first, was ${before}`);
  ok(hit.hit > 0.9, `transient did not fire: ${hit.hit}`);
  // A kick is loud for a moment and then gone; the pulse has to fall away
  // with it or every effect wired to it stays latched on.
  let after = hit.hit;
  for (let i = 0; i < 12; i++) after = AudioReact.analyse(quiet, wave(0.1), 48000, env, 1).hit;
  ok(after < 0.3, `transient never decayed: ${after}`);
});
t('audio: a four-to-the-floor pattern fires once per kick', () => {
  const env = AudioReact.blankEnv();
  const quiet = noteBins([[25, 160, 10]]), loud = noteBins([[25, 160, 250]]);
  for (let i = 0; i < 40; i++) AudioReact.analyse(quiet, wave(0.1), 48000, env, 1);
  let peaks = 0, prev = 0;
  for (let beat = 0; beat < 6; beat++) {
    const on = AudioReact.analyse(loud, wave(0.9), 48000, env, 1).hit;
    if (on > 0.9 && prev < 0.4) peaks++;
    prev = on;
    for (let i = 0; i < 10; i++) prev = AudioReact.analyse(quiet, wave(0.1), 48000, env, 1).hit;
  }
  eq(peaks, 6, 'every kick should register');
});
t('audio: a steady tone does not keep firing the transient', () => {
  const env = AudioReact.blankEnv();
  const steady = noteBins([[25, 160, 200]]);
  for (let i = 0; i < 60; i++) AudioReact.analyse(steady, wave(0.6), 48000, env, 1);
  ok(env.hit < 0.2, `steady tone reads as a beat: ${env.hit}`);
});
t('audio: analyse survives empty and mismatched buffers', () => {
  const env = AudioReact.blankEnv();
  eq(AudioReact.analyse(null, null, 48000, env, 1), AudioReact.ZERO);
  eq(AudioReact.analyse(new Uint8Array(0), new Uint8Array(0), 48000, env, 1), AudioReact.ZERO);
  const out = AudioReact.analyse(new Uint8Array(4).fill(200), new Uint8Array(4).fill(200), 0, env, 1);
  for (const k of ['low', 'mid', 'high', 'level']) ok(isFinite(out[k]), `${k} not finite`);
});

t('FX: every react target names a real, non-segmented parameter', () => {
  for (const d of FX.DEFS) {
    if (!d.react) continue;
    const par = d.params.find(p => p.key === d.react);
    ok(par, `${d.id} reacts on missing param ${d.react}`);
    ok(par.type !== 'seg', `${d.id} cannot react on a segmented control`);
  }
  eq(Object.keys(FX.REACT_TARGET).length, FX.DEFS.filter(d => d.react).length);
  ok(!FX.REACT_TARGET.chswap, 'a channel permutation has no "more"');
});
t('FX: blankReact covers every reactable effect and nothing else', () => {
  const r = FX.blankReact();
  eq(Object.keys(r).sort(), FX.DEFS.filter(d => d.react).map(d => d.id).sort());
  for (const id in r) eq(r[id], [], 'a fresh effect has no routings');
});
t('FX: reactableParams offers every numeric parameter and no segmented ones', () => {
  for (const d of FX.DEFS) {
    const keys = FX.reactableParams(d).map(x => x.key);
    for (const k of keys) ok(d.params.find(x => x.key === k).type !== 'seg');
    if (d.react) ok(keys.includes(d.react), `${d.id}'s default target must be routable`);
  }
});
t('FX: modulate is a no-op with no wiring or no audio', () => {
  const p = FX.defaults();
  ok(FX.modulate(p, FX.blankReact(), { low: 1, mid: 1, high: 1, level: 1, hit: 1 }) === p,
     'unwired must not even allocate');
  ok(FX.modulate(p, null, { level: 1 }) === p);
  ok(FX.modulate(p, FX.blankReact(), null) === p);
});
const route = (id, r) => ({ [id]: Array.isArray(r) ? r : [r] });
t('FX: a positive depth pushes towards the maximum, negative towards the minimum', () => {
  const par = FX.DEFS.find(d => d.id === 'bloom').params.find(p => p.key === 'intensity');
  const base = FX.defaults().bloom.intensity;
  const up = FX.modulate(FX.defaults(), route('bloom', { src: 'level', depth: 100 }), { level: 1 });
  eq(up.bloom.intensity, par.max);
  const down = FX.modulate(FX.defaults(), route('bloom', { src: 'level', depth: -100 }), { level: 1 });
  eq(down.bloom.intensity, par.min);
  const half = FX.modulate(FX.defaults(), route('bloom', { src: 'level', depth: 50 }), { level: 1 });
  eq(half.bloom.intensity, base + 0.5 * (par.max - base));
});
t('FX: a route can name any numeric parameter, not just the default', () => {
  const par = FX.DEFS.find(d => d.id === 'bloom').params.find(p => p.key === 'radius');
  const out = FX.modulate(FX.defaults(),
    route('bloom', { src: 'low', depth: 100, param: 'radius' }), { low: 1 });
  eq(out.bloom.radius, par.max, 'the named parameter moves');
  eq(out.bloom.intensity, FX.defaults().bloom.intensity, 'the default target does not');
});
t('FX: two routes on one effect drive their own parameters independently', () => {
  const defs = FX.DEFS.find(d => d.id === 'bloom');
  const out = FX.modulate(FX.defaults(), route('bloom', [
    { src: 'level', depth: 100, param: 'intensity' },
    { src: 'low', depth: 100, param: 'radius' },
  ]), { level: 1, low: 0.5 });
  eq(out.bloom.intensity, defs.params.find(p => p.key === 'intensity').max);
  const rPar = defs.params.find(p => p.key === 'radius');
  const rBase = FX.defaults().bloom.radius;
  eq(out.bloom.radius, rBase + 0.5 * (rPar.max - rBase));
});
t('FX: two routes on the SAME parameter compose and stay in range', () => {
  const par = FX.DEFS.find(d => d.id === 'bloom').params.find(p => p.key === 'intensity');
  const out = FX.modulate(FX.defaults(), route('bloom', [
    { src: 'level', depth: 100, param: 'intensity' },
    { src: 'low', depth: 100, param: 'intensity' },
  ]), { level: 1, low: 1 });
  ok(out.bloom.intensity >= par.min && out.bloom.intensity <= par.max);
  eq(out.bloom.intensity, par.max);
});
t('FX: the slider value is the resting point, restored when the audio stops', () => {
  const p = FX.defaults();
  eq(FX.modulate(p, route('bloom', { src: 'level', depth: 100 }), { level: 0 }).bloom.intensity,
     p.bloom.intensity);
});
t('FX: modulate never leaves a parameter outside its own range', () => {
  for (const d of FX.DEFS) {
    if (!d.react) continue;
    for (const par of FX.reactableParams(d))
      for (const depth of [-100, -37, 37, 100])
        for (const lvl of [0, 0.5, 1]) {
          const out = FX.modulate(FX.defaults(),
            route(d.id, { src: 'level', depth, param: par.key }), { level: lvl });
          const v = out[d.id][par.key];
          ok(v >= par.min && v <= par.max, `${d.id}.${par.key} = ${v} outside ${par.min}..${par.max}`);
        }
  }
});
t('FX: modulate does not mutate the settings it was handed', () => {
  const p = FX.defaults();
  const before = JSON.stringify(p);
  FX.modulate(p, route('bloom', { src: 'level', depth: 100 }), { level: 1 });
  eq(JSON.stringify(p), before, 'the user\'s own sliders must not move');
});
t('FX: modulate ignores an unknown source or parameter rather than producing NaN', () => {
  eq(FX.modulate(FX.defaults(), route('bloom', { src: 'nope', depth: 100 }), { level: 1 })
       .bloom.intensity, FX.defaults().bloom.intensity);
  const out = FX.modulate(FX.defaults(),
    route('bloom', { src: 'level', depth: 100, param: 'colour' }), { level: 1 });
  eq(out.bloom.colour, 'none', 'a segmented parameter cannot be driven');
  ok(!Object.values(out.bloom).some(v => Number.isNaN(v)));
});
t('FX: modulate skips routes on effects the enabled map turns off', () => {
  const p = FX.defaults();
  const wiring = route('bloom', { src: 'level', depth: 100 });
  const off = FX.modulate(p, wiring, { level: 1 }, { bloom: false });
  ok(off === p, 'a disabled effect must cost nothing, not even a copy');
  const on = FX.modulate(p, wiring, { level: 1 }, { bloom: true });
  ok(on.bloom.intensity > p.bloom.intensity);
  // No enabled map at all keeps the old behaviour.
  ok(FX.modulate(p, wiring, { level: 1 }).bloom.intensity > p.bloom.intensity);
});
t('FX: the old single-object wiring is simply skipped, not misread', () => {
  const p = FX.defaults();
  eq(FX.modulate(p, { bloom: { src: 'level', depth: 100 } }, { level: 1 }), p);
});
t('FX: presets only wire real effects to real sources', () => {
  const srcs = AudioReact.SOURCES.map(x => x[0]);
  for (const pre of FX.PRESETS) {
    for (const id in (pre.r || {})) {
      ok(FX.REACT_TARGET[id], `${pre.id} wires ${id}, which cannot react`);
      ok(srcs.includes(pre.r[id].src), `${pre.id}.${id} uses unknown source ${pre.r[id].src}`);
      const dep = pre.r[id].depth;
      ok(dep >= -100 && dep <= 100, `${pre.id}.${id} depth ${dep} out of range`);
      ok(pre.on.includes(id), `${pre.id} wires ${id} but never switches it on`);
    }
    const st = FX.presetState(pre.id);
    for (const id in st.react) {
      ok(Array.isArray(st.react[id]), `${pre.id}.${id} wiring must be a route list`);
      for (const r of st.react[id])
        ok(r.param && FX.reactableParams(FX.DEFS.find(d => d.id === id)).some(x => x.key === r.param),
           `${pre.id}.${id} route names no valid parameter`);
    }
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
