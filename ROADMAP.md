# Roadmap

Gathered from real-device testing feedback. Roughly in priority order.

**1.0 is gated on Steve's say-so** — versions stay in the `0.9.x` range
until then, however substantial a round turns out to be.

## Next

- **Transpose a selected block** — selection, copy, paste and clear landed
  in 0.9.6; nudging every chain number in a selection up or down is the
  obvious next operation on it.
- **Card access over USB** — blocked on firmware (issues #1430 mass
  storage / #1432 data protocol); the librarian will work while the device
  is connected the day either lands.
- **Note entry from a computer keyboard** — a piano layout (`z`/`s`/`x` as
  C/C#/D) for the phrase editor, so melodies can be typed rather than
  picked note by note. Worth it only if people actually write in the
  browser rather than on the device.
- **Delete from the sample browser** — the Trash tab (0.9.6) handles
  restore and permanent delete for files already trashed; trashing
  directly from the sample browser and preview flows would save a trip
  through Problems.

## Playback fidelity

The player is a sketch, not an emulation, and these are the gaps that are
actually audible rather than theoretical:

- **`pingpong` loops play forward.** Web Audio has no ping-pong loop mode;
  it needs manual scheduling or a reversed buffer.
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

- Per-chain colours are stored in the browser; consider a sidecar file on
  the card so they travel with it.
- Waveform view + trim in the sample browser.
- Render a project to wav in the browser (the offline render harness in
  `tests/audio.test.mjs` already proves this is possible).
- Table editing — tables parse and display but aren't editable.
- Groove editing.

## Done

Kept short, as a record of what feedback rounds resolved: arrangement
editing (song grid + chains), block selection, the trash browser with
restore and permanent delete, phrase step insert/delete, pick-lists in
place of typing hex, the transport bar and live playback position, the
slicer's waveform zoom, setlist ordering, the macOS junk-file filter, and
the playback fixes in 0.9.1 (slice/loop sample-rate units, output
clipping, dropped slice-0 notes). See `CHANGELOG.md` for the detail.
