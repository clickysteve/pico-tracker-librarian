// Property/fuzz tests: the parsers must never throw on arbitrary input —
// they return null (or a best-effort object) instead. Seeded PRNG so
// failures reproduce.
import { PT } from './extract.mjs';

let seed = 0xC0FFEE;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; return seed / 0x7FFFFFFF; }
function ri(n) { return Math.floor(rnd() * n); }

const base = `<PICOTRACKER><PROJECT VERSION="2.3"><PARAMETER NAME="tempo" VALUE="120"/></PROJECT>
<SONG><SONG><DATA VALUE="255" LENGTH="64"/><DATA>00010203</DATA></SONG>
<CHAINS><DATA VALUE="255" LENGTH="64"/></CHAINS><TRANSPOSES><DATA VALUE="0" LENGTH="64"/></TRANSPOSES>
<NOTES><DATA>3CFE40</DATA></NOTES><INSTRUMENTS><DATA VALUE="255" LENGTH="16"/></INSTRUMENTS>
<COMMAND1><DATA VALUE="45" LENGTH="16"/></COMMAND1><PARAM1><DATA VALUE="0" LENGTH="32"/></PARAM1>
<COMMAND2><DATA VALUE="45" LENGTH="16"/></COMMAND2><PARAM2><DATA VALUE="0" LENGTH="32"/></PARAM2></SONG>
<INSTRUMENTBANK><INSTRUMENT ID="00" TYPE="SAMPLE"><PARAM NAME="sample" VALUE="k.wav"/></INSTRUMENT></INSTRUMENTBANK>
<TABLES><TABLE ID="00"/></TABLES><GROOVES><DATA VALUE="255" LENGTH="64"/></GROOVES><MIXER/></PICOTRACKER>`;

const CHARS = '<>/"=&;#ABCxyz0123456789 \n\t' + String.fromCharCode(0, 7, 0xFF, 0x2028);
function mutate(s) {
  const arr = [...s];
  const n = 1 + ri(8);
  for (let k = 0; k < n; k++) {
    const op = ri(3), pos = ri(arr.length);
    if (op === 0) arr[pos] = CHARS[ri(CHARS.length)];               // replace
    else if (op === 1) arr.splice(pos, 1 + ri(20));                 // delete run
    else arr.splice(pos, 0, CHARS[ri(CHARS.length)]);               // insert
  }
  return arr.join('');
}
function truncate(s) { return s.slice(0, ri(s.length)); }

let fails = 0, runs = 0;
function tryParse(label, fn, input) {
  runs++;
  try { fn(input); }
  catch (e) { fails++; console.error(`THREW (${label}): ${e.message}\n--- input head ---\n${JSON.stringify(input.slice(0,200))}`); }
}

for (let i = 0; i < 800; i++) tryParse('parseProject/mutate', PT.parseProject, mutate(base));
for (let i = 0; i < 300; i++) tryParse('parseProject/trunc', PT.parseProject, truncate(base));
for (let i = 0; i < 300; i++) {
  const junk = Array.from({length: ri(400)}, () => CHARS[ri(CHARS.length)]).join('');
  tryParse('parseProject/junk', PT.parseProject, junk);
  tryParse('parsePti/junk', PT.parsePti, junk);
  tryParse('parseTheme/junk', PT.parseTheme, junk);
  tryParse('parseConfig/junk', PT.parseConfig, junk);
}
// Valid parse must stay valid after fuzzing session (no shared state)
const ok = PT.parseProject(base);
if (!ok || ok.tempo !== 120) { fails++; console.error('base parse degraded after fuzzing'); }

// buildMidi must not throw on any successfully parsed mutant
for (let i = 0; i < 200; i++) {
  const p = PT.parseProject(mutate(base));
  if (p) {
    runs++;
    try { PT.buildMidi(p, 'F'); } catch(e) { fails++; console.error('buildMidi threw: ' + e.message); }
  }
}

console.log(`fuzz: ${runs} parses, ${fails} unexpected throws`);
process.exit(fails ? 1 : 0);
