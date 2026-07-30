# picoTracker Librarian

A librarian for [picoTracker](https://xiphonics.com/) SD cards that runs entirely in your browser — pico and Advance cards alike. Browse projects, instruments, samples and themes; find and repair broken sample references; build lean set exports; export projects as MIDI — all from one HTML file with no install, no server, and no data ever leaving your machine.

Sibling project to [M8 Librarian](https://m8librarian.allmyfriendsaresynths.com), same architecture and safety model.

Requires Chrome or Edge (it uses the File System Access API to read your card; Firefox and Safari don't support it).

## Getting started

1. Open `index.html` in Chrome or Edge (or the hosted page).
2. Click **OPEN SD CARD** and pick your picoTracker card (or any folder with the picoTracker layout: `projects/`, `samples/`, `instruments/`, `themes/`, …).

No card handy? Hit **Try with demo data** on the landing screen — a synthetic card (generated audio included) loads entirely in memory so you can explore every tab, the pattern viewer, and the repair flow.

That's it — unlike the M8, picoTracker projects are self-contained (each project folder carries its own `samples/` pool), so missing-sample detection works instantly with no cataloguing step. The library is cached (IndexedDB), so reopening the same card is instant and rescans are incremental.

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
- **In-browser playback** — press Play on any project and hear it: a Web Audio engine walks the song exactly like the firmware player (grooves, GRV switches, HOPs, chain + project transpose) triggering the project's own pool samples, with slices, loop modes, and VOL/PAN/KIL honoured. An honest sketch of the song, not a device emulator: synth voices (SID/OPAL) and most FX are out of scope by design.
- **Phrase editor (experimental)** — drill into any phrase and edit notes, instruments, and FX commands in place, with one-click transpose (±1/±12). Edits are held in memory until you explicitly save; saving uses the same paranoid path as repairs (mtime guard, on-card backup, byte-level verification of every phrase buffer after the write, automatic rollback). Legacy 2-byte-command beta files are read-only.

- **Slice editor** — open any sample instrument's wav on a big waveform: drag slice markers, double-click to add, audition slices by clicking regions or with number-key pads, auto-chop breakbeats with transient detection (adjustable sensitivity), equal-divide clean loops, and snap everything to zero-crossings. Saving rewrites just that instrument's SLnn points with the usual backup + verify + rollback.

### Inspect
- **Pattern viewer** — chain-coloured timeline of all 8 channels, the full song grid, drill-down into chains and phrases with real picoTracker FX names (KIL, HOP, PSL, TBL, …), plus a note histogram with scale detection.
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
- **Sets** — tick projects and export a lean, card-ready `projects/` layout as a folder or ZIP. Sets can be named and saved for reuse.

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
node tests/parser.test.mjs   # format unit tests (38: formats, MIDI timing, theme writing)
node tests/fuzz.test.mjs     # seeded fuzz — parsers must never throw
node tests/e2e.mjs           # browser end-to-end (needs: npm i -D playwright)
```

The USB mirror's font is the 8x8 Wide face and special-glyph page by nILS (public domain), as shipped in the picoTracker firmware; the firmware's other two fonts are not redistributable and are intentionally not embedded.

Not affiliated with xiphonics. Use at your own risk; the read-only default and backup-first repairs exist precisely so that risk stays near zero.
