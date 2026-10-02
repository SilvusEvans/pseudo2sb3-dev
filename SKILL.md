---
name: pseudo2sb3-dev
description: Develop or use pseudo2sb3, the "pseudocode → Scratch .sb3" tool (Electron; compiles to TurboWarp + Stretch; UI and pseudocode support 简体中文/繁體中文/English/日本語; brand SilvusEvans) — write .pseudo tutorial scripts, compile and export .sb3 from the CLI, add blocks to the compiler / change the DSL / change emission shape, add or change a language's UI strings and block aliases, inspect any .sb3's slots and variable registration, verify a real TurboWarp web import by actually running it, package a Windows portable exe. Use when the user mentions pseudo2sb3, 伪代码转 sb3, Scratch block metadata/catalog/别名与下拉菜单, 多语言/i18n, TurboWarp 导入验证, or asks how a block's slot/menu should be emitted.
argument-hint: "[.pseudo path | block to add | repo dir]"
---

# Pseudocode → .sb3 (pseudo2sb3) development

## Overview

Compiles pseudocode (`.pseudo`) into `.sb3` files that TurboWarp/Scratch can open and run directly, for SilvusEvans's advanced Scratch tutorial videos (the brand was originally Harvesbit, since renamed). The desktop app is Electron; the CLI is `node src/cli.js`.

> `<repo dir>` / `<temp dir>` / `<skill dir>` below are **placeholders** — replace them with
> your own paths. The repo keeps **no git of its own**, so copy it somewhere before bulk edits.
> If your copy sits on a volume that protects pre-existing files (a portable drive, a
> locked-down sandbox), read "Working on a write-protected copy" below first.

The official extension for pseudocode source files is **`.pseudo`**; the legacy `.psb` still works — the open/save dialogs, example loading, and `examples/` scanning all accept both extensions, so old projects don't need renaming.

Architectural decision (do not relitigate): **the source of scratch-vm / scratch-blocks / TurboWarp is the single source of truth for block metadata, and this repo emits `.sb3` itself**, without relying on scratch-vm's serializer.

## Routing by intent

| What the user wants to do | Which path to take |
|:--|:--|
| Write/change a `.pseudo` (tutorial script, example project) | `references/dsl.md` for syntax → `scripts/vocab.mjs --grep keyword` to look up how a block is written → compile → `scripts/inspect-sb3.mjs` to see the shape |
| Translate an example into another language | Follow `examples/snake-en.pseudo`: swap only the identifiers + alias/menu labels (fetch them live with `vocab.mjs --lang xx`), then pin the two sides as equivalent with a "structure fingerprint" and a real-VM assertion |
| Add a block to the tool / wire up an extension | `references/workflow.md` "Standard moves for adding a block" — the 6 steps must stay in order |
| Inspect some `.sb3` (your own artifact or an officially downloaded project) | `scripts/inspect-sb3.mjs file.sb3 [--opcode OP]` — it decodes slots, variable registration, and substack back-pointers |
| Change the Electron UI / export flow | `npm run smoke` (`electron test/electron-smoke.cjs` is the end-to-end assertion) |
| Add/change a language (UI strings, block aliases, menu labels) | The "Multilingual (i18n)" section below — change each of the two chains separately |
| Release | `npm run dist` + the two checks in `references/workflow.md` "Packaging and artifact verification" |

## Six hard rules

1. **Metadata can only be generated, never written from memory.** Opcodes, input/field names, raw dropdown values, and labels all come from the output of `npm run extract-catalog` / `extract-extensions` or from live browser measurement. We once noted down the list-index dropdown as「最后一个」(the last one) when TurboWarp actually shows「末尾」(last); a field hardcoded from memory was missing the variable id, and the connection silently dropped when the project opened. If you can't produce it, go read the vendor source — don't guess.
2. **This compiler's failure mode is silently dropping content, not throwing.** `如果…否则…` (if…else…) once dropped the condition and the entire then branch because the catalog under-declared `CONDITION`/`SUBSTACK`, with no error anywhere in compilation. So every change needs double evidence — "the block shape produced" + "actually run in a real VM or TurboWarp". One without the other does not count as fixed.
3. **An exemption hole in a validation script is a disabled alarm.** The `if (spec.hidden) continue;` in `verifyCatalog` is exactly why the previous incident stayed hidden for so long; `hidden` only means the entry doesn't appear in the UI cheat sheet — the shape still has to be checked. Before you add a whitelist, think hard about what you're giving up.
4. **Field emission has three paths** (statement, hat, reporter), and they must all go through the same `fieldValue()`. Any one of them copying its own shortcut will produce fields with a missing id.
5. **Prefer clones over pen stamps.** The pen layer is a **bitmap** — `图章` (stamp) rasterizes SVG costumes at stage resolution, which throws away rule 6's "prefer SVG assets". To draw the same batch of things repeatedly (snake segments, particles, grid cells), use a clone pool: each clone is a genuine sprite, rendered as vectors, individually controllable, and with no extension dependency. Assets likewise: **prefer SVG** — bitmaps get re-encoded by Scratch and lose quality.
6. **A custom block that does dozens to hundreds of actions in one go must be marked `不刷新`** (warp). If blocks like batch clone creation or list rebuilds don't turn on warp, every loop iteration yields, and dozens of clones slowly pop out one per frame. Conversely, a block containing `等待` (wait) / `说等待` (say for seconds) must **never** turn it on — inside a warp frame, wait doesn't yield properly and spins until the 500ms `WARP_TIME`.

## Multilingual (i18n)

The UI and pseudocode languages are `en` / `zh-Hans` / `zh-Hant` / `ja` — English first, via `LANGS` in `src/core/i18n.js`. English is the runtime default and the fallback for missing translations.
**The two chains are separate — don't mix them up when changing things**:

| What you're changing | Where to change it | How to verify |
|:--|:--|:--|
| UI strings (buttons, menus, dialogs, syntax cheat sheet, stats panel) | `UI` / `SYNTAX` in `src/core/i18n.js` | `test/i18n.test.mjs` (UI strings complete in all four languages); `npm run smoke` |
| Block aliases, structural keywords, menu labels | `src/core/aliases-i18n.js` | `npm run check-catalog` + `npm test` |
| Compiler errors, structural self-check problems | `MSG` (regex template table) in `src/core/i18n.js` | `test/i18n.test.mjs` (messages translated per language) |

Three easy traps:

- **Messages follow a gettext approach — don't change how the compiler writes them internally.** Messages in `compiler.js` / `validate.js` / `build.js` are still all authored in Simplified Chinese, and `PsError` construction and `buildFromSource`'s `problems` pass through
  `translateMessage(lang, zh)` on the way out (the template itself is the key). Simplified-Chinese output is byte-for-byte unchanged, so old assertions are unaffected.
  To add a message, add a `[/^anchored regex$/, {…}]` entry to `MSG`; capture groups map in order to the `{}` placeholders in the template.
- **The menu-label direction is "label → value".** `staticMenu()` writes `{value: label}` in source (e.g. `{last: '末尾'}`),
  but `MENU_I18N` must invert it to `{'末尾': 'last'}`, otherwise `checkStaticMenu` immediately reports "value is not an option".
- **Watch out for aliases that are identical in Traditional and Simplified Chinese**: `augmentCatalog` dedupes, and `verifyCatalog`'s conflict check uses `prev !== key`
  to let through "the same op registering the same alias twice"; cross-op name collisions (e.g. `伸縮にする` given to both looks and stretch) still error
  and need a different wording.

**Examples are language-aware too**: the default example loaded by the "Example" button in the UI (and by an `example` action with no name) is decided by the **UI language**, via `defaultExampleFile()` in `electron/main.cjs`; if that language's variant is missing it falls back to the English one. Every file is named `<english-name>-<lang>.pseudo` — no language gets a bare name — so the set is `hello-en.pseudo` / `hello-zh-Hans.pseudo` /
`hello-zh-Hant.pseudo` / `hello-ja.pseudo`. The examples **listed individually** in the "Load example" menu are still loaded by name (the user clicked a specific file) and are not language-filtered. To add a language variant: add the file → no menu changes needed (the menu scans `examples/` and takes each label from the file's first-line comment) → the default-example logic picks it up automatically. `electron-smoke.cjs` switches to English, clicks "Example" once, and asserts it gets `hello-en.pseudo`.

After any change, always run: `npm run check-catalog` → `npm test` (69 items, including the four-language hello and both the Chinese and English snake examples run for real under green flag in a real scratch-vm)
→ `npm run smoke` (52 end-to-end items, last line `SMOKE PASS`). **Smoke requires a real GUI desktop session**: with no display,
Electron never starts, the process hangs and prints nothing — don't retry it, first confirm you're in a desktop session.

## Working on a write-protected copy

Some volumes treat **pre-existing** files as protected: you may create new files freely but
cannot overwrite or delete the ones already there. Measured on a Windows portable drive:

| Operation on a file that already exists | Result |
|:--|:--|
| create a new file | works |
| `cp src dst` over it | `Permission denied` |
| `rm -f dst` from bash | works (an agent sandbox may have to be disabled for deletes) |
| `fs.rmSync` / `unlink` from node | `EPERM` (with or without an injected Node shim) |

So the pattern is **`rm -f` then `cp`**, one file at a time, with `cmp -s` after every copy.
Two ways to destroy data this way, both hit in practice:

- **Never `rm` before a copy whose source path is relative** to a directory you only `cd`'d
  into inside a subshell. The `rm` (absolute) succeeds, the `cp` (relative, resolved against
  the script's cwd) fails, and the file is simply gone. Use absolute paths on both sides.
- If a long bash script comes back with **no output at all**, treat it as "did not run or the
  output was lost" and re-check the destination before continuing.

Other notes for such a copy:

- `node_modules` (complete, including Electron) and `.ref` may already be present — check
  before reinstalling. `.ref` is just vendored sources and is safe to copy or skip.
- `npm test` and `npm run check-catalog` run fine there (69 tests).
- A `dist/` directory in such a copy is probably a stale build; re-run `npm run dist` if you
  need an exe that matches the current source.
- Some agent harnesses inject a Node shim through `NODE_OPTIONS=--require=…`;
  `env -u NODE_OPTIONS node …` gives you plain node. It only matters for deletes.

## Common commands

```bash
cd <repo dir>
npm run check-catalog                  # trace metadata back to source files and compare
npm test                               # shape assertions + scratch-parser + real scratch-vm execution
node src/cli.js input.pseudo -o out/out.sb3 --parse-check
npm run start                          # Electron desktop app (example menu auto-scans examples/)
npm run dist                           # Windows portable
```

Look up how a block is written (same source as the compiler, so it can't go stale). The repo dir is resolved as "first positional argument > `PSEUDO2SB3_REPO` env var > current working directory", so after `cd <repo dir>` you can just run it:

```bash
node <skill dir>/scripts/vocab.mjs --group events      # a whole group, including hat colons, C-shapes, params and menu values
node <skill dir>/scripts/vocab.mjs --grep list         # keyword filter
node <skill dir>/scripts/vocab.mjs --lang en           # aliases and menu labels in another language
```

Inspect an artifact's shape:

```bash
node <skill dir>/scripts/inspect-sb3.mjs out/out.sb3                       # overview + structural self-check + opcode histogram
node <skill dir>/scripts/inspect-sb3.mjs out/out.sb3 --opcode control_if_else --limit 2
```

## Delivery criteria

See the DoD in `references/workflow.md`: the whole verification chain green **and** the newly wired block has been run under green flag in real TurboWarp **and** (if releasing) the source md5s inside the exe match the workspace and the process starts.

## Boundaries

Deliberately not done: return values from custom blocks, `sensing_of` (the options are only known at runtime), and dropdown menus for hardware extensions (microbit/wedo2/ev3/boost/makeymakey/gdxfor/text2speech).
Planned but not implemented: reverse import `.sb3 → pseudocode` (needs a decompiler + a round-trip histogram comparison).

Known i18n gaps: dropdown options for hardware extensions (microbit/wedo2/…) have no zh-Hant/ja labels, so they can only be written in Chinese or in the English original;
the multilingual labels for the `drum` / `instrument` menus are hand-maintained (`MENU_I18N`) and must be re-checked after an extension version bump.

## Resources

- `references/dsl.md` — pseudocode syntax: skeleton, indentation, assignment/mutation, menu params must be quoted, operators, custom blocks and `不刷新` (warp), prefer SVG assets, known unsupported forms
- `references/sb3-format.md` — `.sb3` block-graph shape: slot encoding `[1/2/3]`, primitive type numbers, variables and lists registered by **key**, static dropdowns as fields vs dynamic menus as shadow blocks, list-index `all/last/random` semantics, TurboWarp `toJSON()` under-reporting
- `references/workflow.md` — project workflow: the 6 steps for adding a block, five historical lessons, the verification-chain commands, the operational order and traps for verifying TurboWarp in the built-in browser, packaging verification
- `scripts/vocab.mjs` — exports the available block list from the project catalog (`--group`/`--grep`/`--lang`/`--json`)
- `scripts/inspect-sb3.mjs` — zero-dependency `.sb3` unpacking and structural self-check; runs on any project

Repo files related to i18n (not inside this skill dir; they live with the repo):

- `<repo dir>/src/core/i18n.js` — language table, UI strings `UI`, syntax cheat sheet `SYNTAX`, message translation table `MSG`, `translateMessage()` / `uiDict()`
- `<repo dir>/src/core/aliases-i18n.js` — `ALIAS_I18N` (148 OPS), `HAT_ALIAS_I18N` (8 HATS), `KEYWORDS_I18N`, `MENU_I18N` / `MENU_I18N_EN`, `GROUP_I18N`, `augmentCatalog()`
- `<repo dir>/test/i18n.test.mjs` — assertions for alias isomorphism across the four languages, menu values, message translation, and string completeness; the "structure fingerprint" comparison at the end (opcode + raw menu values + numeric literals + subtree shape, identifiers masked) pins down that "the same program written in two languages compiles to an isomorphic block tree". It also checks that the in-app syntax cheat sheet compiles in all four languages.
- `<repo dir>/examples/hello-{en,zh-Hans,zh-Hant,ja}.pseudo` — equivalent examples in the four languages; each compiles to the same 50 blocks, giving new aliases automatic coverage
- `<repo dir>/examples/snake-en.pseudo` — the English twin of `examples/snake-zh-Hans.pseudo` (205 blocks, one-to-one). Change either side and you must sync the other: `i18n.test.mjs` compares the structure fingerprint, and `vm-run.test.mjs` runs the same set of "it really plays" assertions on both artifacts. The snake's four assets are stored once under each language's filename (identical content, identical md5ext, so the zip stores only one copy), generated together by `scripts/make-demo-assets.mjs`
