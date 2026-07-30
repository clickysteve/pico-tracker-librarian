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

// ── v0.8: single song-row playback ─────────────────────
t('buildEventTimeline songRow plays every channel at that row', () => {
  const p = PT.parseProject(buildProjectXml());
  // fixture row 0: ch0 → chain 00 (phrase 00 = C3, then phrase 01 = 48 tsp -3)
  //                ch1 → chain 02 (phrase 00 = C3)
  const tl = PT.buildEventTimeline(p, { songRow: 0 });
  ok(tl, 'expected a timeline');
  const ons = tl.events.filter(e => e.type === 'on');
  const chans = new Set(ons.map(e => e.ch));
  ok(chans.has(0) && chans.has(1), 'both populated channels sound, got ' + [...chans]);
  ok(!ons.some(e => e.ch > 1), 'silent channels contribute nothing');
});
t('buildEventTimeline songRow 1 differs from row 0', () => {
  const p = PT.parseProject(buildProjectXml());
  // row 1: only ch0 → chain 01 (phrase 02, note 72 at step 1)
  const tl = PT.buildEventTimeline(p, { songRow: 1 });
  const ons = tl.events.filter(e => e.type === 'on');
  eq(ons.length, 1, 'one note in row 1');
  eq(ons[0].note, 72);
  eq(ons[0].ch, 0);
});
t('buildEventTimeline songRow is a strict subset of the full song', () => {
  const p = PT.parseProject(buildProjectXml());
  const full = PT.buildEventTimeline(p).events.filter(e => e.type === 'on').length;
  const r0 = PT.buildEventTimeline(p, { songRow: 0 }).events.filter(e => e.type === 'on').length;
  const r1 = PT.buildEventTimeline(p, { songRow: 1 }).events.filter(e => e.type === 'on').length;
  eq(r0 + r1, full, 'rows 0+1 account for every note in this 2-row fixture');
});
t('buildEventTimeline songRow out of range returns null', () => {
  const p = PT.parseProject(buildProjectXml());
  eq(PT.buildEventTimeline(p, { songRow: 99 }), null);
  eq(PT.buildEventTimeline(p, { songRow: -1 }), null);
});
t('buildEventTimeline songRow does not disturb chain or phrase modes', () => {
  const p = PT.parseProject(buildProjectXml());
  eq(PT.buildEventTimeline(p, { chain: 0x00 }).events.filter(e => e.type === 'on').length, 2);
  eq(PT.buildEventTimeline(p, { phrase: 0x00 }).events.filter(e => e.type === 'on').length, 1);
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
  const lumOf = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  for (let g = 0; g < 16; g++)
    for (let s = 0; s < 15; s++) {
      const d = Math.abs(lumOf(fn((g << 4) | s)) - lumOf(fn((g << 4) | (s + 1))));
      ok(d > 18, `chains ${((g<<4)|s).toString(16)} and ${((g<<4)|s+1).toString(16)} are too close (Δlum ${d.toFixed(1)})`);
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
