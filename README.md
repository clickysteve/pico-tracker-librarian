# picoTracker Librarian

A librarian for [picoTracker](https://xiphonics.com/) SD cards that runs entirely in your browser — pico and Advance cards alike. Browse projects, instruments, samples and themes; find and repair broken sample references; build lean set exports; export projects as MIDI — all from one HTML file with no install, no server, and no data ever leaving your machine.

Sibling project to [M8 Librarian](https://m8librarian.allmyfriendsaresynths.com), same architecture and safety model.

Requires Chrome or Edge (it uses the File System Access API to read your card; Firefox and Safari don't support it).

## Getting started

1. Open `index.html` in Chrome or Edge (or the hosted page).
2. Click **OPEN SD CARD** and pick your picoTracker card (or any folder with the picoTracker layout: `projects/`, `samples/`, `instruments/`, `themes/`, …).

No card handy? Hit **Try with demo data** on the landing screen — a synthetic card (generated audio included) loads entirely in memory so you can explore every tab, the pattern viewer, and the repair flow.

That's it — unlike the M8, picoTracker projects are self-contained (each project folder carries its own `samples/` pool), so missing-sample detection works instantly with no cataloguing step. The library is cached (IndexedDB), so reopening the same card is instant and rescans are incremental.

Cards that have been near a Mac collect AppleDouble junk (`._kick.wav`, `.DS_Store`, `.Spotlight-V100`). These are skipped everywhere — scans, listings and exports — so they never show up as phantom samples.

## What it does

### Browse
- **Projects** — list and grid views with filtering and sorting (name, date, missing samples, instrument count, BPM, size). Expand a project for its instrument bank, sample pool with missing/unused markers, settings, and similar projects (by shared samples). An `autosave` badge flags projects where the device would load newer unsaved state.
- **Instruments** — every `.pti` in `instruments/` plus every project's instrument bank, decoded in full (all parameters, slice points), with type filters (SAMPLE / MIDI / SID / OPAL), sample status, and usage tracking.
- **Samples** — the `samples/` library tree plus every project pool, with duration/rate/bit-depth per WAV, used/unused badges, and arrow-key audition.
- **Themes** — visual previews of every `.ptt` with swatches, and the device's active theme flagged. **Preview** applies a palette to the app itself; **Set on device** writes it into the card's `.config.xml` (backed up, verified, rolled back on failure) so the tracker boots with it; **Save device colours as .ptt** captures the current device palette as a new theme file.
- **Grooves** — every non-default groove across all projects, step-visualised.
- **Renders** — `renders/` and `recordings/` with waveform preview and playback.
- **Stats** — collection KPIs, instrument types, FX command usage, tempo/scale/firmware distributions, backbone samples, recently modified, and the device's `.config.xml`.

### Play & edit
- **Transport** — a bar along the bottom shows what's playing, how far through it is, and stops it from anywhere; the playing project's row stays visibly lit. While anything plays, the song grid outlines the cell each channel is inside, lights the chains in play, and marks the current step of the open chain.
- **In-browser playback** — press Play on any project and hear it: a Web Audio engine walks the song exactly like the firmware player (grooves, GRV switches, HOPs, chain + project transpose) triggering the project's own pool samples, with slices, loop modes, and VOL/PAN/KIL honoured. Slice and loop points are converted through each WAV's own sample rate, so playback is in time regardless of your machine's audio rate. An honest sketch of the song, not a device emulator: synth voices (SID/OPAL) and most FX are out of scope by design.
- **Phrase editor** — a tracker-style grid you edit in place: arrows and Tab move the cursor, typing starts an edit, Enter commits and drops to the next step, Delete clears a cell. Notes, instruments and FX commands are chosen from filterable pick-lists — instruments show their names, FX show `KIL`/`HOP`/`PSL` rather than raw hex — so nothing depends on remembering a number. Insert or delete a step (shifting the rest of the phrase), per-step copy/paste (⌘/Ctrl+C/V), whole-phrase copy/paste/clear, one-click transpose (±1/±12), 50-level undo (⌘/Ctrl+Z), and a ▶ that auditions just that phrase. Edits are held in memory until you explicitly save; saving uses the same paranoid path as repairs (mtime guard, on-card backup, byte-level verification of every phrase buffer after the write, automatic rollback). Legacy 2-byte-command beta files are read-only.

- **Slice editor** — open any sample instrument's wav on a big waveform: zoom in with the scroll wheel or the −/+/Fit buttons (a full-file strip underneath shows where you are and drags to scroll), drag slice markers, double-click to add, audition slices by clicking regions or with number-key pads, auto-chop breakbeats with transient detection (adjustable sensitivity), equal-divide clean loops, and snap everything to zero-crossings. Saving rewrites just that instrument's SLnn points with the usual backup + verify + rollback.

### Arrange
- **Pattern editor** — the song grid at full size with a ▶ on every row that plays that row across all 8 channels, an ordered chain list down the left (bucketed by number group, with usage counts, colours, preview and hover-to-highlight), and chain/phrase detail panels beside the grid. Click any grid cell to pick the chain that sits there from a filterable list of the chains this song already uses (with colours and usage counts), the ones defined but unplaced, and free slots; open a chain to pick each of its 16 phrases the same way, alongside a per-step transpose. Spare rows sit past the end of the song so the arrangement can be extended, whole rows copy and paste, and nothing has to be typed from memory though a raw hex value is still accepted. Arrangement edits are held in memory and written through the same backup-verify-rollback path as everything else. Chain colours are derived from the chain number: the high nibble picks a hue family so the 00s, 10s and 20s each read as a group, while lightness strides within a group to keep neighbours distinct.
- **Project overview** — four headline cards (BPM, playback length, scale, samples) over grouped Song / Instruments / File panels, a clickable full-width song map, FX-usage and groove summaries, collapsible instrument and sample sections, grouped instrument parameters with level bars, and auditionable sample rows with one-click access to the slice editor.
- **Compare** — diff two projects: shared/unique instruments and samples, metadata side by side.
- **MIDI export** — download any project as a standard MIDI file (type 1, 24 PPQ, one track per channel, chain + project transpose applied, per-channel GRV groove switches and HOP flow honoured).

### Device (USB)
- **Live screen mirror** — connect the picoTracker over USB (WebSerial) and watch the device screen in the browser, rendered pixel-for-pixel with the device's own bitmap font, with full-refresh requests and PNG capture.
- **Experimental remote input** — an opt-in mode that sends button presses (keyboard or on-screen pad) as a proposed `FE 03` key-state opcode. Stock firmware ignores it by design; this is the client half of a protocol proposal for the firmware side, ready the day a firmware speaks it. Reachable straight from the landing page, no SD card needed. Requires the https:// page (WebSerial only exists in secure contexts). View-only: stock firmware does not accept remote key input yet. Implements the firmware's Remote UI protocol.

### Maintain
- **Problems tab** — missing sample references, unused pool samples (with reclaimable sizes), unused instruments, content-identical samples (byte-level dupe scan), duplicate `.pti` names, stale autosaves, unreadable files, backbone sounds, and the repair log.
- **Fix all exact matches** — one-click batch repair: every missing reference with an exact-name copy elsewhere on the card (library or another pool) is restored by file copy, verified, and audit-logged.
- **Extract as .pti** — pull any instrument out of a project bank into `instruments/` as a `.pti` file (or download it if the card is read-only).
- **Repair mode** — two fixes for a broken reference: *copy* a matching WAV from the library or another project's pool into this project's pool (no project-file edit), or *re-point* the reference to an existing pool sample by rewriting only that attribute inside `lgptsav.dat`.
- **Backup** — copy the card to a folder or download it as a ZIP, with per-directory selection (`.config.xml` and `.current` always included).
- **Setlists** — click projects to add them to an ordered setlist, drag or ▲▼ to reorder, then export a lean, card-ready `projects/` layout as a folder or ZIP. Folders can be numbered (`01_`, `02_` …) so the device lists them in playing order. Setlists can be named and saved, order included.

## The safety model

The card is opened **read-only**. Nothing is written unless you explicitly confirm a repair or an export:

- Write permission is requested only when you press Apply.
- Before a project-file rewrite, the original is copied to `PTLibrarian_Backups/<timestamp>/` on the card.
- The file's modification time is checked against the scan first; if the project changed since (say, you saved on the device), the repair refuses and asks for a rescan.
- After writing, the file is re-read and re-parsed and the repaired reference verified. If verification fails, the original is restored automatically.
- Every repair is recorded in the browser and appended to `PTLibrarian_Backups/audit-log.txt` on the card.

Everything runs locally. No server, no telemetry, no network access beyond loading the page. The hosted page installs as an offline-capable PWA (service worker, cache-first).

## Format compatibility

File-format knowledge is derived from the open-source [picoTracker firmware](https://github.com/xiphonics/picoTracker) (BSD-3-Clause): the XML project format (`lgptsav.dat` with its run-length/hex `<DATA>` chunk encoding), `.pti` instruments, `.ptt` themes, `.config.xml`, and the frozen FourCC command values. Parsers are deliberately tolerant: unknown instrument types, parameters and elements are preserved and displayed rather than rejected, so newer Advance firmware output should degrade gracefully. Validated against real picoTracker Advance card files spanning firmware 2.0-RC3 through 3.0 (the Advance's `ptsav.dat`, inferred geometry: 256 song rows, 255 phrases, 128 tables, SAMPLESOURCE instruments, nested groove buffers, hex Font values), alongside the pico 2.3 format from the open firmware. Two early beta firmwares (2.0-RC3, 2.2-BETA1) used a short-lived 2-byte command encoding; those files parse with a warning and unknown commands display as hex.

## Development

The entire app is a single `index.html` — deliberately, so it can be hosted anywhere and audited in one read. Internal modules: `PT` (XML parser + format knowledge), `Cache` (IndexedDB), `Scanner`, `Zip` (store-method ZIP writer), `AudioPlayer`, and one UI module.

Tests are zero-dependency Node scripts that extract the `PT` module straight out of `index.html`:

```bash
node tests/parser.test.mjs   # format unit tests (92: formats, MIDI timing, slice/loop units, theme writing)
node tests/fuzz.test.mjs     # seeded fuzz — parsers must never throw
node tests/audio.test.mjs    # renders the mix offline: no clipping, correct slice offsets
node tests/e2e.mjs           # browser end-to-end, 85 checks (needs: npm i -D playwright)
```

The USB mirror's font is the 8x8 Wide face and special-glyph page by nILS (public domain), as shipped in the picoTracker firmware; the firmware's other two fonts are not redistributable and are intentionally not embedded.

Not affiliated with xiphonics. Use at your own risk; the read-only default and backup-first repairs exist precisely so that risk stays near zero.
