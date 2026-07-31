# picoTracker Librarian

A librarian and arrangement editor for [picoTracker](https://xiphonics.com/) SD cards that runs entirely in your browser — pico and Advance cards alike. Browse and audit your projects, instruments, samples and themes; hear a song without leaving the page; edit the arrangement, phrases, slice points and instrument parameters; find and repair broken sample references; build ordered setlists; export MIDI. One HTML file, no install, no server, and no data ever leaves your machine.

Sibling project to [M8 Librarian](https://m8librarian.allmyfriendsaresynths.com), same architecture and safety model.

Requires Chrome or Edge (it uses the File System Access API to read your card; Firefox and Safari don't support it).

> ## ⚠ Experimental — back up your projects first
>
> This is alpha software that **writes to your SD card**. Reading and browsing are safe and well exercised; the editing features (arrangement, phrases, slice points, instrument parameters, themes) are newer and have had far less real-world use.
>
> Every write backs the original up to `PTLibrarian_Backups/` on the card, verifies the result byte-for-byte and rolls back on failure, and deletions go to a trash folder rather than vanishing. That is not a substitute for your own backup. **Copy your card, or at least the projects you care about, before editing anything.** Use at your own risk.

## Getting started

1. Open `index.html` in Chrome or Edge (or the hosted page).
2. Click **OPEN SD CARD** and pick your picoTracker card (or any folder with the picoTracker layout: `projects/`, `samples/`, `instruments/`, `themes/`, …).

No card handy? Hit **Try with demo data** on the landing screen — a synthetic card, generated audio included, loads entirely in memory so you can explore every tab, the pattern editor, playback and the repair flow without touching hardware.

Unlike the M8, picoTracker projects are self-contained (each project folder carries its own `samples/` pool), so missing-sample detection works instantly with no cataloguing step. The library is cached in IndexedDB, so reopening the same card is instant and rescans are incremental — a warm rescan reads no sample data at all.

Cards that have been near a Mac collect AppleDouble junk (`._kick.wav`, `.DS_Store`, `.Spotlight-V100`). These are skipped everywhere — scans, listings, exports — so they never appear as phantom samples.

## What it does

### Browse

- **Projects** — list and grid views, filtered and sorted by name, date, missing samples, instrument count, BPM or size. Each row plays, opens the pattern editor, or compares directly; expanding it shows the instrument bank, the sample pool with missing/unused markers, project settings, and similar projects by shared samples. An `autosave` badge flags projects where the device would load newer unsaved state.
- **Instruments** — every `.pti` in `instruments/` plus every project's instrument bank, decoded in full (all parameters, slice points), with type filters (SAMPLE / SAMPLESOURCE / MIDI / SID / OPAL), sample status and usage tracking. Parameters are grouped into Sample / Tuning / Mix / Filter / Crush / Amp / LFO / Table cards with level bars, note names for root note and L/R for pan.
- **Samples** — the `samples/` library tree plus every project pool, with duration, sample rate and bit depth per WAV, used/unused badges, and up/down arrow-key audition.
- **Themes** — visual previews of every `.ptt` with swatches, and the device's active theme flagged. **Preview** applies a palette to the app itself; **Set on device** writes it into the card's `.config.xml` so the tracker boots with it; **Save device colours as .ptt** captures the current device palette as a new theme. There's also a theme creator: build one from scratch or copy an existing one, with a live device-screen preview drawn from the firmware's real colour roles.
- **Grooves** — every non-default groove across all projects, step-visualised.
- **Renders** — `renders/` and `recordings/` with waveform preview and playback.
- **Stats** — collection KPIs, instrument types, FX command usage, tempo/scale/firmware distributions, backbone samples, recently modified, and the device's `.config.xml`.

### Play

- **In-browser playback** — press Play on any project and hear it. A Web Audio engine walks the song the way the firmware player does: grooves, per-channel `GRV` switches, `HOP` flow, chain and project transpose, slices, loop modes, and `VOL`/`PAN`/`KIL`. Slice and loop points are converted through each WAV's own sample rate, so playback is in time whatever your machine's audio rate is, and the mix runs through a limiter so dense passages don't clip.
  An honest sketch of the song, not an emulation: synth voices (SID/OPAL) and most FX are out of scope by design, `pingpong` loops play forward, and Advance `SAMPLESOURCE` amp envelopes aren't applied.
- **Play anything, at any level** — the whole song, a single song row across all 8 channels, one chain, or one phrase.
- **Transport** — a bar along the bottom shows what's playing, a progress bar, elapsed/total, and a stop that works from anywhere; the playing project's row stays lit. While anything plays, the song grid outlines the cell each channel is currently inside, lights its row, highlights the chains in play, and marks the current step of the open chain.

### Arrange and edit

- **Pattern editor** — the song grid at full size, with an ordered chain list down the left bucketed by number group (usage counts, colours, per-chain preview, hover-to-highlight), and chain and phrase panels beside the grid rather than under it.
  Click any cell to choose the chain that sits there from a filterable list of the chains this song already uses, the ones defined but unplaced, and free slots; type a value that isn't listed and it's offered too, so all of `00`–`FE` is reachable. Arrow keys walk the grid and **shift+arrows or shift+click select a block**, which then copies, pastes or clears as a unit (`⌘/Ctrl+C/V`, `Del`, `⌘/Ctrl+A` for everything, `Esc` to deselect). Whole rows also copy and paste from the gutter. Spare rows sit past the end of the song so an arrangement can be extended, with **+ more rows** for as far as the geometry allows.
  Chain colours come from the chain number: the high nibble picks a hue family so the `00`s, `10`s and `20`s each read as a group, while lightness strides within a group to keep neighbours apart. Pick your own per chain, or reset.
- **Chain editor** — open any chain and edit its 16 steps in place: which phrase plays at each step, chosen from the project's phrases with a note count each, and a per-step transpose. Beat-marked every four.
- **Phrase editor** — a tracker-style grid you edit in place. Arrows and Tab move the cursor, `Enter` or typing opens a pick-list, `Del` clears a cell. Notes, instruments and FX are chosen by name — `04 Night Bass` rather than `04`, `KIL`/`HOP`/`PSL` rather than raw hex — with fuzzy matching, so `c4` finds `C-4`. Insert or delete a step (shifting the rest of the phrase), per-step copy/paste, whole-phrase copy/paste/clear, one-click transpose (±1/±12), 50-level undo, and a ▶ that auditions just that phrase.
- **Slice editor** — any sample instrument's WAV on a big waveform. Zoom with the scroll wheel or −/+/Fit, with a full-file strip underneath showing where you are that drags to scroll. Drag markers, double-click to add, audition slices by clicking regions or with the `1`–`9`,`0` keys, auto-chop breakbeats with transient detection, equal-divide clean loops, and snap everything to zero-crossings. Advance `SAMPLESOURCE` instruments carry 32 slice pads, pico `SAMPLE` instruments 16.
- **Instrument parameters** — edit any existing parameter of a project-bank instrument in place, with sliders alongside the values for 0–255 knobs.

All edits are held in memory until you explicitly save, and every save goes through the write path described under [the safety model](#the-safety-model). Files using the legacy 2-byte command encoding are read-only.

### Inspect and export

- **Project overview** — four headline cards (BPM, playback length, scale, samples) over grouped Song / Instruments / File panels, a clickable full-width song map, FX-usage and groove summaries, collapsible instrument and sample sections, and auditionable sample rows with one-click access to the slice editor.
- **Compare** — diff two projects: shared and unique instruments and samples, metadata side by side.
- **MIDI export** — download any project as a Standard MIDI File (type 1, 24 PPQ, a tempo track plus one track per channel that plays anything, chain and project transpose applied, per-channel `GRV` groove switches and `HOP` flow honoured).

### Device (USB)

- **Live screen mirror** — connect the picoTracker over USB (WebSerial) and watch the device screen in the browser, rendered pixel-for-pixel with the device's own bitmap font, with full-refresh requests, a pop-out window for capture, full-screen mode and PNG snapshots. Reachable straight from the landing page, no SD card needed. Requires the `https://` page, since WebSerial only exists in secure contexts.
- **Remote input — written, and deliberately disabled.** The client half of a proposed `FE 03` key-state opcode exists in the code, but the button is hidden and nothing is ever sent: on a real Advance the proposed opcode makes the screen flicker, which means the closed firmware already assigns inbound opcodes beyond the published protocol. Sending it blind risks provoking undefined behaviour on the device. This needs agreement on the firmware side before it's switched on — see `ROADMAP.md`.
- **Card access while connected** is a firmware matter (issues #1430 / #1432), not something a client can work around.

### Maintain

- **Problems tab** — missing sample references, unused pool samples with reclaimable sizes, unused instruments, content-identical samples (byte-level dupe scan), duplicate `.pti` names, stale autosaves, unreadable files, backbone sounds, and the repair log. Most problems can be fixed from the tab itself.
- **Fix all exact matches** — one-click batch repair: every missing reference with an exact-name copy elsewhere on the card is restored by file copy, verified and audit-logged.
- **Repair mode** — two fixes for a broken reference: *copy* a matching WAV from the library or another project's pool into this project's pool (no project-file edit), or *re-point* the reference to an existing pool sample by rewriting only that attribute inside the project file.
- **Cleanup and trash** — unused pool samples move to `PTLibrarian_Trash/` on the card rather than being deleted. The **Trash** tab lists what's in there and lets you restore a file to its pool (refusing if something of that name has reappeared) or delete it permanently, individually or all at once.
- **Extract as .pti** — pull any instrument out of a project bank into `instruments/` as a `.pti` (or download it if the card is read-only).
- **Backup** — copy the card to a folder or download it as a ZIP, with per-directory selection (`.config.xml` and `.current` always included).
- **Setlists** — click projects to add them to an ordered setlist, drag or ▲▼ to reorder, then export a lean, card-ready `projects/` layout as a folder or ZIP. Folders can be numbered (`01_`, `02_` …) so the device lists them in playing order. Setlists save with their order.

## The safety model

The card is opened **read-only**. Nothing is written unless you explicitly confirm a repair, an edit or an export. Every write follows the same path:

- Write permission is requested only at the moment you confirm.
- The file's modification time and size are checked against the scan first; if it changed since (say, you saved on the device), the write refuses and asks for a rescan rather than clobbering it.
- The original is copied to `PTLibrarian_Backups/<timestamp>/` on the card before anything is overwritten.
- After writing, the file is re-read, re-parsed and compared byte-for-byte against what you intended — phrase buffers, song grid, chains and transposes, slice points, parameters, whichever applied.
- If verification fails, the write is rolled back automatically from the backup.
- Every operation is recorded in the browser and appended to `PTLibrarian_Backups/audit-log.txt` on the card, so the history travels with the card.

Deletions are never destructive: cleanup moves files to `PTLibrarian_Trash/`.

Everything runs locally. No server, no telemetry, no network access beyond loading the page. The hosted page installs as an offline-capable PWA.

## Format compatibility

File-format knowledge is derived from the open-source [picoTracker firmware](https://github.com/xiphonics/picoTracker) (BSD-3-Clause): the XML project format and its run-length/hex `<DATA>` chunk encoding, `.pti` instruments, `.ptt` themes, `.config.xml`, the frozen FourCC command values, and `SampleInstrument`'s slice and loop semantics.

The Advance firmware is closed source. Its format support here is interoperability work derived from real card files, not reverse engineering of the binary: geometry is inferred from buffer lengths rather than assumed, so the Advance's larger layout (256 song rows, 255 phrases, 128 tables, `SAMPLESOURCE` instruments with 32 slice pads, nested groove buffers, hex `Font` values) is read without hard-coding a firmware version. Parsers are deliberately tolerant — unknown instrument types, parameters and elements are preserved and displayed rather than rejected — so newer output should degrade gracefully.

Validated against real Advance card files spanning firmware 2.0-RC3, 2.1-BETA1, 2.2-BETA1, 2.3-Beta1 and 3.0, alongside the pico format from the open firmware. Some early betas used a short-lived 2-byte command encoding; that's detected from the buffer length rather than the version string, and those files open read-only with unknown commands shown as hex.

## Development

The entire app is a single `index.html` — deliberately, so it can be hosted anywhere and audited in one read. Internal modules: `PT` (format knowledge: parsers, encoders, rewriters, playback timeline, MIDI), `Cache` (IndexedDB), `Scanner`, `Zip` (store-method ZIP writer), `AudioPlayer`, `Demo` (synthetic card), `USB` (Remote UI protocol), `SongPlayer` (Web Audio) and one UI module.

Tests are zero-dependency Node scripts that extract modules straight out of `index.html`, so they always run against the shipped code:

```bash
node tests/parser.test.mjs   # 92 unit tests: formats, MIDI timing, slice/loop units, theme writing, round-trips
node tests/fuzz.test.mjs     # seeded fuzz — parsers must never throw
node tests/audio.test.mjs    # renders the mix offline: no clipping, correct slice offsets
node tests/e2e.mjs           # 93 browser checks (needs: npm i -D playwright)
```

The parser tests run round-trip checks against real Advance project files when they're present locally; those files are not in this repository.

The USB mirror's font is the 8x8 Wide face and special-glyph page by nILS (public domain), as shipped in the picoTracker firmware. The firmware's other two fonts are not redistributable and are intentionally not embedded.

## Status

Alpha, and versioned accordingly — see the warning at the top before you edit anything. `CHANGELOG.md` records what changed and why, including the bugs found and how they were caught; `ROADMAP.md` lists what's known to be missing, including where playback still differs from the device.

Not affiliated with xiphonics. Use at your own risk — the read-only default, backup-first writes and automatic rollback exist precisely so that risk stays near zero.
