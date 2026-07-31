# Changelog

## v0.9.4 — transport, live position, phrase insert/delete

- **Transport bar.** A bar along the bottom shows what's playing (song,
  chain, row or phrase), a progress bar, elapsed/total, and a stop button
  that works from anywhere. The playing project's row is tinted and its
  name accented, so row hover no longer hides the fact that it's playing.
- **Live position in the grid.** While anything plays, the cell each
  channel is currently inside is outlined, its row gutter lights up, the
  chains in play are highlighted in the chain list, and the open chain's
  current step is marked. Driven by new position marks on the event
  timeline.
- **Insert / delete a phrase step**, shifting the rest of the phrase.
- **Chain step rows line up again.** A stale `display:flex` rule was
  overriding the grid layout, so any row with a transpose pushed its
  neighbours out of alignment — that's the broken look in the screenshot.
  Rows are also beat-marked every four now, matching the phrase grid.
- **Every chain step has a labelled `edit` button**, including empty ones
  (disabled, so the column doesn't jump). The bare `›` was easy to miss.
- **Pick lists reach every value.** Chains run 00–FE and phrases beyond
  what a list can usefully hold, so typing a value that isn't listed now
  offers it as a first-class entry rather than relying on an invisible
  fallback.
- **Fuzzy matching in pick lists**: `c4` finds `C-4`, `a4` finds chain
  `A4`.
- **Arrow keys work in the editors.** They were being swallowed by
  project-to-project navigation. They now walk the song grid too, with
  ⌘/Ctrl+C/V to copy and paste a single cell.
- **"+ more rows" keeps your scroll position** instead of jumping to the
  top of the grid.

## v0.9.3 — pick lists instead of typing, room to arrange

- **Nothing has to be typed from memory any more.** Every editable cell
  opens a filterable pick-list of the things that actually exist:
  - grid cells list the chains this song already uses, with their colours
    and usage counts, then chains defined but not placed, then free slots;
  - chain steps list the project's phrases with a note count each;
  - the phrase editor picks **instruments by name** (`04 Night Bass`, not
    `04`) and **FX by name** (`KIL`, `HOP`, `PSL` … with the hex as a
    hint) — the FX column had regressed to free text when the editor was
    rebuilt, which meant knowing the exact command names;
  - notes pick from a list too.
  Filter by typing, ↑↓ to move, Enter to choose, Esc to cancel. A raw hex
  or literal value is still accepted for anyone who knows it.
- **Spare rows past the end of the song**, so the arrangement can be
  extended in place, with **+ more rows** for as far as the geometry
  allows. There was previously no way to add to a song at all.
- **Whole-row copy and paste** across all 8 channels, from the row gutter.
- Row actions (**▶ Play**, **▦ Patterns**, **⇌ Compare**) now sit
  immediately after the project name rather than stranded at the far right.
- Expand chevrons enlarged throughout; the workspace's secondary stat line
  (`master 100`, `23 song rows`) is larger and lighter.
- More breathing room between the song grid and its scrollbar.

## v0.9.2 — arrangement editing, clearer affordances

- **You can edit the arrangement.** Click any song-grid cell to place,
  change or clear the chain that sits there (type hex, `Del` to clear).
  Open a chain and its 16 steps are editable in place: which phrase plays
  and its per-step transpose. Saved through the same
  backup → write → re-read → verify → rollback path as everything else,
  now verifying the grid, chains and transposes byte-for-byte too.
  - This needed a fix first: the song grid is a `<SONG>` element nested
    inside the outer `<SONG>`, so the section writer's open/close search
    matched the outer open tag against the inner close tag and spliced out
    the whole arrangement. Now scoped strictly inside, with a test that
    leaves the file unparseable if the naive version comes back.
- **Play and expand no longer look alike.** Rows lead with a small
  chevron for expand/collapse and carry labelled **▶ Play**, **▦ Patterns**
  and **⇌ Compare** buttons. Patterns and Compare are reachable without
  expanding the row first.
- **The redundant timeline is gone.** It plotted channel on Y and song row
  on X while the grid directly below plotted song row on Y and channel on
  X — the same data with swapped axes, which is why it read wrong. The
  grid does the job; the Overview song map remains as the at-a-glance view.
- **The workspace opens full-size**, and the grid sizes itself to the
  space available. The zoom slider and the Expand toggle are gone.
- **Project detail text is bigger and lighter** — the facts row was 11px
  in muted grey; it's now a readable set of labelled values.

## v0.9.1 — playback: distortion and dropped notes

Chased with the open firmware's `SampleInstrument.cpp` as ground truth and
an offline render of the mix as the measurement.

- **The distortion was clipping, and it had been there all along.** Eight
  channels each ran at up to 2.0 voice gain times an unjustified 1.4x
  channel boost into an output that clamps at ±1. Rendering the demo song
  offline peaked at **1.257 with 56 samples pinned at full scale** — and
  measured identically back in v0.6.0, so this predates the recent work;
  correcting slice lengths in v0.9.0 simply kept more voices sounding at
  once and pushed it further over. The mix is now staged sanely with a
  brickwall limiter in front of the output: **peak 0.46, zero clipped
  samples**. `tests/audio.test.mjs` renders and measures this, and fails
  if the old gain staging is restored.
- **Slice 0 was silently dropped.** `isSliceIndexActive` treats slice 0 as
  live whenever *any* slice point is set, starting at frame 0 when `SL00`
  itself is unset. The player required an explicit `SL00` and silenced the
  note otherwise — 12 real notes in `SECOND` on the reference card.
- **Slice pad range is now per instrument type.** Advance `SAMPLESOURCE`
  instruments carry 32 pads (notes 48–79; the reference card has one with
  31 active slice points), the pico's `SampleInstrument` has 16. It was
  hardcoded to 32 for everything, so notes 64–79 on a 16-pad instrument
  were swallowed as dead pads instead of playing pitched.
- **Slice end now takes the nearest later marker**, matching
  `computeSliceEnd`, rather than the next marker by index — slice points
  are not required to ascend.
- **The `start` parameter is honoured** for non-sliced notes
  (firmware: `rendFirst_ = start_.GetInt()`); it was ignored, so any
  instrument with a trimmed start played from the wrong point.

Still an honest sketch, not an emulation: `pingpong` loops play forward,
and Advance `SAMPLESOURCE` amp envelopes aren't applied — that firmware is
closed, and guessing at its parameter ranges is what causes bugs like the
ones above.

## v0.9.0 — sliced playback fix

- **Sliced samples played at the wrong offsets, and it was audible.**
  `SLnn` values on the card are frames at the WAV's *own* sample rate, but
  the player divided them by the decoded `AudioBuffer`'s rate — which is
  the AudioContext rate, since `decodeAudioData` resamples. Every slice
  was therefore out by `srcRate / contextRate`: a 22050 Hz sample on a
  48 kHz machine started 2.18× into the wrong place and ran 2.18× short,
  which is why sliced parts sounded out of time. Loop points had the same
  unit mix. Both now convert through the native rate read from the WAV
  header before decoding. (Same class of bug as the v0.6 slicer-editor
  fix; the player was simply never corrected.)
  The conversion is now a pure `PT.sliceWindow` / `PT.loopWindow` pair
  with unit tests, plus an end-to-end check that inspects the offsets the
  player actually schedules.
- **The demo card now demonstrates slicing.** Its bass phrase asked for
  slice 0 on an instrument that only defines SL01/SL02, so it rendered
  silence; it now triggers slice pads 1 and 2.
- **Chain colours are vivid again.** The by-group palette was correct but
  desaturated. Saturation is back up (average chroma now above the old
  hand-picked palette's) while keeping the group-hue and
  neighbour-contrast guarantees, both of which are pinned by tests.
- **↺ Colours is disabled** until you actually have custom chain colours,
  and its tooltip says how many it would discard.
- **Chain steps read vertically**, one step per line in play order,
  instead of flowing across columns.

## v0.8.0 — fourth feedback round

- **Song grid row triggers.** Every row in the song grid has a ▶ that
  plays that row across all 8 channels at once, the way it actually
  sounds there, rather than one chain in isolation.
- **Detail panels moved beside the grid.** Chain and phrase panels now
  live in the empty space to the right of the song grid instead of
  stacking underneath it, so you can see the grid and what you're editing
  at the same time.
- **Timeline spans the full pane width** (as does the Overview song map),
  scaling to whatever the song length is instead of drawing a small fixed
  strip in the corner.
- **Chain colours are grouped by number.** The high nibble picks a hue
  family, so the 00s are all one colour, the 10s another, and so on;
  within a group the lightness strides so neighbours like 00 and 01 stay
  clearly distinct. The chain list is bucketed with group headers, and
  ↺ Colours resets any custom picks.
- **Slicer waveform zoom.** Scroll to zoom (shift+scroll to pan), −/+/Fit
  buttons, and a full-file strip underneath showing where the zoom window
  sits — drag it to scroll. Marker placement, dragging and auditioning all
  respect the zoom.
- **Project overview redesigned.** Four headline cards (BPM, length,
  scale, samples) over three grouped panels (Song / Instruments / File)
  instead of fourteen identical pills. Length is a real playback duration.
- **Instrument and sample sections collapse** in the project workspace.
- **✂ on every instrument** in the project workspace, not just on sample
  rows, and preview ▶ on the sample pool in the project list detail too.

## v0.7.0 — third feedback round

- **macOS junk files are hidden.** AppleDouble `._name.wav` resource
  forks, `.DS_Store`, `.Spotlight-V100`, `.Trashes` and `Thumbs.db` are
  skipped everywhere: scans, sample lists, project lists, ZIP/folder
  exports. They were showing up as fake samples and inflating counts.
- **Pattern grid sizes properly.** The grid's column widths were pinned
  at 30px while the zoom slider only scaled the cells, so cell text
  clipped at anything above the default. Columns now follow the zoom.
- **Ordered chain list down the left of the song grid**, ascending by
  chain number (it used to be a legend in song-usage order), with usage
  counts, colour pickers, per-chain preview, and hover-to-highlight of a
  chain's cells in the grid.
- **Overview tab filled out**: a stat strip (BPM, master, transpose,
  scale, rows/chains/phrases/tables/grooves, note count, firmware, file
  and pool size, save date), a clickable mini song map, FX-usage and
  groove summaries, and sample rows you can audition inline.
- **Phrase editor rebuilt.** One always-editable tracker grid instead of
  a view/edit toggle: beat-striped rows, column headers, full keyboard
  navigation (arrows / Tab / Enter / Delete), type-to-edit, per-step
  copy/paste, whole-phrase copy/paste/clear, 50-level undo, and a ▶
  button to audition just that phrase.
- **Instrument parameters grouped and readable**: Sample / Tuning / Mix /
  Filter / Crush / Amp / LFO 1 / LFO 2 / Table cards instead of one flat
  chip wall, with level bars for 0–255 params, note names for root note,
  L/R for pan, and slice markers in their own card. The editor gained
  sliders alongside the text fields.
- **Setlists.** The Sets tab is now an ordered setlist: click to add,
  drag or ▲▼ to reorder, ✕ to remove, and the order is saved with the
  set. Export can number the project folders (`01_`, `02_` …) so the
  device lists them in playing order.
- **Slicer is findable.** ✂ buttons now sit on every sample row that has
  an instrument, in both the project Overview and the project list's
  expanded detail, on top of the existing Instruments-tab entry point.

## v0.6.0 — second feedback round
- Project screen is now a full-screen workspace with Overview / Patterns
  tabs — Patterns finally has room. Slice editor reachable from the
  project screen's instrument view too.
- Every project row has a round ▶ preview button; play/stop straight from
  the list. Play buttons restyled (circled) so they no longer look like
  the expand chevrons.
- Theme creator: build a theme from scratch or "Edit copy" any existing
  one — live device-screen preview, 12 colour pickers, font choice, save
  as .ptt to the card. Preview rendering now matches the firmware's real
  colour roles (row numbers alternate ACCENT/ACCENTALT, chain 00 in HI1,
  cursor is an inverted HI2 block, channel strip inverted, etc).
- Instrument parameter editing (experimental): edit any existing param of
  a project-bank instrument in place, saved with the full backup/verify/
  rollback path.
- USB mirror: ⧉ Pop out opens the mirror in its own window (for OBS /
  capture); full-screen mode as before.
- Samples and Grooves start collapsed, with Expand/Collapse-all buttons.
  Sample names click-to-copy their card path (browsers can't "reveal in
  Finder" — the path is the best we can hand you).
- Card access while the device is connected is a firmware matter
  (issues #1430/#1432) — nothing a client can do yet.

## v0.5.0 — real-device feedback round
- USB mirror now fits the window (responsive canvas) and has a full-screen
  mode. Remote input is disabled: the Advance visibly reacts to the
  proposed opcode, so nothing is sent until there's firmware-side
  agreement (see ROADMAP).
- Patterns got a build-out: cell-size zoom, an Expand button that grows
  the window, per-chain custom colours (remembered per card), chain
  usage ("used at 04·C2 …"), two-column chain steps, and chain preview —
  play any single chain from its legend chip or detail header.
- Problems → Unused Pool: preview buttons, per-row and bulk "move to
  card trash" (PTLibrarian_Trash/ on the card — reversible, never a
  delete), with the usual verification and audit trail.
- Grooves screen rebuilt: grouped by project, proportional tick bars,
  swing percentage, and an explainer.
- Theme cards: preview now mirrors the device screen's colour roles,
  buttons uncramped, and a card-size slider.
- UI text size control (Aa button in the header, remembered).
- Samples tab count was lying (it counted rendered rows); now reports
  library and pools separately and honestly.
- More breathing room in project details and instrument params; tooltip
  on the "current project on device" dot.

## v0.4.3 — scan speed
- Warm opens no longer re-read every pool/library wav: metadata is
  cached by size+mtime, so an unchanged card rescans with directory
  listings only (the status bar now reports how many samples were
  actually read — expect 0 on a reopen). Remaining reads and project
  parsing run with bounded concurrency (SD readers hate sequential
  round-trips). e2e now asserts the 0-reads warm path.

## v0.4.2 — hardening release (adversarial review pass)
Three independent reviews of the whole codebase; every confirmed finding
fixed, each with a regression test where testable:
- CRITICAL: slice editor converted marker positions in decoded-audio
  frames, not the wav's native frames — on a 48 kHz audio device every
  saved slice point for a non-48 kHz sample was wrong. Offsets now
  convert at the native rate from the wav header.
- CRITICAL: phrase-edit save could write phrase data into a TABLE's
  PARAM section on nonstandard files (element-name collision); section
  rewriting is now scoped to the SONG element and refuses odd files.
- Verification `same()` had an operator-precedence bug that let a
  truncated write pass; project transpose -128 decoded as +128; sharp
  notes in negative octaves parsed 3 octaves high; `$` sequences in
  file names could corrupt regex-replacement rewrites; apostrophes in
  sample names (tinyxml2 `&apos;`) made repairs impossible.
- Write-path hardening: backups/rollbacks now byte-true (non-UTF-8/BOM
  files refused instead of silently mangled); missing-sample detection
  case-insensitive to match FAT cards (no more overwriting a live
  sample that differed only in case); copied wavs header-validated;
  deleted project dirs never resurrected; audit log writes serialized;
  set-device-theme aborts instead of recreating config when the read
  fails; honest restore-failure messages; MIDI export no longer stack-
  overflows on note-dense songs; save-then-edit-again no longer fails
  silently; number keys no longer switch tabs under open modals.

## v0.4.1
- Waveform slice editor for sample instruments: draggable markers,
  transient detection for breaks, equal divide, zero-crossing snap,
  slice audition (click or number-key pads), safe SLnn writes with
  backup/verify/rollback. Round-trip verified against real card files.

## v0.4.0
- In-browser song playback: Web Audio engine with firmware-accurate walk
  (grooves/GRV/HOP/transpose), pool samples, slices, loop modes, VOL/PAN/KIL.
- Experimental phrase editor: edit notes/instruments/commands, transpose
  ops, in-memory staging, paranoid save (backup + byte-verify + rollback).
  Round-trip serialization verified against real Advance card files.

## v0.3.1
- Experimental remote input in the Device tab: keyboard (arrows, Z/X/A/S,
  Space) and an on-screen pad send a proposed `FE 03` 9-bit key-state
  opcode over USB. Off by default; stock firmware discards the frames, so
  it is safe to enable against any device. Client half of the input
  protocol proposal.

## v0.3.0
- USB mirror now renders with the real device font (the public-domain nILS
  Wide face plus the full special-glyph page, extracted from the open
  firmware) — pixel-accurate screens instead of approximated text.
- Full project parses are no longer persisted into the browser cache after
  opening the pattern viewer (smaller IndexedDB footprint).
- Fixed a stale-observer leak when re-filtering long lists, and a garbled
  instruments status line.
- End-to-end browser test suite committed (`tests/e2e.mjs`, needs Playwright).

## v0.2.2
- Themes: **Set on device** writes a theme into `.config.xml` (backup,
  verify, rollback, audit) and the active device theme is badged;
  **Save device colours as .ptt** captures the current palette.
- USB device mirror reachable from the landing page without an SD card.
- Automatic https upgrade for the hosted page; precise WebSerial errors.

## v0.2.1
- Demo card mode: synthetic in-memory card with generated audio.

## v0.2.0
- Fix all exact matches (batch repair), extract instrument as `.pti`,
  USB screen mirror, MIDI export honours GRV/HOP, chunked list rendering,
  installable offline PWA, MIT license.

## v0.1.x
- Initial release: browse/inspect/problems/repair/backup/sets/stats for
  pico 2.x and Advance 3.x cards, pattern viewer, MIDI export, themes,
  grooves, renders, global search, incremental cached scans.
