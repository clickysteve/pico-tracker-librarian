# Changelog

## v0.9.14 — the loop round: firmware playback semantics, and eight bits of polish

**Playback now loops the way the device does.** Verified line by line
against the open firmware's Player.cpp: each channel advances through
the song grid independently; a chain ends at its first empty step; and
when a channel's next row is blank (or holds a chain that starts empty),
it loops back to the top of its contiguous group — blanks are loop-block
separators, not rests. A channel whose start cell is blank stays silent,
and content below a gap is only reachable by starting playback there
(the gutter ▶ does exactly that). The song's length is the longest
channel's single pass; looping channels fill it, in playback, in WAV
renders and in stems. MIDI export stays a deliberate linear pass for DAW
use, but no longer exports steps and rows the device can never reach.
The demo card's NIGHTDRIVE was quietly non-idiomatic (staggered entries
via blanks, which the device would never play) and has been fixed.

**The rest of the round:**
- The **PT LIBRARIAN title is a home button** (closes whatever is open,
  back to Projects) and the **version number links to GitHub**.
- **One save bar.** Grid, phrase, chain, table and groove edits now share
  a single consolidated bar anchored to the project workspace, visible on
  every tab, instead of stacking one bar per tab.
- **Set ZIP export unstuck.** File System Access writes cost real time
  per call, and the zip writer was making thousands of tiny ones — the
  export looked hung and the finished file could take an age to appear.
  Writes are now batched into 4MB chunks (the card backup ZIP too), with
  live file/byte progress and an honest "finalising" message, since the
  browser only moves the file into place at the very end — slow on a
  Dropbox-synced destination.
- **⌥↓ / ⌥↑ walk the editor hierarchy**: grid cell → its chain → a
  phrase, and back out, from anywhere in the patterns view.
- **README refreshed** with screenshots throughout.

**Found by review, before shipping**
- Moving the save bar broke the save path's own progress and FAILURE
  messages — a failed write could report nothing at all. Save feedback
  now also mirrors to the status bar, so it cannot be silent.
- ⌥↓ into a chain whose first step is empty opened a "Phrase NaN"
  editor whose edits were silently dropped; the same latent bug was
  reachable by clicking the disabled edit placeholder.
- The playback walk's safety counter could silently truncate dense
  1024-row songs and starve fast-looping channels against slow ones; it
  is now sized from the song's own geometry and tick budget.
- Stems on a project with nothing playable at row 00 threw a raw
  TypeError instead of explaining the (new, device-accurate) reason.

## v0.9.13 — play from here, and an unmissable cursor

Two pieces of real-device feedback.

**Row ▶ plays from that row to the end.** The gutter play button used to
loop one row in isolation; now it starts the full song from that row —
the whole timeline, seeked to where the row begins (rows are not uniform
in time once grooves are involved, so the start comes from the
timeline's own marks). The transport says "from row 07" and the scrub
bar covers the whole song. A spare row past the end of the arrangement
declines with a message rather than surprising you by restarting from
the top.

**The active cell is marked.** The focused cell in the song grid used to
carry a 1px accent outline that vanished entirely inside the
related-chain highlight, which paints the same accent as a solid
background. The active cell now carries a persistent high-contrast
marker (a class, not just `:focus`, so it holds while a picker is open),
readable against the chain highlight, block selection and playhead — and
its row number and channel header light up with it, so you always know
the coordinates of where you are.

## v0.9.12 — six new effects, seven new presets, dice, fonts and shareable looks

**Six new effects**, bringing the chain to twenty-five:

- **Phosphor trails** — a real feedback buffer: last frame's *finished*
  output (glow, masks and all) persists and fades, like a slow
  long-persistence tube. Needs no Motion; trails are temporal by nature.
- **Pixelate** — mosaic the picture down to fat blocks.
- **Hue cycle** — rotate every colour around the wheel, with a speed for
  a slow rainbow. Costs the shader nothing: the rotation rides in the
  same matrix as the channel swap, composed on the CPU.
- **Kaleidoscope** — fold the picture onto itself, left⇄right,
  top⇄bottom or four-way, with the mirror axis sliding in from the edge
  as the amount rises.
- **Refresh bar** — the bright band a camera sees crawling up a CRT.
- **Invert / solarise** — negative at full, solarised part-way.

**Seven new presets**: Oscilloscope (green trails), Rainbow drift,
Broadcast (refresh bar + interlace + band noise), Mosaic, Negative,
Kaleidoscope and Séance (blue trails and ghosting). Seventeen total, all
with audio wiring in place.

**🎲 Random** rolls a curated look: one texture, a colour treatment,
some motion, some shape, some sparkle — drawn from the same instincts as
the hand-made presets, with the destructive extremes kept off the table,
and a route or two wired so it moves with the music. Roll until
something sticks; your own routings survive where the roll keeps the
effect they drive.

**Fonts.** The mirror can draw its text in faces other than the device's
own: Terminal, Typewriter, Clean, Serif, Heavy and Hand, each built at
runtime from fonts your system already has and packed into the same
bitmap format as the built-in face. The special glyphs (meters, note
icons, borders) always stay device-native — those are UI, not text. The
firmware's other two fonts are not redistributable, which is exactly why
these are generated rather than embedded.

**Shareable looks.** ⇩ Look saves the whole effects state (effects,
parameters, routings, output settings) as a small JSON file; ⇪ Look
loads one, through exactly the same sanitiser as stored settings, so a
hand-edited or hostile file gets the same scrutiny. Trade presets.

**Found by review of the above, before shipping**
- Importing a look mid-recording resized the canvas under the capture
  track — the exact corruption the recording lock exists to prevent.
  Import is now held while recording, like the other size controls.
- The kaleidoscope's mix lerped sampling coordinates, which collapsed
  half the picture to a single repeated line at 50%. It now slides the
  mirror axis instead, which is continuous everywhere.
- Pixelate could paint the last partial block row in the letterbox
  colour: the block-centre resample ran before the bounds test and
  stepped out of the picture. With Mosaic's bass-driven block size, the
  strip flickered with the music.
- The Random button kept preset-installed routings as if they were
  yours, discarded the roll's own wiring, and could leave routes driving
  effects the roll had just disabled — which the modulator then spent
  per-frame allocations computing for parameters forced to zero. Routes
  on disabled effects are now skipped outright.
- Re-enabling trails flashed whatever was on screen when they were last
  active; the feedback texture is now cleared on the way back on and on
  output-size changes.
- A failed import (storage quota) silently re-applied the previous look
  while claiming success; the import path no longer round-trips through
  storage at all.
- Changing font with a device connected could leave an unhandled
  promise rejection if the port died mid-refresh.

## v0.9.11 — the feedback round: drawer, routing, stems zip, grid manners

Ten items of real-device feedback, all landed.

**The effects moved into a drawer.** The mirror now owns the Device tab
and the whole effects panel lives in a slide-out sidebar on the right, so
opening it costs the picture some width instead of pushing it off the
bottom of the screen. Single-column cards, remembers whether it was open,
and at narrow windows it overlays the mirror rather than crushing it —
but never the toolbar, which holds the button that closes it.

**Audio routing went per-parameter.** Each effect can now carry up to
three routings, each one mapping a source (bass, mids, highs, level,
transient) to any numeric parameter of that effect — bloom intensity on
the level AND bloom radius on the bass at the same time, each with its
own signed depth. The old one-slot wiring migrates automatically.

**Grid manners.** Clicking an empty cell on the main grid now just
selects it — the picker opens on typing, Enter or a double-click, the
same contract as every other cell in the app. Row paste on the main grid
INSERTS: the copied row lands where you point and everything below moves
down one (with a warning if something would fall off the end of the
format). Phrases and chains keep overwrite-paste, as asked. Every row of
the main grid has a one-click clear in the gutter, and every step row of
the phrase editor has a hover ✕ that clears the whole step, undoably.

**Tables** got the layout asked for: the table list runs down the left,
the editor sits to the right, with a state dot per table (has commands /
empty / locked).

**Stems come down as one zip** instead of a burst of separate downloads,
and both render buttons now show live progress ("⏳ Stem 2/4…") and
refuse re-entry, because the offline render takes a few seconds and a
silent button reads as a broken one.

**The mirror's stand-in text is yours.** A Text field in the effects
drawer replaces the PT LIBRARIAN header on the demo screen, or removes it
entirely when blank. It only affects the stand-in — a connected device
draws its own screen.

**Recording prefers MP4.** The recorder now asks for H.264/MP4 first and
only falls back to WebM on browsers that cannot write it, with the
filename following the container. An MP4 opens in QuickTime, on a phone,
and in every editor; the old WebM often read as "unreadable file"
outside the browser.

**Found by review of the above, before shipping**
- At narrow windows the open drawer covered the toolbar — including the
  only button that closes the drawer, with it open by default. It now
  overlays the mirror only.
- The new gutter clear and insert-paste ignored the read-only gate on
  legacy 2-byte-command projects, stranding un-saveable, un-undoable
  edits in memory. They now honour the same gate as every other mutation
  path, and the demo card gained a legacy project so the gate is tested
  against a real fixture.
- The stand-in header input accepted three more characters than the
  screen can hold, silently losing the tail.
- The Record button's tooltip still said .webm after the MP4 switch.
- Adding an audio routing to an effect enabled the card but not the
  master switch, so the freshly wired route visibly did nothing.

## v0.9.10 — audio-reactive effects, scale lock, generators, annotated song map

**Audio-reactive effects.** The mirror's effects can now be driven from a
live audio input. Pick the interface the picoTracker (or your mixer) is
plugged into and the picture follows what you are actually hearing: there
is no sync problem because it is the real signal, a frame or two behind,
which is invisible for visuals. Bass, mids, highs, overall level and a
transient pulse are each available as a source; every effect that has a
meaningful "more" can be wired to one, with a depth from −100% to +100%
so it can duck on a beat as well as swell on one. Your sliders stay
exactly where you put them and the modulation rides on top. Presets come
with sensible wiring already in place. Nothing is ever routed to the
speakers, and no audio device is opened without a click.

**Scale lock.** The phrase editor knows what key a project is in, from
the project's own setting, from a scale you choose for it, or from the
notes themselves. Out-of-key notes are flagged whether or not the lock is
on. With it on, the note pick-list only offers notes in the key, typed
and piano entry snap, and `+1`/`−1` move by scale degree rather than by
semitone (octaves stay octaves). A one-click **Fix** moves every stray
note to the nearest one in the key, offered only when the scale is
something you or the project stated rather than something we guessed.
A scale chosen here belongs to that project, not to the browser.

**Generators.** A preview-then-apply modal that writes real phrase data:
Euclidean rhythms with rotation, arpeggios over twelve chord shapes in
four patterns, variations of what is already there with a similarity dial
and a reroll, and a humanise pass that writes `VOL` with an accent on the
beat and a seeded spread. Everything is seeded, so the same settings
always give the same phrase and a result you liked can be reached again.
The preview shows before and after for all sixteen steps, nothing is
written until you press Apply, and one undo takes the whole thing back.
A block selection narrows the scope.

**Annotated song map.** A new tab in the project workspace draws the
arrangement wide, with named section bands you drag out over the rows and
notes you pin to a row — "Intro", "drop", "repeat x2". Exports as PNG or
SVG for a setlist or a rehearsal sheet, and saves to
`PTLibrarian_map.json` on the card so a marked-up map travels with the
project instead of living in one browser.

**Also:** the mirror is now pinned to the top of the Device tab and the
effects panel scrolls under it, so opening the panel can no longer push
the thing you are looking at off the screen.

**Found by review of the above, before shipping**
- Escape and the arrow keys closed or navigated the project modal out
  from under an open generator. Apply then wrote into a project the app
  had already let go of: it reported writing the bars and silently
  discarded them, or flagged a *different* project as having unsaved
  edits it never had.
- Song-map annotations were keyed by project directory name and never
  cleared when a different card was opened. Directory names collide
  across cards routinely, so one press of "Save to card" could overwrite
  another card's annotations with the previous card's.
- The Euclidean generator marked the last step of each group rather than
  the first, so every pattern came out rotated by one and the default
  settings cleared the downbeat — exactly where the kick was.
- Unsaved song-map annotations did not count as unsaved work, so closing
  the tab threw them away with no prompt.
- Opening the map tab clamped every section and note to the current song
  length and kept the clamped values. Shortening an arrangement (or
  undoing through an empty grid) collapsed the whole markup onto one row
  for good. The stored values are now left alone and only the drawing is
  clamped, with a note when something sits past the end.
- A scale chosen in one project governed note entry in every other
  project and every later session, including offering to rewrite notes
  into a key that project was never in.
- The humanise preview only ever rendered FX 1, so writing into FX 2
  looked like it was about to destroy whatever FX 1 held — and could
  disable Apply while there were real changes to make.
- The variation preview claimed the instrument column was being cleared
  on notes it emptied, which Apply did not do.
- Every generator slider was click-only: each `input` rebuilt the form
  and destroyed the element the drag was captured on.
- The generator's chosen instrument survived between projects, so it
  could write an instrument id that does not exist in the project you
  are in, or silently fall back to `00`.
- Drag-to-create-a-section stopped working while a label field had focus.
- A block selection that excluded the columns a generator writes to was
  silently widened; it is now called out.
- A no-op Apply, and a no-op scale Fix, cleared the redo stack.

## v0.9.9 — output effects for the screen mirror

The USB mirror can now be run through a chain of GPU effects and captured,
which turns it from a debugging view into something you can put on a stream,
a projector or a video. The effect list, parameter ranges and most of the
tuned constants are lifted from [DMG Darkroom](https://github.com/clickysteve/dmg-darkroom),
whose filters do the same job to a still Game Boy Camera photo. There they
are 2D-canvas passes over one image; here they are reworked as a single
WebGL shader pass because this has to hold 60fps on live video.

**Nineteen effects**, applied in a fixed order regardless of the order you
switch them on: screen curve, wave warp, scanline jitter, block glitch, RGB
offset, RGB planes, VHS ghosting, channel swap, colour grade, phosphor tint,
phosphor glow, CRT scanlines, LCD panel, pixel grid, dot matrix, interlace,
noise, vignette and posterise/dither. Ten presets to start from — CRT
monitor, arcade tube, VHS tape, handheld LCD, dot matrix, green and amber
phosphor, glitch and projector — and a Custom slot the moment you touch
anything. Settings persist across sessions.

**Built for capture, not just for looking at**
- **Output size** of 960×720, 1440×1080, 1280×720 or 1920×1080. The 16:9
  sizes pillarbox the 4:3 screen rather than stretching it, so an OBS scene
  needs no cropping; **Fill** overscans instead if you would rather crop the
  sides than live with bars, and **Bars** sets their colour so they can be
  keyed out.
- **Record** straight to a `.webm` from the output canvas.
- **Pop out** now drives its own frames, so the popped-out mirror keeps
  running when you switch away from this tab — which is exactly when it is
  being captured on the other screen.
- **Full screen** letterboxes properly at the 16:9 sizes.
- A **stand-in screen** is drawn before anything is connected, so a look can
  be dialled in without the hardware to hand.
- Nothing is ever sent to the device: this is all display-side.

Effects need WebGL. Without it the mirror still works, still honours the
output size, fill, bars, pop-out and recording, and says so.

**Found by review of the above, before shipping**
- Two mask effects "compensated" for the light they removed by brightening
  the whole fragment, including the parts they had never darkened. At the
  shipped Dot matrix preset every colour on the screen clipped to white.
  The gain is now rescaled by the peak channel, which preserves hue.
- The glow was blurred from the flat, un-letterboxed source, so it painted a
  ghost of the screen across the bars and the bezel, and stayed still while
  the picture curved, rippled or tore.
- The glow had no bright-pass at all, so the screen blend lifted the black
  background as much as the text and the picture went milky rather than the
  highlights glowing. There is now a Threshold control.
- Scanlines and the LCD grille were measured in output pixels while every
  other mask was measured in device pixels, so they beat against each other
  and against the curve, and drifted between output sizes.
- Corner radius did nothing unless Curvature was above zero.
- Recording a still screen with the effects off produced a one-frame file,
  because the canvas was only redrawn when something changed and
  `captureStream` only emits on a draw.
- Capture tracks were never stopped, so every recording left a live track
  attached to the output canvas for the rest of the session.
- Changing the output size or hitting Reset mid-recording resized the canvas
  under the capture track. Those controls are now held while recording.
- Reset also threw away the output size, fill and bar colour; it now clears
  the look and leaves the plumbing alone.
- A failed `MediaRecorder.stop()` stranded the captured chunks with no file
  and no message, and a recorder that errored on its own left the button
  saying "Stop recording" forever.
- Re-opening the pop-out after reloading this page stacked a second canvas
  into the old window instead of replacing it.
- With no WebGL the preset dropdown still ticked the master switch and lit
  up the effect cards while the picture never changed.
- Jitter used one random number for both "is this row affected" and "how
  far", so every affected row moved almost the full distance, always the
  same way.
- Posterise produced N+1 tones rather than N, so "2" was not 1-bit.
- The bottom fifth of the Bloom radius slider was clamped away and did
  nothing.
- Animated grain, jitter and glitch froze after about an hour of streaming,
  once page-uptime-in-seconds outgrew a float32 mantissa inside the hash.
  Every time-dependent term is now quantised and wrapped on the CPU.
- Clicking a segmented option in the effects panel left it focused, so the
  next keystroke fired the app-wide tab shortcuts.
- WebGL context loss left the mirror black for the rest of the session with
  no explanation; a failed shader compile leaked the context it had opened.
- Noise, vignette, glare and backlight bleed painted over the letterbox
  bars, which defeats keying them out.
- Effect sliders had no accessible name and the segmented buttons exposed
  no selected state.

## v0.9.8 — the big editing round

Eighteen requested items, then an adversarial review of the result which
found eleven more defects in the new code; those are listed after.

**Editing**
- **One undo history per project** covering the song grid, chains, phrases,
  tables and grooves, with redo (`⌘/Ctrl+Z`, `⇧⌘Z`). It no longer resets
  when you move between phrases, and the two separate stacks are gone.
- **Consistent cell interaction everywhere.** Click selects, `Enter` or
  typing opens the pick-list, `Delete` clears. Chain cells opened the
  picker on a plain click, so `Delete` could never reach them.
- **Auto-advance is one setting** shared by typing, picking and the piano,
  with a switchable toggle and an edit step of 1–8.
- **Reach any chain or phrase** without touching the arrangement, via
  **⤳ Go to…** — including slots that aren't placed in the song.
- **Clone** on chains and phrases. A chain clone repoints the grid cells
  that used it; a phrase clone repoints only the chain step you came from,
  so a shared phrase can be varied in one place.
- **Shared-phrase warning.** The phrase header now states where it's used
  and flags when editing it will change several chains at once.
- **Breadcrumb** from a phrase back to the chain and step you opened it from.
- **Block selection in the phrase editor** over steps *and* columns, with
  copy, paste and clear, matching the song grid. Transpose applies to the
  selection when one is active.

**Playback**
- **Space plays what you're looking at** — the open phrase, else the open
  chain, else the whole song.
- **Scrub** the transport bar to jump around, and a **loop** toggle.
- **Playheads everywhere**: the grid cell, row, chain list entry, chain step
  and now the phrase step.

**New**
- **Render to WAV**, and **render stems** (one file per channel that plays),
  using the same scheduling as the player so a render matches the preview.
- **Create a project** on the card from scratch.
- **Table and groove editing**, in a new tab in the project workspace.
- **Chain colours as a sidecar** (`PTLibrarian_colours.json`) so they travel
  with the card instead of living in one browser.
- **Save preview**: see exactly which grid cells, chains, phrases, tables and
  grooves are about to change before anything is written.

**Found by review of the above, before shipping**
- Undo didn't snapshot tables, so `⌘Z` after a table edit reverted an
  unrelated earlier edit instead.
- Groove edits never rebuilt the digest the player, MIDI export, renders and
  the length readout all read — so the app and the device disagreed.
- A self-closing `<TABLE/>` in the file couldn't be rewritten, and saving
  rewrote *every* table, so one empty table aborted the whole save and rolled
  back unrelated work. Only changed, writable tables are rewritten now, and
  the editor says when a table can't be edited.
- Seeking and looping fired the caller's `onEnd`, tearing down the transport
  while audio carried on, and re-decoded the entire sample pool on every
  pointermove while dragging.
- The save preview's baseline was never refreshed after a save, so a second
  save listed changes already written.
- The preview ignored tables and grooves entirely, telling you nothing had
  changed and then writing it anyway.
- `beforeunload` didn't count table or groove edits.
- Phrase block paste ignored the source columns, so a 16-bit param could land
  in the note column and truncate to an invalid note.
- Undo snapshots were pushed before validation, so a rejected keystroke wiped
  the redo stack.
- The new-project template used single 4096-byte run chunks where the firmware
  writes 64-byte ones; now it uses the same encoder as every other write.
- Escape left the save preview orphaned over a closed project.

## v0.9.7 — data-loss fixes, arrangement undo, optional piano entry

Two independent reviews of the editor found the same cluster of data-loss
bugs. These were live in 0.9.2–0.9.6. If you edited an arrangement in
those versions, check your projects against your backups.

- **Reopening a project destroyed its unsaved edits, then reported saving
  them.** `openProjModal` always re-read the card and replaced the cached
  parse, but the dirty flags survived — so the save bar still offered to
  save, and Save wrote the *original* bytes back, verified them
  successfully, and wrote a line into the on-card audit log describing an
  edit that never happened. The cached parse is now kept whenever it holds
  unsaved work.
- **Escape closed the project.** In the song grid it cleared the selection
  and then bubbled to the global handler, which closed the modal, straight
  into the bug above; in the phrase and chain editors it closed the modal
  outright. Escape now stays inside the editor, and closing a project with
  unsaved edits asks first. Closing the tab does too.
- **Selection, focus and clipboards leaked between projects.** A block
  selected in one project stayed selected, and focused, after navigating to
  the next — so `Delete` could wipe rows in a project you never touched,
  and paste could write one song's chain numbers into another's. All
  per-project editor state resets on project switch.
- **Any rescan discarded grid-only and chain-only edits**, because the
  guard checked only `dirtyPhrases`. Saving slices, restoring from trash or
  pressing Rescan silently lost arrangement work.
- **Emptying the grid removed the editor.** `Ctrl+A` then `Delete` left a
  static "Song grid is empty" message with no save, no discard and no way
  back — and no way to place a first chain in a new project either.
- **Undo for the arrangement.** The song grid and chain editor had none;
  `Ctrl+Z` now steps back through 50 changes to the grid, chains and
  transposes. **Discard** now says what it is about to throw away.
- **Rollback no longer reverts a good save.** The rollback window covered
  the whole save, including steps after verification succeeded, so a
  failure while refreshing the view would have reverted a correct write.
- **Save ignores a second click** while one is in flight.
- Instrument and FX fields rejected values above range but not below;
  `-1` wrapped to `0xFF` and wrote an undefined command to the card.

New:

- **Optional QWERTY piano entry** in the phrase editor, off by default.
  `z s x d c v g b h n j m` plays C–B, `q 2 w 3 e r 5 t 6 y 7 u` the octave
  above, `a` is note-off, `[` and `]` change octave. Each entry carries the
  instrument down from the step above and advances by a configurable edit
  step, so a melody is typed down one column. Modifier combinations still
  reach the editor, so `⌘Z` undoes rather than typing a note.

## v0.9.6 — block selection, real delete, experimental warning

- **Block selection in the pattern editor.** Shift+arrows or shift+click
  mark a rectangle of grid cells; `⌘/Ctrl+C` and `⌘/Ctrl+V` copy and paste
  it as a block, `Del` clears it, `⌘/Ctrl+A` selects everything and `Esc`
  deselects. A single cell is just a 1×1 block, so copy, paste and clear
  have one code path rather than two. Pasting clips at the grid edges
  rather than wrapping.
- **True sample delete, with a way back.** Cleanup still moves unused pool
  samples to `PTLibrarian_Trash/` rather than deleting them; a new
  **Trash** tab lists what's in there with its size and origin, and offers
  **Restore** (back to the project's pool, verified, and refused if a file
  of that name has reappeared there) or **Delete** permanently, per file or
  all at once. Both are confirmed and audit-logged.
- **Experimental warning** in the app header and at the top of the README:
  this writes to your SD card, the editing features are new, back your
  projects up first.

## v0.9.5 — docs rewritten, consistent cell editing

- **README rewritten and audited against the code**, not against memory.
  Corrections found while checking: the instrument type filter list was
  missing `SAMPLESOURCE`; MIDI export writes a tempo track plus one track
  per channel *that plays anything*, not simply one per channel; the
  module list omitted `Demo`, `USB` and `SongPlayer`; the remote-input
  section described an opt-in mode that is in fact hidden and never sends
  anything; and several sections still described the zoom slider and
  timeline removed in 0.9.2. Editing, playback, the transport, setlists,
  cleanup-to-trash and the theme creator were absent entirely.
- **Typing on a cell now opens its pick-list, pre-filtered**, instead of
  falling back to a raw text box. Clicking and typing on the same cell
  behaved differently, which also made the docs hard to write honestly.
  Removed the dead text-input path this left behind.
- **ROADMAP rewritten** with the real remaining gaps, including an honest
  section on where playback still differs from the device.

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
