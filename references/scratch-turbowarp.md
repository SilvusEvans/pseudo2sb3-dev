# Scratch / TurboWarp platform notes

General platform behaviour and block-semantics quick-reference — the facts that hold for Scratch/TurboWarp **independently of pseudo2sb3**. Pseudocode syntax, `.sb3` emission, the DSL and the compiler's own traps live in the other references; this file links to them rather than repeating them.

> Verification labels (respect SKILL.md rule #1 — metadata is measured, never recalled):
> - **✅** — measured in this repo (a named reference/verify script proves it).
> - **ⓘ** — general Scratch / TurboWarp behaviour, **not independently measured in this repo**; treat as platform background, and re-check in a live VM/TurboWarp before relying on it for a compiler change.
> - **⚠️** — a common claim I could not confirm here, or that is widely mis-stated; see the inline note.

## 1. Stage & coordinates

| Quantity | Value |
|:--|:--|
| Stage size | **480 × 360** px |
| x range | **−240 … 240** (0 = centre) |
| y range | **−180 … 180** (0 = centre) |
| Origin | exact centre of the stage |
| Direction | **0 = up, 90 = right, 180 = down, −90 = left** (ⓘ measured in `game-feel.md` for the thrust pair) |
| Rotation modes | `all around` / `left-right` / `don't rotate` |

- **Screen wrap, one line** ✅ — `x ← ((x + 240) mod 480) − 240`, y with `180`/`360`. No `if` needed. See `game-feel.md` §Non-linear movement.
- **Thrust decomposition** ✅ — for Scratch's direction system use **x ← sin, y ← cos**; the textbook `(cos, sin)` pair is 90° off here. `game-feel.md`.
- **Speed cap** ✅ — `sqrt(vx² + vy²)` vs a max, then scale both down proportionally. Watch the **sequential-assignment snapshot trap** — read the total into a temp before scaling, don't mutate `vx` then reuse it. `game-feel.md`.

## 2. Sprites & clones

- **Clone cap = 300 across all targets combined** ⓘ — Scratch's hard limit; exceeding it drops new clones silently.
- Clones inherit the parent's position/costume/size/direction and get **private copies** of that sprite's variables.
- **Clones inherit `隐藏`** ✅ — `当作为克隆体启动时` starts hidden if the parent is; a bare `换成造型` leaves it invisible, so every clone-render block ends with `显示`. SKILL.md playbook #3.
- **Hide the original with `初始隐藏`, not a `绿旗` `隐藏`** ✅ — target-level directive; `隐藏` in a script only bites after ▶. SKILL.md playbook #8.
- **`私有` per-clone state** ✅ — e.g. each cell keeps its own `格号`. `dsl.md` §Clones.
- **Bulk clone creation must be warp-wrapped** ✅ and **broadcast receivers must guard against clones** (`如果 (是克隆 = 0)`) ✅ and **broadcasts can't reach clones that don't exist yet** ✅ — SKILL.md playbook #1/#2/#6.
- **Prefer clones over pen stamps** ✅ — the pen layer is a bitmap; `图章` rasterises SVG at stage resolution. SKILL.md rule #5.

## 3. Broadcasts & messages

- Broadcasts are **global** — every target, clones included, receives them.
- **`event_whenbroadcastreceived` carries `restartExistingThreads: true`** ✅ — each broadcast restarts a still-running receiver from the top; this is what silently stalls a non-warp loop behind a per-frame broadcast. SKILL.md rule #6.
- **`广播并等待` (broadcast and wait)** ✅ — waits for all receivers to finish; the idiomatic frame pump when paired with a warp custom block. `game-feel.md` §Frame pump.
- Message names are plain strings.

## 4. Variables & lists

- Two scopes: **global** (whole project) vs **private** (this sprite only; each clone gets its own copy).
- **A name colliding with a built-in block alias is silently replaced by that block** ✅ — `方向`/`距离`/`造型`/`大小`/`x 坐标` are aliases; the compiler does not warn. Check with `scripts/vocab.mjs --grep <name>`. SKILL.md playbook #5.
- **Variables & lists register by key, not by name** ✅ — in `.sb3` they're `{id: [name, value]}`. `sb3-format.md`.
- **List index `all` / `last` / `random` are special values, not numbers** ✅. `sb3-format.md`.
- List ops: item n, items n–m, length, contains, insert, replace, delete, of.
- **A list's initial contents survive 反解 only as comments** ✅ — a known `.sb3 → pseudocode` boundary. `decompile.md`.

## 5. Custom blocks ("My Blocks")

- **`不刷新` / run without screen refresh (warp)** ✅ — runs the whole block inside one frame without yielding. Required for dozens-to-hundreds of actions; forbidden whenever the body contains `等待`/`说等待` (they spin to the 500 ms `WARP_TIME` instead of yielding). SKILL.md rule #6.
- Parameters: number/string (round inputs) and boolean (hexagonal inputs).
- **Recursion works but depth is limited; warp recursion can overflow** ⚠️ — plausible platform behaviour but **not measured here**; keep recursion shallow and verified before depending on it.
- **Custom blocks have no return value** ✅ — a deliberate pseudo2sb3 boundary (and Scratch has no "return" either); carry results in a variable. SKILL.md §Boundaries.

## 6. Frame rate & the execution model

- **Scratch runs at ~30 fps** ✅; **TurboWarp raises it** ⓘ — configurable, with a turbo/unthrottled mode. (Do **not** assume a specific hard cap like "250 fps" — verify in the app if the number matters.)
- **75 % CPU scheduler** ✅ — plain Scratch (non-TurboWarp) spreads even warp `渲染` threads across several frames, so instant bulk appearance needs TurboWarp's per-frame thread drain. SKILL.md rule #6.
- **`计时器`** ✅ — seconds since green flag; `计时器归零` resets it. Timer-derived blink/pauses are preferred over `等待` where warp applies. `game-feel.md`.

## 7. Graphics & rendering

- **Costumes: prefer SVG** ✅ — bitmaps get re-encoded by Scratch and lose quality. `dsl.md`, `workflow.md` §Assets.
- **Size** is a percentage; `100` = native.
- **Layering**: go to front / front 1 / back 1 / back.
- **Graphic effects**: colour, fisheye, whirl, pixelate, mosaic, brightness, ghost.
- **Scratch 2 camera/镜头 blocks are no-ops in Scratch 3** ✅ — do screen shake with **stage effects**, and death flashes with a **full-stage white-flash sprite**. `game-feel.md`.
- **Pen**: down/up, stamp, clear, colour/size. ⚠️ It's a bitmap — prefer clones (§2). SKILL.md rule #5.

## 8. Sound

- Formats WAV / MP3; Scratch transcodes on import.
- **`播放声音并等待` (play sound and wait) deadlocks a headless harness** ✅ — headless scratch-vm has no audio engine, so the block never completes; don't use it in `verify.mjs` paths. `game-feel.md` §Sound.
- **`音调` (pitch)** ✅ — cheap per-shot audio variation, e.g. jitter per bullet. `game-feel.md`.
- `音量` is per-target 0–100; `停止所有声音` is global.

## 9. Input & sensing

- **`当按下按键` (when key pressed) hat fires on clones too** ⚠️ — clones inherit the parent's scripts, so a key-press hat runs on the original *and* every clone holding that hat. A claim that it "doesn't respond to clones" is **incorrect**; if you need one-shot key handling, guard with `是克隆 = 0` like a broadcast receiver (§3 / playbook #2). ⓘ (general scratch-vm behaviour — confirm in a live VM before encoding it into a compiler test.)
- **`按键按下` (key pressed) boolean** ✅ — polled, good for per-frame checks; add **per-key cooldowns** so a held key doesn't autofire (the Tetris reference does this, no `当按键按下` hats). `examples/tetris-zh-Hans.pseudo`.
- **Click blocks can't tell mouse buttons apart** ✅ — `当角色被点击` fires for both buttons, `鼠标按下` carries no button; a *real* right-click needs a self-written `unsandboxed: true` TurboWarp extension. SKILL.md §right-click / playbook.
- `鼠标 x` / `鼠标 y` are stage coordinates; `计时器` seconds; `响度` is microphone loudness.

## 10. Performance quick-reference

| Technique | Why |
|:--|:--|
| Warp-wrap batch loops | whole rebuild in one frame (§5) |
| Clone pool, reuse clones | avoids create/delete churn (§2) |
| Fewer / coalesced broadcasts | each has thread overhead, worst per-frame (§3) |
| `私有` vars over global lookups | one per clone, no index math |
| List lookup over `如果` chains | O(1) fetch beats long branches |
| Seven-segment clone HUD instead of `显示变量` | avoids monitor watchers (Tetris) |
| SVG assets | vector, not re-encoded (§7) |
| Precompute tables | e.g. Tetris's `形状数据` string |

## 11. Debug tooling

- `scripts/inspect-sb3.mjs` ✅ — zero-dep `.sb3` unpack: slots, variable registration, `monitors[]`, opcode histogram.
- `scripts/turbowarp-verify.mjs` ✅ — real-browser run + screenshot: import-time rendering, real keys, saved visibility.
- `scripts/turbowarp-import-check.mjs` ✅ — decompile round-trip diff; catches slot-shape misreads node-side tests miss.
- `scripts/vocab.mjs --grep` ✅ — how a block is written, same source as the compiler (can't go stale).
- **Structure fingerprint** ✅ — opcode + raw menu values + numeric literals + subtree shape (identifiers masked) to prove two-language sources are isomorphic. `decompile.md`.
- **Double-evidence rule** ✅ — emitted shape **and** a real VM/TurboWarp run; one without the other isn't "fixed". SKILL.md rule #2.

## 12. Common-trap cheat sheet

| Trap | Fix |
|:--|:--|
| Variable/param name = a block alias | `vocab.mjs --grep` before naming (playbook #5) |
| Per-frame broadcast stalls a loop | wrap the loop in warp (rule #6) |
| Clone invisible after render | end render block with `显示` (playbook #3) |
| Broadcast misses not-yet-built clones | `重复直到 … 等待` gate (playbook #6) |
| Grid row decomposed by `行数` | stride is `列数` (playbook #7) |
| Pool original shows on stage | `初始隐藏` (playbook #8) |
| Warp block contains `等待` | never enable warp there (rule #6) |
| Metadata hardcoded from memory | generate via `extract-catalog` (rule #1) |
| `hidden` skips validation | keep checking shape (rule #3) |
| Pen stamps for repeated art | clone pool instead (rule #5) |
| Bitmap assets | SVG instead (rule #5) |
| `播放声音并等待` in headless test | drop it; no audio engine (§8) |
| Believing key hats skip clones | they fire on clones too (§9) |
