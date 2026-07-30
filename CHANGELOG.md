# Changelog

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
