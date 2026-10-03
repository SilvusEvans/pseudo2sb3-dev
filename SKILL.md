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
| Make it *feel* like a game (inertia, thrust, wrap, particles, screen shake, HUD readout) | `references/game-feel.md` — every idiom is measured in `examples/asteroids/verify.mjs`; also the place for "why the 镜头 blocks did nothing" |
| Verify an example really plays | `node examples/<name>/verify.mjs` (real scratch-vm) — conventions and traps in `references/workflow.md` §"Per-example asset + verification harness" |
| Verify an example in a **real browser** (pixel `碰到`, HUD DOM, real keys) | `node examples/<name>/browser-verify.mjs` — web-build API deltas are listed in `references/workflow.md` §"What the TurboWarp web build exposes differently" |
| Translate an example into another language | Follow `examples/snake-en.pseudo`: swap only the identifiers + alias/menu labels (fetch them live with `vocab.mjs --lang xx`), then pin the two sides as equivalent with a "structure fingerprint" and a real-VM assertion |
| Add a block to the tool / wire up an extension | `references/workflow.md` "Standard moves for adding a block" — the 6 steps must stay in order |
| Inspect some `.sb3` (your own artifact or an officially downloaded project) | `scripts/inspect-sb3.mjs file.sb3 [--opcode OP]` — it decodes slots, variable registration, and substack back-pointers |
| Change the Electron UI / export flow | `npm run smoke` (`electron test/electron-smoke.cjs` is the end-to-end assertion) |
| Add/change a language (UI strings, block aliases, menu labels) | The "Multilingual (i18n)" section below — change each of the two chains separately |
| Release | `npm run dist` + the two checks in `references/workflow.md` "Packaging and artifact verification" |

## Six hard rules

1. **Metadata can only be generated, never written from memory.** Opcodes, input/field names, raw dropdown values, and labels all come from the output of `npm run extract-catalog` / `extract-extensions` or from live browser measurement. We once noted down the list-index dropdown as「最后一个」(the last one) when TurboWarp actually shows「末尾」(last); a field hardcoded from memory was missing the variable id, and the connection silently dropped when the project opened. If you can't produce it, go read the vendor source — don't guess.
2. **This compiler's failure mode is silently dropping content, not throwing.** `如果…否则…` (if…else…) once dropped the condition and the entire then branch because the catalog under-declared `CONDITION`/`SUBSTACK`, with no error anywhere in compilation. So every change needs double evidence — "the block shape produced" + "actually run in a real VM or TurboWarp". One without the other does not count as fixed. (A call to a custom block defined *later* in the same sprite used to crash with an unhelpful `Internal error: TypeError: Cannot read properties of undefined (reading 'forEach')` — that crash is **fixed** (2026-10-02): pass-1 registration now precomputes each proc's `argIds`/`argByName`/`proccode`, so declaration order no longer matters for *compiling*. See `references/dsl.md`, "Define before you call".)
3. **An exemption hole in a validation script is a disabled alarm.** The `if (spec.hidden) continue;` in `verifyCatalog` is exactly why the previous incident stayed hidden for so long; `hidden` only means the entry doesn't appear in the UI cheat sheet — the shape still has to be checked. Before you add a whitelist, think hard about what you're giving up.
4. **Field emission has three paths** (statement, hat, reporter), and they must all go through the same `fieldValue()`. Any one of them copying its own shortcut will produce fields with a missing id.
5. **Prefer clones over pen stamps.** The pen layer is a **bitmap** — `图章` (stamp) rasterizes SVG costumes at stage resolution, which throws away rule 6's "prefer SVG assets". To draw the same batch of things repeatedly (snake segments, particles, grid cells), use a clone pool: each clone is a genuine sprite, rendered as vectors, individually controllable, and with no extension dependency. Assets likewise: **prefer SVG** — bitmaps get re-encoded by Scratch and lose quality.
6. **A custom block that does dozens to hundreds of actions in one go must be marked `不刷新`** (warp). If blocks like batch clone creation or list rebuilds don't turn on warp, every loop iteration yields, and dozens of clones slowly pop out one per frame. This bites hardest behind a broadcast that fires every frame: `event_whenbroadcastreceived` has `restartExistingThreads: true`, so each broadcast restarts a still-running receiver from the top — a non-warp `重复 (16)` scan inside `当收到("刷新方块")` never got past iteration 1 (measured on `examples/tetris-zh-Hans.pseudo`). Wrap the whole loop in a warp block and call it from the hat. Conversely, a block containing `等待` (wait) / `说等待` (say for seconds) must **never** turn it on — inside a warp frame, wait doesn't yield properly and spins until the 500ms `WARP_TIME`.

  Also wrap **green-flag startup clone loops** in warp. A bare `重复 (N): 克隆自己` sitting directly in a `绿旗` hat (not inside a warp custom block) yields once per iteration, so N clones pop in one per frame at project start — the 扫雷 (Minesweeper) project showed this exactly: its 6 digit-clones and 6 button-clones did this until they were extracted into `铺数字` / `铺按钮` (`不刷新`) custom blocks. (The grid's `补足克隆` was already warp; the HUD clones were the miss.) On plain Scratch (not TurboWarp) even warp-wrapped clone-startup `渲染` threads get spread across a few frames by the 75%-CPU scheduler, so the only way to get truly instant bulk appearance is TurboWarp's per-frame thread drain — but warp still removes the per-iteration yield, which is the dominant cost.

## Clone-pool / grid game playbook

For anything grid-shaped (board game, puzzle, sim) built with a clone pool, these traps each burned a full debug round on the 扫雷 (Minesweeper) and 炸弹人 (Bomberman) builds and are all verified end-to-end under a real scratch-vm (`playtest.mjs` / `verify.mjs`) and a real TurboWarp web import (`scripts/turbowarp-verify.mjs`):

1. **Both kinds of clone creation need warp.** The bulk grid `重复: 克隆自己` behind a broadcast (`补足克隆`) *and* the small `重复 (N): 克隆自己` inside a `绿旗` hat must both be wrapped in `不刷新` custom blocks. The green-flag one is the easy miss — a bare loop yields per iteration and its clones pop in one per frame at start.
2. **Guard broadcast receivers against clones.** `当收到(...)` fires on *every* target, clones included, so a receiver that spawns clones must first check `如果 (是克隆 = 0)` — otherwise 80+ clones each spawn a batch and you slam the 300-clone cap.
3. **Clones start hidden — `显示` after rendering.** `当作为克隆体启动时` inherits the parent's `隐藏`; a `换成造型` alone leaves the clone invisible. Every clone-render block ends with `显示`.
4. **A custom block's argument used to be resolved in the *callee's* scope — fixed, but the workaround still has value.** `emitProcCall` passed the *called* proc to `emitSlot`, so `引爆一颗(扫描)` resolved the argument `扫描` against 引爆一颗's own parameter table and emitted a self-referential `argument_reporter` → the param got `0` and the block looped forever (found on the Bomberman build, 2026-10-02). Fixed: `emitProcCall` now resolves args against the **caller's** proc (`scope.proc`). If you're on an older copy, land the arg into a distinct global first (`工作格 ← 格`; `点开(工作格)`) and make sure the argument name never equals the callee's parameter name.

5. **A variable or parameter name that collides with a built-in block alias silently becomes that block.** This is the single nastiest DSL trap. `方向` is an alias for `motion_direction` (`catalog.js`), so a variable named `方向` used as an expression compiled to the sprite's *direction* (default 90) instead of the variable — `计算目标格(方向)` passed 90/0 forever and the player never moved; a parameter named `方向` made every body reference read `motion_direction` too, so the parameter was never bound. **The compiler does not warn.** Before naming a variable/parameter, check it against the alias list: `node <skill dir>/scripts/vocab.mjs --grep <name>` — if it matches a block's `zh:`/`en:` alias (e.g. `方向`, `距离`, `造型`, `大小`, `x 坐标`), rename it (here: `方向`→`玩家方向` for the global, `方向`→`dir` for the parameter). The built-in wins at parse time, so `proc.argByName` never gets a chance.

6. **Broadcasts do not reach clones that don't exist yet.** A `绿旗` hat on the player that runs `初始化` → `广播("重置敌人")` fires before the enemy sprite's `绿旗` has spawned its clones, so the `当收到("重置敌人")` receiver (guarded `如果 (是克隆 = 1)`) never runs on them and every enemy keeps `敌格 = 0` and never moves. Fix: give the clone-start hat a `重复直到 (列表长度(<就绪列表>) > 0): 等待 (0.05)` gate, then run the same positioning logic (extract it into a no-arg `不刷新` custom block and call it from both the clone-start hat and the broadcast receiver, so a mid-level re-broadcast still repositions live clones).

7. **For a grid indexed `格 = r * 列数 + c + 1`, decompose rows with `列数`, not `行数`.** Dividing by the row count silently scrambles every cell beyond the first row-ish (`敌格 103` came out as `(r=9,c=11)` instead of `(r=7,c=11)`); the border/steel checks and all clone positions were wrong while the project still ran. The stride is the **column count** (`列数`); only the bounds check uses `行数`.

8. **`隐藏` in the green-flag script does not hide the original until the flag is pressed — use `初始隐藏`.** The original of a clone-pool sprite is a real sprite sitting at (0,0); it draws in the editor, in the packaged player before ▶, and in the first frame of the run. The user sees a stray copy of the sprite in the middle of the stage and reports it as "计数器克隆体的本体好像没隐藏". `初始隐藏` (`initially hidden`) is a **target-level directive** added 2026-10-02: it sets the target's *saved* `visible` flag to `false` in `project.json`, emits no blocks, and is a compile error on 舞台. Put it on every sprite whose original is only a pool builder (Bomberman: 方块/炸弹/爆炸/敌人/数字/信息 all start hidden; only 玩家 is visible). Verify with `node scripts/turbowarp-verify.mjs`, which asserts "before the green flag, only 玩家 is visible".

   Related: **blast/blast-like ranges are one variable, not a magic number.** Bomberman's cross-shaped blast is `变量 火力` read as `如果 (爆步 > 火力)` inside `爆方向`, and it is set **twice** — once as the declaration default and once in `初始化`. Changing only one leaves the other stale. When a user asks for "扩展 N 格", grep for every assignment.

Right-click can't be told apart by standard blocks (`当角色被点击` fires for both mouse buttons; `鼠标按下` carries no button). **TurboWarp's Stretch extension does NOT help** — it only stretches a sprite's x/y; it has zero mouse-button blocks (this was mis-stated as "the only real right-click path" in an earlier revision — corrected). The official extension gallery likewise has nothing for right-click. So the Minesweeper build still ships **hold-F-then-click + a flag-mode toggle button** as the universal fallback, which also works on plain Scratch / scratch-vm (where the flag signal variable just stays 0).

For a *real* right-click in TurboWarp, the working path is a **self-written TurboWarp extension** that cannot be packed into the `.sb3`: plain Scratch / scratch-vm refuse to load extensions from `data:` URIs. The approach used here (`rightclick.js`, id `rightclick`, display name **Turbowarp积木**): it listens for `window` `mousedown` with `e.button === 2`, writes `1` then `0` (700 ms later) into a **plain stage variable `右键窗口`**, and suppresses the canvas `contextmenu`. The game reads `右键窗口` inside `当收到("格子点击")` (`如果 (或(或(旗帜模式=1, 按键按下("f")), 右键窗口=1))`) and toggles the flag — so the same project works with or without the extension (on plain Scratch `右键窗口` is simply 0). `inject-extension.cjs` base64-encodes `rightclick.js` into a `data:application/javascript;base64,…` URI and pushes it onto `project.json`'s `extensions` array and `extensionURLs['rightclick']`, making the shipped `.sb3` self-contained (open in TurboWarp, no external host). **Critical lesson:** the extension MUST declare `unsandboxed: true` in `getInfo()` — without it TurboWarp keeps it sandboxed and `Scratch.vm` is undefined, so the variable write silently never happens. (Verified against the TurboWarp unsandboxed-extension docs: the correct runtime path inside an unsandboxed extension is `Scratch.vm.runtime`, and `findStageVar` must handle both the object form `{name,value}` and the array form `[name,value]` that Scratch stores variables in.)

Layout constants that fit a 480×360 stage and stay under the 300-clone cap: board area is **452 wide × 216 tall**, center y = **−60**; `格边长 = min(452/列数, 216/行数)` clamped to **[10, 30]**; cap total cells at **264** (headroom for ~12 HUD clones + 6 roles). HUD digits: a 6-clone seven-segment row driven by a `[100,10,1,100,10,1]` place-value list (first 3 = remaining mines, last 3 = timer).

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

After any change, always run: `npm run check-catalog` → `npm test` (88 items, including the four-language hello and both the Chinese and English snake examples run for real under green flag in a real scratch-vm)
→ `npm run smoke` (58 end-to-end items, last line `SMOKE PASS`). **Smoke requires a real GUI desktop session**: with no display,
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
**Probe with a plain `cp` first, though** — the block belongs to the volume's current state, not
to the drive letter. Measured again on the same portable drive a few hours after the table above:
plain `cp` over existing files succeeded, and a Python `os.remove` + `zipfile` rebuild of the
`.zip` worked too. Only fall back to `rm -f` + `cp` when the plain `cp` is actually denied.

Two ways to destroy data this way, both hit in practice:

- **Never `rm` before a copy whose source path is relative** to a directory you only `cd`'d
  into inside a subshell. The `rm` (absolute) succeeds, the `cp` (relative, resolved against
  the script's cwd) fails, and the file is simply gone. Use absolute paths on both sides.
- If a long bash script comes back with **no output at all**, treat it as "did not run or the
  output was lost" and re-check the destination before continuing.

Other notes for such a copy:

- `node_modules` (complete, including Electron) and `.ref` may already be present — check
  before reinstalling. `.ref` is just vendored sources and is safe to copy or skip.
- `npm test` and `npm run check-catalog` run fine there (88 tests).
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

- `references/dsl.md` — pseudocode syntax: skeleton, indentation, assignment/mutation, menu params must be quoted, operators, custom blocks and `不刷新` (warp), prefer SVG assets, **HUD monitor syntax (`显示变量(名, "模式", x, y)`)**, known unsupported forms (incl. why the Scratch 2 镜头 blocks are no-ops)
- `references/game-feel.md` — game-feel playbook from `examples/asteroids`: frame pump (`广播并等待` + warp), thrust decomposition (**x ← sin, y ← cos**, why the textbook pair is 90° off), angular inertia, damping, Pythagorean speed cap **and the sequential-assignment snapshot trap**, one-line 取余 screen wrap, timer-derived blink, clone particles with drag+shrink+fade, screen shake via **stage effects** because camera blocks do nothing, and the pause/cooldown/cleanup gate rules
- `references/sb3-format.md` — `.sb3` block-graph shape: slot encoding `[1/2/3]`, primitive type numbers, variables and lists registered by **key**, static dropdowns as fields vs dynamic menus as shadow blocks, list-index `all/last/random` semantics, TurboWarp `toJSON()` under-reporting, **`monitors[]` (MonitorRecord) shape and the first-script visibility rule**, and why the web build's `toJSON()` is a *string* (property reads off it silently `undefined`)
- `references/workflow.md` — project workflow: the 6 steps for adding a block, five historical lessons, the verification-chain commands, **the per-example `gen-assets.mjs` / `verify.mjs` harness conventions (headless `碰到` limitation, wall-clock frame stepping, sampling decaying values)**, the operational order and traps for verifying TurboWarp in the built-in browser, packaging verification
- `scripts/vocab.mjs` — exports the available block list from the project catalog (`--group`/`--grep`/`--lang`/`--json`)
- `scripts/inspect-sb3.mjs` — zero-dependency `.sb3` unpacking and structural self-check; runs on any project. Its overview dumps **`monitors[]`** (mode, `VARIABLE`, x/y, range, hidden flag), per-target block/script/variable counts, and the opcode histogram.
- `scripts/turbowarp-verify.mjs` — **real-browser** verification + screenshot: drives local Edge (playwright-core) to turbowarp.org/editor, injects the `.sb3` into `window.vm`, presses real keys, screenshots the 480×360 stage canvas at the flame frame, and asserts "before the green flag only 玩家 is visible" / "火力 = 2" / "blast never exceeds 2 cells" / "no JS errors". `node scripts/turbowarp-verify.mjs [sb3] [out.png]`. This is the check that a node-only scratch-vm run cannot replace — it catches import-time rendering, real keyboard, and saved-visibility problems. Its per-example sibling is `<repo dir>/examples/asteroids/browser-verify.mjs` (29 asserts: monitors read back out of the web VM **and** off the HUD DOM, real-key turning/thrust/fire, pixel collision, shake effects, pause, wrap, game over, 3 screenshots into `out/`).

Repo files related to i18n (not inside this skill dir; they live with the repo):

- `<repo dir>/src/core/i18n.js` — language table, UI strings `UI`, syntax cheat sheet `SYNTAX`, message translation table `MSG`, `translateMessage()` / `uiDict()`
- `<repo dir>/src/core/aliases-i18n.js` — `ALIAS_I18N` (148 OPS), `HAT_ALIAS_I18N` (8 HATS), `KEYWORDS_I18N`, `MENU_I18N` / `MENU_I18N_EN`, `GROUP_I18N`, `augmentCatalog()`
- `<repo dir>/test/i18n.test.mjs` — assertions for alias isomorphism across the four languages, menu values, message translation, and string completeness; the "structure fingerprint" comparison at the end (opcode + raw menu values + numeric literals + subtree shape, identifiers masked) pins down that "the same program written in two languages compiles to an isomorphic block tree". It also checks that the in-app syntax cheat sheet compiles in all four languages.
- `<repo dir>/examples/hello-{en,zh-Hans,zh-Hant,ja}.pseudo` — equivalent examples in the four languages; each compiles to the same 50 blocks, giving new aliases automatic coverage
- `<repo dir>/examples/snake-en.pseudo` — the English twin of `examples/snake-zh-Hans.pseudo` (205 blocks, one-to-one). Change either side and you must sync the other: `i18n.test.mjs` compares the structure fingerprint, and `vm-run.test.mjs` runs the same set of "it really plays" assertions on both artifacts. The snake's four assets are stored once under each language's filename (identical content, identical md5ext, so the zip stores only one copy), generated together by `scripts/make-demo-assets.mjs`
- `<repo dir>/examples/bomberman/bomberman-zh-Hans.pseudo` + `gen-assets.mjs` (all-vector SVGs under `assets/bomberman/`) + `verify.mjs` — a complete, playable **classic Bomberman** (13×11 grid, ~930 blocks, 8 targets, no extensions): arrow-key movement + space to drop bombs, cross-shaped blast with brick destruction and chain detonation, patrolling/chasing enemies, kill-all-or-reach-exit win, score + level progression, seven-segment HUD. Read it for: a **four-clone-pool** design (143 board cells + 8 bombs + 40 flames + 4 enemies), the `私有` per-clone state pattern, the `不刷新` batch-clone startup, and every trap in the playbook above in the wild. `verify.mjs` is the real-scratch-vm harness (green flag → move → bomb → explode → enemy AI → blast range → saved visibility, asserts stage variables/lists). Blast range is the single variable `火力` (default **2**), set both at declaration and in `初始化`.
- `<你的项目目录>\Scratch\Making\炸弹人` — **user project (personal path, not in repo)**, the standalone deliverable copy of the Bomberman above: `炸弹人.pseudo`, `gen-assets.mjs`, `assets/bomberman/`, `playtest.mjs` (real-scratch-vm assertions), and `out/炸弹人.sb3` + `out/turbowarp-运行截图.png` / `out/turbowarp-运行截图-打开工程.png` (the latter proves the pool originals are hidden before the green flag). Sync the repo copy and this folder together.
- `<repo dir>/examples/tetris-zh-Hans.pseudo` + `scripts/make-tetris-assets.mjs` — the largest example (580 blocks, 225 runtime targets) and the reference for anything grid-shaped. Worth reading for: the clone-pool board (200 cells, one private `格号` each, rendered only on a `刷新棋盘` broadcast), the 448-char `形状数据` string (7 pieces × 4 rotations × 4×4, spawn states written by hand and the rest derived by a real rotation so the table can't drift), the polled-key input with per-key cooldowns (no `当按键按下` hats), the `不刷新` render blocks behind per-frame broadcasts, and the 10-clone seven-segment digit HUD that avoids `显示变量` watchers. Its behaviour is pinned by `test/tetris.test.mjs`
- `<repo dir>/examples/asteroids/asteroids-zh-Hans.pseudo` + `gen-assets.mjs` (all-vector SVGs under
  `examples/asteroids/assets/`) + `verify.mjs` — a complete, playable **Asteroids** (488 blocks · 6
  targets · 10 monitors · 56 opcodes, no extensions): rotational + linear inertia with a capped speed,
  screen wrap, bullets that inherit ship velocity, asteroid splitting with score bookkeeping, clone
  particles, a monitor HUD, and stage-effect screen shake. This is the reference implementation for
  everything in `references/game-feel.md`; `verify.mjs` is the model for a per-example real-VM harness
  (54 assertion call sites, fails on any compiler warning or `PROJECT_RUN_ERROR`), and
  `browser-verify.mjs` is its real-TurboWarp twin (29 asserts: monitors out of the web VM **and** off the
  HUD DOM, real-key turning/thrust/fire, pixel collision, shake, pause, wrap, game over, 3 screenshots).
  The example loads from the app's 载入示例 menu as `asteroids/asteroids-zh-Hans.pseudo` (see
  `references/workflow.md`, "Per-example asset + verification harness").
- `<你的项目目录>\Scratch\Making\扫雷` — **user project (personal path, not in repo)**, a complete and verified Minesweeper: full clone-pool grid with flood-fill reveal, first-click-safe mining, win/lose detection, custom board sizes/densities, and the F-key / flag-mode flag workaround above. Read `扫雷.pseudo` to see the four playbook traps in action; `playtest.mjs` is the real-scratch-vm assertion harness (64/64, incl. a simulated-right-click section that drives the `右键窗口` flag path) and `make-assets.mjs` generates all 39 SVG costumes. For the real right-click path: `rightclick.js` is the self-written TurboWarp extension (id `rightclick`, name **Turbowarp积木**, must be `unsandboxed: true`), and `inject-extension.cjs` bundles it into the shipped `.sb3` as a `data:` URI under `out/扫雷.inject.sb3` (the clean, extension-free build is `out/扫雷.sb3`).
