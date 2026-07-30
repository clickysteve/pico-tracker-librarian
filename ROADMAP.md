# Roadmap

Gathered from real-device testing feedback. Roughly in priority order.

## Next
- **Card access over USB** — blocked on firmware (issues #1430 mass
  storage / #1432 data protocol); the librarian will work while the
  device is connected the day either lands.
- **Phrase editor: row insert/delete** — v0.7 delivered keyboard-first
  editing, per-step and whole-phrase copy/paste, undo and audition.
  Still missing: insert/delete a row (shifting the rest of the phrase),
  multi-row selection, and note entry from a computer keyboard piano
  layout.
- **True sample delete** — the Problems tab can move unused pool samples
  to `PTLibrarian_Trash/` on the card; add explicit delete (with confirm)
  from the sample browser and preview flows, plus a trash browser with
  restore/empty.

## USB / Remote UI
- **Remote input** — the client half is written but disabled: the Advance
  visibly reacts to the proposed `FE 03` opcode (screen flicker), which
  means the closed firmware assigns inbound opcodes beyond the published
  protocol. Needs coordination with xiphonics before any client sends
  input. (Ask on Discord / issue #1432.)

## Ideas
- Pattern editor for chains and the song grid (not just phrases).
- Per-chain colours are stored in the browser; consider a sidecar file on
  the card so they travel with it.
- Waveform view + trim in the sample browser.
- Render a project to wav in the browser (offline render of the player).
