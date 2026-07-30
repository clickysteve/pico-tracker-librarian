# picoTracker Librarian

A librarian for [picoTracker](https://xiphonics.com/) SD cards that runs entirely in your browser — pico and Advance cards alike. Browse projects, instruments, samples and themes; find and repair broken sample references; build lean set exports; export projects as MIDI — all from one HTML file with no install, no server, and no data ever leaving your machine.

Sibling project to [M8 Librarian](https://m8librarian.allmyfriendsaresynths.com), same architecture and safety model.

Requires Chrome or Edge (it uses the File System Access API to read your card; Firefox and Safari don't support it).

## Getting started

1. Open `index.html` in Chrome or Edge.
2. Click **OPEN SD CARD** and pick your picoTracker card (or any folder with the picoTracker layout: `projects/`, `samples/`, `instruments/`, `themes/`, …).

That's it — unlike the M8, picoTracker projects are self-contained (each project folder carries its own `samples/` pool), so missing-sample detection works instantly with no cataloguing step. The library is cached (IndexedDB), so reopening the same card is instant and rescans are incremental.

## What it does

### Browse
- **Projects** — list and grid views with filtering and sorting (name, date, missing samples, instrument count, BPM, size). Expand a project for its instrument bank, sample pool with missing/unused markers, settings, and similar projects (by shared samples). An `autosave` badge flags projects where the device would load newer unsaved state.
- **Instruments** — every `.pti` in `instruments/` plus every project's instrument bank, decoded in full (all parameters, slice points), with type filters (SAMPLE / MIDI / SID / OPAL), sample status, and usage tracking.
- **Samples** — the `samples/` library tree plus every project pool, with duration/rate/bit-depth per WAV, used/unused badges, and arrow-key audition.
- **Themes** — visual previews of every `.ptt` with swatches. **Use** applies a theme's palette to the app itself.
- **Grooves** — every non-default groove across all projects, step-visualised.
- **Renders** — `renders/` and `recordings/` with waveform preview and playback.
- **Stats** — collection KPIs, instrument types, FX command usage, tempo/scale/firmware distributions, backbone samples, recently modified, and the device's `.config.xml`.

### Inspect
- **Pattern viewer** — chain-coloured timeline of all 8 channels, the full song grid, drill-down into chains and phrases with real picoTracker FX names (KIL, HOP, PSL, TBL, …), plus a note histogram with scale detection.
- **Compare** — diff two projects: shared/unique instruments and samples, metadata side by side.
- **MIDI export** — download any project as a standard MIDI file (type 1, 24 PPQ, one track per channel, groove-0 timing, chain + project transpose applied).

### Maintain
- **Problems tab** — missing sample references, unused pool samples (with reclaimable sizes), unused instruments, content-identical samples (byte-level dupe scan), duplicate `.pti` names, stale autosaves, unreadable files, backbone sounds, and the repair log.
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

Everything runs locally. No server, no telemetry, no network access beyond loading the page.

## Format compatibility

File-format knowledge is derived from the open-source [picoTracker firmware](https://github.com/xiphonics/picoTracker) (BSD-3-Clause): the XML project format (`lgptsav.dat` with its run-length/hex `<DATA>` chunk encoding), `.pti` instruments, `.ptt` themes, `.config.xml`, and the frozen FourCC command values. Parsers are deliberately tolerant: unknown instrument types, parameters and elements are preserved and displayed rather than rejected, so newer Advance firmware output should degrade gracefully. Validated against real picoTracker Advance card files spanning firmware 2.0-RC3 through 3.0 (the Advance's `ptsav.dat`, inferred geometry: 256 song rows, 255 phrases, 128 tables, SAMPLESOURCE instruments, nested groove buffers, hex Font values), alongside the pico 2.3 format from the open firmware. Two early beta firmwares (2.0-RC3, 2.2-BETA1) used a short-lived 2-byte command encoding; those files parse with a warning and unknown commands display as hex.

## Development

The entire app is a single `index.html` — deliberately, so it can be hosted anywhere and audited in one read. Internal modules: `PT` (XML parser + format knowledge), `Cache` (IndexedDB), `Scanner`, `Zip` (store-method ZIP writer), `AudioPlayer`, and one UI module.

Tests are zero-dependency Node scripts that extract the `PT` module straight out of `index.html`:

```bash
node tests/parser.test.mjs   # format unit tests (34, incl. Advance format variants)
node tests/fuzz.test.mjs     # seeded fuzz — parsers must never throw
```

Not affiliated with xiphonics. Use at your own risk; the read-only default and backup-first repairs exist precisely so that risk stays near zero.
