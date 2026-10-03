# Pseudocode DSL (.pseudo)

Skeleton, indentation, declaration syntax. **Don't hand-copy block aliases or params** — fetch them live from the project's own catalog with `node scripts/vocab.mjs --grep keyword`; it reads the same table the compiler does.

## Skeleton

```
# A line starting with # is a whole-line comment (// works too)
# A trailing comment after any code line is also allowed:  计数 ← 计数 + 1   # 每帧一次
# global (全局): a stage-level variable, readable/writable by every sprite
global score = 0
global message = "hello"

# sprite — or stage / 舞台 / 角色
sprite ball:
  # 初始隐藏 / initially hidden: the sprite's SAVED visible flag is false, so its original
  # never draws in the editor, in the packaged player, or in the frame before the green flag.
  # Only meaningful on a sprite (a stage has no original); it adds no blocks.
  initially hidden
  # A var/list declared inside a sprite block is still registered as global (in the stage's table)
  var height = 180
  var speed = 0
  # private (私有): truly local, visible only to this sprite
  private lastHeight
  list trail
  # comma-separated files; paths are relative to the directory of this .pseudo
  costume "assets/star.svg", "assets/ball.png"
  sound "assets/tone.wav"

  # custom block (def / 定义): param types num / str / bool (数 / 文本 / 布尔)
  def step(gravity: num):
    speed = speed + gravity

  # warp (不刷新) = don't refresh the screen at runtime; the whole body runs in one frame
  def repaintAll warp:
    repeat (200):
      stamp

  # green flag (绿旗): a hat always ends with a colon
  when green flag clicked:
    forever:
      step(1)
      if (height < 0):
        height = 0 - height
      else:
        say("still falling")

  when key pressed("space"):
    create clone myself

stage:
  when green flag clicked:
    hide variable(score)
```

The same skeleton in Simplified Chinese, for reference:

```
全局 分数 = 0
角色 球:
  变量 高度 = 180
  变量 速度 = 0
  私有 上一高度
  列表 轨迹
  定义 推进一步(重力: 数):
    速度 ← 速度 + 重力
  绿旗:
    重复 永远:
      推进一步(1)
      如果 (高度 < 0):
        高度 ← 0 - 高度
      否则:
        说("还在下落")
  当按键("空格"):
    克隆自己
舞台:
  绿旗:
    隐藏变量(分数)
```

**There are no trailing comments.** `#` / `//` only start a comment when the comment occupies a whole line. `#` also begins a colour literal (`set pen color to("#ff8800")`), so a `#` sitting after code on the same line is a colour, not a comment.

**Always prefer SVG for assets.** Scratch/TurboWarp re-encodes bitmap costumes (even PNGs get compressed); only vectors stay crisp. If you can draw it with `<rect>/<circle>/<line>`, don't ship a PNG.

## Custom blocks and `不刷新` (warp)

```
定义 名字(参数: 数) 不刷新:
```

- The modifier goes **after the block name (and parameter list), before the colon**. Aliases: `不刷新` / `不刷新屏幕` / `无刷新` / `warp`.
- **Block names and variable names are a single word** (lexically a single token — no spaces allowed): the English form uses camelCase like `placeFood` / `endGame`; writing `def place food warp:` is parsed as three words and errors.
- What gets emitted is `mutation.warp = "true"` on `procedures_prototype` and `procedures_definition` (a string — the VM `JSON.parse`s it).
- **When it's mandatory**: blocks that do dozens to hundreds of actions in one go, where a rendered intermediate state would look bad or stutter. The classics are
  **batch stamping** (clear the screen + redraw the whole scene `图章` (stamp) by stamp) and **list rebuilds**. Without warp, every loop iteration yields,
  and you see half-drawn intermediate frames — especially obvious with a long snake.
- **A hat fed by a repeated broadcast must be warp, or it never finishes.** `event_whenbroadcastreceived` is registered with `restartExistingThreads: true`,
  so every broadcast **restarts** a still-running receiver thread from the top block (`Runtime.startHats` → `_restartThread`). Broadcast the same message
  every frame (a per-frame `刷新…`) and a non-warp receiver whose body contains a `重复` loop is reset every frame: it gets one iteration per frame and
  never reaches the end. Measured on the tetris example — a `重复 (16)` scan inside `当收到("刷新方块")` sat at loop counter 1 forever, so the piece never
  drew; wrapping the same loop in a `定义 渲染方块 不刷新:` and calling it from the hat fixed it instantly. Put the *whole* loop in the warp block, not
  just the call.
- **When it's absolutely forbidden**: the block contains `等待` (wait) / `说等待` (say for seconds), or calls a block that does. Inside a warp frame,
  `wait` doesn't yield properly and just spins until the warp deadline (in scratch-vm, `Sequencer.WARP_TIME` = 500ms)
  before it emits. Keep time-waiting flows in ordinary blocks; carve out only the "pure computation / batch drawing" part.
- warp **inherits down the call chain** (`_StackFrame.create(parent.warpMode)`): blocks called from a warp block also become warp,
  so don't indirectly reach a block containing `等待` from inside a warp block.
- A variable used inside a custom block must still be declared (as a global, or `私有`/`局部` in the sprite) — a custom block does not implicitly introduce variables.
- **Define before you call.** Procedures are collected in a first pass, and (since 2026-10-02) that pass also precomputes each proc's
  `argIds` / `argByName` / `proccode`, so a call to a block whose `定义` appears *later* in the same sprite **no longer crashes** — it used to die with
  `Internal error: TypeError: Cannot read properties of undefined (reading 'forEach')`. Ordering definitions by dependency (`检测` → `锁定` → `下落一格`)
  and putting the hats last is still the readable convention, and mutual recursion remains inexpressible (no return values), but a forward call now just works.
- **Never name a variable or parameter after a built-in block alias.** The parser resolves an identifier to the block *first*, so a variable named
  `方向` (an alias of `motion_direction`) silently becomes the sprite's direction, a parameter named `方向` never binds (every body reference reads
  `motion_direction`, default 90), and there is **no warning**. Check every name with `node scripts/vocab.mjs --grep <name>` before using it; rename on a hit
  (e.g. `方向` → `玩家方向` / `dir`). Watch the usual suspects: `方向`, `距离`, `造型`, `大小`, `x 坐标`, `y 坐标`, `音量`.
- **A custom block's argument is resolved in the caller's scope** (fixed 2026-10-02; older copies resolved it in the callee's, so an argument whose name
  matched the callee's parameter — `引爆一颗(扫描)` — silently became that parameter and looped forever). Prefer argument names that differ from every callee's
  parameter name so the code reads unambiguously either way.

## Indentation and block boundaries

- Indentation (spaces) determines body ownership; hats are separated by blank lines.
- **Comments**: `#` or `//` at the start of a line, *or* trailing after any code line — including a
  target-level directive (`初始隐藏   # …`) and a `全局` declaration. The lexer cuts at the first
  `#` / `//` that is **outside a string literal**, so `说("a#b")` keeps its text. Added 2026-10-03
  (before that only whole-line comments parsed, and a trailing comment died with `Unrecognized
  character "#"`); pinned by `test/compiler.test.mjs`
  "inline # and // comments are ignored, and a # inside a string survives". Backwards compatibility is
  structural: `#` is absent from `PUNCT1` so it could only ever error, and `//` is not in `PUNCT2`, so
  a double slash lexed as two divisions and failed to parse — a line carrying either was an error
  before, never a meaning. Single-slash division (`甲 ← 乙 / 2`) is untouched.
- A C-shaped block = `名字(参数):` (name(params):) + an indented body; the `否则:` (else:) branch is optional (`如果…否则…` (if…else…) compiles to `control_if_else`, and both substacks must be emitted).
- A C-shape with no params can be written as just `并发执行:`; the `永远` (forever) modifier in `重复 永远:` is recognized as the forever flag.

## Statements, assignment, calls

| Form | Meaning |
|:--|:--|
| `名 ← 表达式` / `名 = 表达式` (name ← expr / name = expr) | Set a variable (`=` cannot be followed by another `=`) |
| `名 增加 表达式` / `名 减少 表达式` / `名 增加 by 2` (increase / decrease) | Change a variable |
| `说("hi")` (say) | Statements with params always use parentheses |
| `隐藏` (hide) / `下一个造型` (next costume) | Zero-param statements omit parentheses |
| `显示变量 高度` (show variable) | Menu/field params may omit parentheses (a bare word is taken as the param) |
| `推进一步(1)` (custom block call) | `名(` followed immediately by a paren is treated as a call |

**Assignment is `=` or `←`.** `<-` is not an operator (even though `->` is lexed).

## Expressions

- Infix (precedence comes from the catalog's `prec`): `+ - * / %`, `< > = == != <= >=`, `与 / 或` (and / or; the English `and` / `or` and `|` also work).
- Reporter blocks are called with parentheses: `连接("第 ", 计数器)` (join), `列表第项(i, 名单)` (item of list), `碰到("边缘")` (touching), `随机(-200, 200)` (pick random).
- **Chained comparisons are not supported** (`a < b < c` errors); write it with `与` (and).
- A boolean slot must hold a boolean reporter or a comparison expression; putting a number/text there is caught and errors — it is not silently coerced to 0.

## Menu params (quoting is the key)

Dropdown params must be written as **quoted strings**, using the Chinese label or the raw value:

- `当碰到("鼠标指针")` (touching "mouse-pointer"), `克隆("自己")` (clone "myself"), `停止("全部")` (stop "all"), `列表第项("末尾", 名单)` (item "last" of list)
- Only a quoted string goes through the dropdown; bare words/numbers are parsed as expressions (`MENU_SHADOW[kind].quoted`).
- Legal values are exactly the parenthesized contents `vocab.mjs` prints; a wrong one is rejected outright by a `strict` menu and **never** silently compiled into something else.
- Exception: `列表第项("全部", …)` must error — `all` is only legal for "delete item of list" (see `references/sb3-format.md`).

**English forms are quoted the same way**: dynamic menus use English labels — `touching("edge")`, `clone("myself")`, `stop("all")`, `item of list("last", …)`, `when key pressed("up arrow")`; static menus' raw values are themselves English — `go to front back("front")`, `mathop("abs", …)`, `set effect("COLOR", 10)`. A bare word only works when it's neither a variable name nor a block alias (`go to front back(front)` passes, but once `front` is declared as a variable it becomes a variable reference), so English examples always quote.

## Variable/list references

Field slots like `@LIST` / `@VARIABLE` take the variable name itself (`轨迹` (trail) in `加入列表(高度, 轨迹)`); the compiler fills in the id. When writing `.pseudo` you neither need to nor can write the id yourself.

## HUD monitors (`显示变量` / `隐藏变量` with mode and position)

`显示变量(名, "模式", x, y)` emits the block *and* registers a watcher in the project's `monitors[]`,
so the readout is already on the stage header when the project opens — no clone-built seven-segment
HUD needed (see `examples/tetris-zh-Hans.pseudo` for why you'd still want clones: a look, not a
necessity). `隐藏变量(名)` emits the block and marks the record invisible; use it for bookkeeping
variables (`在场子弹`) so the header stays clean.

```
    显示变量(分数, "大", 12, 12)      # large readout at (12,12)
    显示变量(命数, "默认", 12, 52)    # default bubble
    显示变量(音量倍, "滑杆", 0, 100)  # slider: the pair is min max, NOT position
    隐藏变量(在场子弹)
```

- Mode **must be a quoted string** (it's a label, like any menu param). Legal labels are in
  `MONITOR_MODE` in `src/core/catalog.js`: `默认 / 大 / 滑杆` (zh-Hans), `預設 / 大尺寸 / 滑桿`
  (zh-Hant), `default / large / slider` (en), `デフォルト / 大きく / スライダー` (ja). An unknown mode
  is a hard error, never a silent fallback.
- The trailing numbers come in pairs and their meaning depends on the mode: for `默认/大` they are the
  monitor's `x y`; for `滑杆` they are `最小 最大` (slider range, `isDiscrete` stays true) and the
  position is auto-placed. Odd counts error.
- Omitting the mode entirely (`显示变量(高度)`) gives a default monitor with `x: null, y: null`, which
  is Scratch's "auto-position" sentinel — don't write `null` yourself.
- If the variable's name is also a built-in alias, the arg stops being a variable name and you get
  `Field VARIABLE needs a name or text` (measured: `显示变量(音量, "大", 10, 200)` — `音量` is the alias
  for `sound_setvolume`). This one *does* throw, unlike trap #5's silent substitution inside
  expressions; rename the variable (check with `vocab.mjs --grep 音量`).
- **Initial visibility is decided by the first top-level script that touches the variable** (later
  `显示/隐藏` in other scripts is runtime behaviour only). This is a deliberate rule: a `绿旗` that
  shows a "message" monitor and then hides it should not leave it on screen when the project is
  opened. See `references/sb3-format.md` §"monitors[]".
- 显示列表 / 隐藏列表 emit their blocks but create **no** `monitors[]` record — list watchers are not
  implemented yet, so a list will not appear on the header when the project opens.

## Clones or pen?

To draw the same batch of things repeatedly (snake body, particles, grid cells), **prefer a clone pool** — don't use `图章` (stamp):

- The pen layer is a **bitmap**; `图章` rasterizes SVG costumes at stage resolution, so vector assets go blurry on the spot.
- A clone is a real sprite: vector-rendered, can switch its own costume / add effects, and doesn't depend on the pen extension.

The standard clone-pool pattern (**the original only builds the pool and never shows itself**):

```
角色 蛇身段:
  初始隐藏              # 见下方「为什么需要它」
  造型 "assets/身体.svg"
  # the clone's own index; the original is always 0, which is how it's excluded from display
  私有 段号 = 0
  私有 是克隆 = 0
  私有 位置码 = 0

  # build them all at once; without warp they pop out one per frame
  定义 补足克隆 不刷新:
    重复 (列表长度(蛇身) - 1 - 段号):
      段号 ← 段号 + 1
      克隆自己

  绿旗:
    隐藏
    是克隆 ← 0
    段号 ← 0
    重复 永远:
      补足克隆()
      等待 (0.05)

  当作为克隆体启动时:
    是克隆 ← 1

  当收到("刷新"):
    如果 (与(是克隆 = 1, 段号 + 1 <= 列表长度(蛇身))):
      位置码 ← 列表第项(段号 + 1, 蛇身)
      移到坐标(...)
      显示
    否则:
      隐藏
```

Two key points:

- **A `私有` (private) variable is copied into each clone**, so doing `段号 ← 段号 + 1` in the original and then immediately `克隆自己` (clone myself)
  hands the clone exactly that value — far more deterministic than "clones race for a global counter on startup" (whose allocation order
  is undefined). The cost is that the original's own `段号` keeps growing too, so you need a flag like `是克隆` (is clone) to exclude the original.
- **`广播` (broadcast) is received by every target**, including the original. So the receiving script must decide for itself "who am I".

### 为什么需要 `初始隐藏`

`隐藏` as the *first* block of the green-flag script only hides the original **after the flag is pressed**. Until then the original still
draws — in the Scratch/TurboWarp editor, in the packaged player before you hit ▶, and in the very first frame of the run. For a clone-pool
sprite that is a stray copy of the sprite sitting at (0,0), which reads as a bug ("计数器克隆体的本体好像没隐藏").

`初始隐藏` (also `开始隐藏` / `initially hidden` / `start hidden` / `初始隱藏` / `初期非表示`) sets the target's **saved** `visible` flag to
`false` in `project.json`, so the original is never drawn at all. It is a target attribute, not a statement — it emits no blocks, and it
must be written in the sprite header block (writing it on 舞台 is a compile error). Put it on every sprite whose original is only a pool
builder. This is the *only* difference between "hidden once the flag runs" and "hidden from the start":

```jsonc
// project.json, targets[i]
"visible": false   // ← 初始隐藏 writes this; without it the compiler writes true
```

## Known not done

- Return values from custom blocks (`返回` (return) is recognized but not supported as a reporter).
- `sensing_of` ("… of …") — the options are only known at runtime.
- Dropdown menus for hardware extensions (microbit / wedo2 / ev3 / boost / makeymakey / gdxfor / text2speech).
- List watchers: `显示列表` / `隐藏列表` emit their blocks but create no `monitors[]` record, so a list
  is not on the stage header when the project opens (only 显示变量/隐藏变量 register one).
- **Camera work.** `镜头横移 / 镜头纵移 / 场景对齐 / 镜头x / 镜头y`
  (`motion_scroll_right`, `motion_scroll_up`, `motion_align_scene`, `motion_xscroll`, `motion_yscroll`)
  are Scratch 2 **legacy no-ops**: scratch-vm registers them as `() => {}`
  (`.ref/package/src/blocks/scratch3_motion.js`), and hosted Stretch has no camera API. They are
  marked `noOp: true` in `catalog.js`, so the compiler emits the block **and** pushes one warning per
  opcode (`warnNoOp`) — never a silent dead block. For full-picture feedback use stage graphic effects;
  see `references/game-feel.md` §"Screen feedback".
