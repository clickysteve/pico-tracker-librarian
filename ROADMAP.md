# Roadmap

Gathered from real-device testing feedback. Roughly in priority order.

**1.0 is gated on Steve's say-so** — versions stay in the `0.9.x` range
until then, however substantial a round turns out to be.

## Next

- **Card access over USB** — blocked on firmware (issues #1430 mass
  storage / #1432 data protocol); the librarian will work while the device
  is connected the day either lands.
- ~~Delete from the sample browser~~ — done in 0.9.15: every Browse row
  trashes to the card, library files restore to their exact subfolder.
- **Waveform view + trim** in the sample browser.
- **MIDI clock out** was considered and dropped: the MIDI export already
  covers the case people hit, and clock out only helps if the browser
  preview is the master, which it will not be with hardware in the room.

## Playback fidelity

The player is a sketch, not an emulation, and these are the gaps that are
actually audible rather than theoretical:

- ~~`pingpong` loops play forward~~ — fixed in 0.9.15 with mirrored
  composite buffers, bouncing exactly where the firmware bounces.
- ~~Song-grid group looping~~ — fixed in 0.9.14: channels loop their
  contiguous blocks exactly as Player.cpp does, verified against the
  firmware source.
- **Advance `SAMPLESOURCE` amp envelopes aren't applied**, so notes sustain
  until the next one instead of decaying. On projects where every
  instrument loops, this is the most noticeable difference from the
  device. That firmware is closed, and guessing at its parameter ranges is
  what caused the slice bugs fixed in 0.9.1 — this needs establishing by
  ear against real hardware, not assumption.
- Synth voices (SID/OPAL) and most FX beyond `VOL`/`PAN`/`KIL`/`GRV`/`HOP`
  are out of scope by design.

## USB / Remote UI

- **Remote input** — the client half is written but disabled: the Advance
  visibly reacts to the proposed `FE 03` opcode (screen flicker), which
  means the closed firmware assigns inbound opcodes beyond the published
  protocol. Sending it blind risks provoking undefined behaviour. Needs
  coordination with xiphonics before any client sends input. (Ask on
  Discord / issue #1432.)

## Ideas

- **Video render.** The pieces are now all in place: the player knows every
  event to the sample, the effects take a modulation input, and the output
  canvas is already a capture surface. Driving the effects from the
  player's own timeline rather than from a microphone would turn a project
  file into a finished music video with perfectly locked audio, rendered
  offline the same way stems are.
- **Version history from the backups.** Every write already lands in
  `PTLibrarian_Backups/<stamp>/`. Parsing those and diffing them with the
  Compare machinery would give per-project history and restore, turning
  the safety net into undo that survives closing the browser.
- **Song maps in the setlist.** The annotated map is per project; a set's
  worth of them on one page would be the thing you actually take on stage.
- **More generators.** Call-and-response, fills every N bars, and a
  "make this phrase into a chain of variations" pass.

## Done

Kept short, as a record of what feedback rounds resolved: arrangement
editing (song grid + chains), block selection, the trash browser with
restore and permanent delete, phrase step insert/delete, pick-lists in
place of typing hex, the transport bar and live playback position, the
slicer's waveform zoom, setlist ordering, the macOS junk-file filter, the
playback fixes in 0.9.1 (slice/loop sample-rate units, output clipping,
dropped slice-0 notes), render to WAV and stems, table and groove editing,
chain-colour sidecars, note entry from a computer keyboard, the mirror's
output effects with recording and capture-ready output sizes in 0.9.9,
audio-reactive effects, scale lock, the phrase generators and the
annotated song map in 0.9.10, and the 0.9.11 feedback round: the effects
drawer, per-parameter audio routing, stems as one zip with render
progress, insert-paste and row clears on the grids, the tables layout,
MP4 recording and the editable mirror text; and 0.9.12's six new effects
(trails, pixelate, hue cycle, kaleidoscope, refresh bar, invert), seven
new presets, the random-look button, switchable mirror fonts and
shareable look files; 0.9.14's firmware-accurate group looping, the
consolidated save bar, the buffered set ZIP and alt-arrow drill-down;
and 0.9.15's island arrangements, endless device-style looping, true
pingpong loops, sample-browser delete, and the removal of the built-in
recorder in favour of OBS against the pop-out. See `CHANGELOG.md` for
the detail.
