# Decompiling `.sb3` → pseudocode (反解)

`src/core/decompile.js` turns the tool around: it reads any `.sb3` (Scratch 3 / TurboWarp) and
writes pseudocode that the same compiler accepts again. It is **not** a pretty-printer of
`project.json` — the DSL is narrower than the block graph, so the whole design is "lose nothing
silently": whatever cannot be written as pseudocode becomes a `# 注释` in the output **and** a
line in the `problems` / `notes` list.

## Entry points

| Where | How |
|:--|:--|
| CLI | `node src/cli.js project.sb3 [-o out.pseudo] [--no-media] [--lang en]` — a `.sb3` input flips the direction; the `.pseudo` goes next to it by default and the media (costumes/sounds) is unpacked into `assets/` beside it, so the file compiles again without editing any 造型/声音 path |
| Desktop app | 文件 → 反解 Scratch 工程 (.sb3)… (`Ctrl+Shift+O`), or the toolbar 反解 .sb3… button. `electron/main.cjs`'s `open-sb3` handler runs the decompile, writes the media next to the `.sb3`, and hands the text + report to `renderer/app.js openSb3()`, which fills the editor, the 结构问题/警告 panels and a one-line summary. It deliberately does **not** auto-compile — that would overwrite the decompile report with compile output |
| Code | `decompileSb3(zipBuffer, {lang, assetDir})` (knows the zip container + media) and `pseudoFromJson(jsonString, opts)` (the same pipeline from a `project.json` string — both must produce byte-identical text, pinned by a test) |

Return shape: `{pseudo, problems, notes, renames, totalBlocks, targetCount, media}` where
`media` is `[{file, buffer}]` and `renames` is `[[original, final], …]`.

**Language split, on purpose:** keywords and block aliases follow `opts.lang`
(`decompileSb3` defaults to `zh-Hans`; the CLI defaults to whatever `--lang` says, i.e. `en`;
the desktop app passes the current UI language). Comments, `problems` and `notes` are
**Simplified Chinese only** — they are author-facing text about a file the author is fixing, and
translating them would need a second message table for zero benefit. Same reasoning as the
compiler's internal messages.

## The slot shapes, and the one that bit us

`inputs[name]` is `[tag, block, shadow?]` (scratch-vm `serializeInputs` / `deserializeInputs`):

| tag | name | meaning | read the value from |
|:--|:--|:--|:--|
| 1 | `INPUT_SAME_BLOCK_SHADOW` | the slot's block *is* its shadow: a literal (`[1,[4,"10"]]`) or an unobscured menu/shadow block | `slot[1]` |
| 2 | `INPUT_BLOCK_NO_SHADOW` | a plugged block with no shadow: substacks, booleans — **and** every reporter this compiler plugs into a value slot | `slot[1]`, but is it a statement? see below |
| 3 | `INPUT_DIFF_BLOCK_SHADOW` | an **obscured shadow**: a real block plugged into a slot that also carries a shadow, e.g. `stretch_setStretchX`'s `X = [3,"<operator_multiply id>",[4,"100"]]` | `slot[1]` — **never** `slot[2]` |

Two lessons, both pinned by `test/decompile.test.mjs`:

- **tag 3**: `slot[2]` is only the placeholder the empty slot would have shown. Taking it turned
  the official `Stretch.sb3` demo into `将 x 拉伸设为 (100)` and silently dropped 13
  `operator_multiply` / `operator_mathop` / `sensing_timer` blocks. Real Scratch/TurboWarp files
  use tag 3 for *every* expression plugged into a numeric slot, so this is the single most common
  shape in foreign projects — our own exports never emit tag 3, which is exactly why the
  round-trip tests could not catch it.
- **tag 2 is ambiguous** (substack vs reporter). Ask the generated catalog's `inputs[].stmt`
  flag first; only fall back to the child's opcode when the catalog has no entry — and remember
  `control_if_else` is *hidden* from the catalog (so its `CONDITION`/`SUBSTACK`/`SUBSTACK2` have
  no `stmt` flag) and that `procedures_call` is a **statement** while only
  `procedures_callreturn` reports a value. Getting this wrong made a `否则:` branch whose only
  content was an arg-less custom-block call look like an empty substack, and the whole branch
  vanished into the empty-body marker (found on `examples/bomberman`).

## What the DSL cannot express (and what the decompiler does instead)

| `.sb3` content | Emitted pseudocode | Report |
|:--|:--|:--|
| a top-level stack with no hat and no `procedures_definition` | kept as `#` comments | `problem`: 「有 N 块顶层积木既没有帽子也没有自制积木定义」 |
| an empty C-block body (`SUBSTACK` points at nothing) | `等待 (0)` — the DSL has no empty-block syntax, and this is the one shape the fingerprint test canonicalises both ways | — |
| a list with initial contents | `列表 名` only, contents as `# 原初值: …` | `problem` |
| an opcode this build does not know | `# 反解不支持: <opcode> (SLOT=…, FIELD=…)`, and its substack bodies are preserved under a `并发执行:` container | `problem` |
| a reporter/boolean left dangling in a statement chain | `# 悬空的报值积木 <opcode>` | `problem` |
| `procedures_callreturn` (a custom block that returns a value) | the call as a statement | `problem`: 「带返回值的自定义块…返回值会丢失」 (matches the compiler's own boundary) |
| sprite x/y/size/direction/rotationStyle/draggable/volume/currentCostume | `初始坐标 (x, y)`, `初始大小 n`, `初始朝向 n`, `初始旋转 "label"`, `可拖拽`, `初始音量 n`, `起始造型 "造型名"` — defaults are left unwritten | — (declarable since 2026-10-03; see `references/dsl.md` §"本体属性声明") |
| an attribute value that is not a number, or a rotation style the menu has no option for | the directives around it are still written | `problem`: 「…不是数字，无法声明」/「不在 初始旋转 的选项里」 |
| a **variable / list / broadcast / custom-block** name that cannot be written as an identifier (spaces, brackets, quotes, `:` …) | renamed (`my variable` → `my_variable`) | listed in `renames`, shown as `decompile.renamed` |
| a **sprite name** with spaces or punctuation | written verbatim — bare if the lexer reads it back (`角色 Sprite 1:`), quoted if not (`角色 "a:b":`) | — |
| a sprite name containing `"` or a newline (the string lexer has no escapes) | those characters become `_` | `note`: 「有引号或换行，不能原样写出」 |
| a monitor whose id is not registered in `target.variables` (hand-edited files) | falls back to `monitor.variableName` | `problem`: 「未在工程中注册」 |
| a monitor with `x: null` (auto-positioned) | `显示变量(名, "模式")` without coordinates | `note` |

Variables, lists, broadcasts and custom blocks still go through the decompiler-safe rename pass;
sprite names do not (they are read up to the colon, so they can keep their spaces), and the stage's
own name is fixed to `Stage` (a note when the file says otherwise).

## Verification

- `node --test test/decompile.test.mjs` — the round-trip pin. For **every** file under
  `examples/` (root + one level of subdirs, same rule as the app's example menu): compile →
  decompile → compile again, then compare a strict **structure fingerprint** (opcode + raw menu
  values + numeric literals + subtree shape, identifiers masked), the `surface` (target names,
  variable/list/broadcast name sets, monitor `mode/visible/x/y/spriteName`), and the target count.
  Plus the tag-3 pin, the `否则:`-body pin, a foreign-project fixture (unknown opcode, unregistered
  monitor, dangling reporter, list with contents → must produce problems, not silence), the **本体属性
  pins** (the fixture's x/y/size/direction/rotation/drag/volume/currentCostume must be emitted as
  declarations and a `编译→反解→再编译` build must report the same values, incl. two costumes sharing
  one md5ext — de-duping those lines used to shrink 造型数), the CLI
  end-to-end, and JSON-vs-zip byte equality.
- `npm run smoke` — the desktop path: the 文件 menu item exists on `Ctrl+Shift+O`, the toolbar
  button works, `smoke.sb3` decompiles to `角色 球:` + `当绿旗被点击:`, the summary line renders,
  `problem-count` is 0, and the decompiled text **compiles again to 通过**.
- `node scripts/turbowarp-import-check.mjs <original.sb3> <roundtrip.sb3> [png-prefix]` — the
  real-machine check: loads both into turbowarp.org/editor, snapshots per-target block/hat/proc/
  variable/monitor counts and the green-flag run, and diffs them. This is what caught the tag-3
  bug after the node tests were already green. Note the two metrics that are **not** comparable:
  shadow blocks (Scratch stores a shadow next to every plugged expression, we do not) and
  `Target.blocks` itself (a BlockContainer — count `t.blocks._blocks`, or every target reports 4).
  Measured: `Stretch.sb3` (foreign, 30 blocks) 15/15, `asteroids` double round trip (543 blocks,
  7 targets, 11 monitors) 45/45, and a real hand-made project (5 targets / 5 blocks, `Sprite 1`
  kept by name, one sprite at 36,28 with `currentCostume 4`) 33/33 with `problems 0` on the way back.
