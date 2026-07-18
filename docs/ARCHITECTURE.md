# Flow CLI Architecture

Flow CLI is a terminal-native Markdown editor. Markdown source remains the
canonical document format while the app presents common authoring structures as
readable terminal surfaces.

## Layers

1. `src/engine/` owns format-agnostic editing, terminal input, layout, frames,
   widgets, rendering, and hosting.
2. `src/markdown/` owns Markdown parsing, presentation, commands, syntax
   highlighting, export helpers, and portable editor services. It may depend on
   `src/engine/` and Markoffset.
3. `src/app/` owns the executable, product shell, documents, settings, and
   platform adapters. It may depend on both lower layers.

Dependencies point from app to Markdown to engine. The lower layers stay
terminal-editor focused and avoid app policy.

## Document lifecycle

An explicit path opens that Markdown file, or creates a buffer bound to that
path when it does not exist. Starting without a path creates an untitled identity
in `~/Documents`; the file is written by the first autosave.

Markdown source remains canonical. Editor changes update the document session
and always schedule an atomic autosave. The session compares current content
with the last saved content to derive dirty state. Saves stage a unique file
beside the destination, sync it, and rename it atomically. Before replacing an
existing file, Flow CLI compares its current version with the version observed
at open or at the previous save. A mismatch requires an explicit overwrite or
reload choice.

Flow CLI preserves literal Markdown newline behavior: Enter inserts one newline,
and a blank line separates Markdown paragraphs.

Exit requests are delegated by the Node host to the app. Flow CLI reserves
`Ctrl+C` for standard clipboard behavior and uses `Ctrl+Q` for exit. Clipboard
shortcuts also accept Command when the terminal forwards Meta-modified keys.
Flow CLI requests extended keyboard reporting from compatible terminals, while
terminals that reserve Command shortcuts retain their native behavior. Clean
documents exit immediately; dirty documents require save, discard, or
cancellation. Failed saves remain visible and never produce a success-shaped
exit.

## Shell composition

The shell owns a `File / Edit / View / Insert / Format / Help` menu row and a
compact final status row. Menu items reuse the same command objects as the
command palette, including dynamic enabled and checked state. Dropdowns overlay
only their measured menu box and preserve editor content outside it. The status
row shows mode shortcuts and essential keyboard hints with a right-aligned word
count; its mode labels support both function keys and mouse selection.
Transient messages and confirmation prompts use the same row.

Open uses a compact bottom-sheet file browser rooted at the current document's
folder. A responsive grid shows visible folders and `.md` files only; keyboard
and mouse input open files, enter folders, and use a leading `..` entry or
Backspace to return to parent folders.

Focus mode removes both shell rows and the scrollbar, expands the editor across
the full terminal with the editor background, and returns to Edit mode on
Escape. Presentation modes are session-only: every app boot starts in Edit mode,
and mode changes are not persisted with user settings.

The editor body wraps at 80 terminal columns without horizontal scrolling. One
column or row of padding surrounds it, creating a centered maximum-width
82-column surface with symmetric exterior margins. A shell-owned scrollbar
occupies the rightmost column and uses the engine's public vertical scroll state
and commands. Palette, prompt, Help, and About overlays reserve compact rows
above the status bar. Narrow terminals truncate cells without corrupting
graphemes.

Settings use a shell-owned overlay backed by the settings service. The theme
picker includes Basic Light, Basic Dark, Latte, Mocha, Solarized Light, and
Solarized Dark palettes through terminal semantic roles, including an
accent-colored hardware cursor, list markers, and blockquote rule. Blockquote
content uses each palette's tertiary background. Settings are split into Themes
and Editor sections so navigating to cursor shape and blinking controls does not
preview themes. Selection previews immediately, Enter persists, and Escape
restores the previous settings.

## Product scope

Flow CLI implements a single-document lifecycle, Edit/Focus/Read/Source modes,
Markdown and app commands, find/replace, links and images, clipboard,
settings/themes/keybindings, autosave/recovery, HTML/plain-text exports, and
Help/About. Native GUI chrome, dialogs, and auxiliary windows are replaced by
terminal commands and overlays.

Spellcheck suggestions, binary DOCX/PDF export, and project navigation remain
later terminal-product work. The Markdown layer exposes lint and portable export
contracts, but app policy and terminal interaction belong in `src/app/`.

## Validation

Run `npm run verify` in this package.
