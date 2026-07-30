# Roadmap

Gathered from real-device testing feedback. Roughly in priority order.

## Next
- **Phrase editor rework** — the current grid works but is bare. Wanted:
  keyboard-first editing (arrows + type-to-enter like a tracker), row
  insert/copy/paste, live audition of the edited phrase, undo.
- **Theme creator** — build/edit themes in the librarian: colour pickers
  for all 12 roles with the live device-screen preview, save as .ptt,
  duplicate-and-tweak from an existing theme.
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
