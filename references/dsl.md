# Pseudocode DSL (.pseudo)

Skeleton, indentation, declaration syntax. **Don't hand-copy block aliases or params** — fetch them live from the project's own catalog with `node scripts/vocab.mjs --grep keyword`; it reads the same table the compiler does.

## Skeleton

```
# A line starting with # is a whole-line comment
# global (全局): a stage-level variable, readable/writable by every sprite
global score = 0
global message = "hello"

# sprite — or stage / 舞台 / 角色
sprite ball:
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
- **When it's absolutely forbidden**: the block contains `等待` (wait) / `说等待` (say for seconds), or calls a block that does. Inside a warp frame,
  `wait` doesn't yield properly and just spins until the warp deadline (in scratch-vm, `Sequencer.WARP_TIME` = 500ms)
  before it emits. Keep time-waiting flows in ordinary blocks; carve out only the "pure computation / batch drawing" part.
- warp **inherits down the call chain** (`_StackFrame.create(parent.warpMode)`): blocks called from a warp block also become warp,
  so don't indirectly reach a block containing `等待` from inside a warp block.
- A variable used inside a custom block must still be declared (as a global, or `私有`/`局部` in the sprite) — a custom block does not implicitly introduce variables.

## Indentation and block boundaries

- Indentation (spaces) determines body ownership; hats are separated by blank lines.
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

## Clones or pen?

To draw the same batch of things repeatedly (snake body, particles, grid cells), **prefer a clone pool** — don't use `图章` (stamp):

- The pen layer is a **bitmap**; `图章` rasterizes SVG costumes at stage resolution, so vector assets go blurry on the spot.
- A clone is a real sprite: vector-rendered, can switch its own costume / add effects, and doesn't depend on the pen extension.

The standard clone-pool pattern (**the original only builds the pool and never shows itself**):

```
角色 蛇身段:
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

## Known not done

- Return values from custom blocks (`返回` (return) is recognized but not supported as a reporter).
- `sensing_of` ("… of …") — the options are only known at runtime.
- Dropdown menus for hardware extensions (microbit / wedo2 / ev3 / boost / makeymakey / gdxfor / text2speech).
