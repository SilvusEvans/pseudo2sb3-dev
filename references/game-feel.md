# Game-feel playbook (non-linear movement and other "arcade juice")

Everything here is measured, not inferred: the idioms compile from
`<repo dir>/examples/asteroids/asteroids-zh-Hans.pseudo` (小行星, 488 blocks · 6 targets) and every
number quoted below is an assertion that passes in `<repo dir>/examples/asteroids/verify.mjs`
(real scratch-vm, frame-stepped). Read `references/dsl.md` for syntax and
`references/workflow.md` §"Per-example asset + verification harness" for how to write the harness.

## The frame pump

One sprite owns the clock; everything else is a receiver. `广播并等待` (broadcast and wait) makes the
frame atomic — all receivers finish before the pump moves on — and every per-frame step block is
`不刷新` (warp), which rule 6 requires anyway.

```
  # 主泵单独一条 绿旗 脚本（绿旗可以有多个脚本）
  绿旗:
    重复 永远:
      广播并等待("每帧")
      等待 (0.02)
```

`等待 (0.02)` with a 480×360 stage gives ~30 logic frames/s. If a receiver is *not* warp-wrapped,
`restartExistingThreads: true` on `event_whenbroadcastreceived` restarts it from the top every frame,
so a `重复 (16)` scan inside it never finishes iteration 1 (measured on the tetris example).

## Non-linear movement

### Thrust decomposition: x ← sin, y ← cos — never the textbook (cos, sin)

Scratch's direction 0 points **up** and grows **clockwise**, and `motion_movesteps` in scratch-vm
computes `radians = degToRad(90 - direction); dx = steps*cos(radians); dy = steps*sin(radians)`, i.e.
**dx = sin(dir), dy = cos(dir)** (`.ref/package/src/blocks/scratch3_motion.js`, `moveSteps`). Any
velocity you build yourself must use the same pairing, or thrust is rotated 90°: aim right, accelerate
up. `verify.mjs` checks it the honest way — it presses ↑, then asserts the thrust vector's dot product
with the heading unit vector is positive (so a 90° error cannot pass), and that the speed actually
grows.

```
      速度x ← 速度x + (数学("sin", 方向) * 0.12)
      速度y ← 速度y + (数学("cos", 方向) * 0.12)
```

### Inertia: key adds to a *rate*, the rate decays

Writing `右转 (3)` per keypress feels like a robot. Add to `角速度` and decay it; the ship keeps
turning after you let go, so corners are arcs.

```
    如果 (按键按下("左")):
      角速度 ← 角速度 - 0.9
    如果 (按键按下("右")):
      角速度 ← 角速度 + 0.9
    角速度 ← 角速度 * 0.9
    右转(角速度)
```

`verify.mjs` asserts three things separately: the rate is still > 0.5 after the key is released
(not a hard turn), the heading keeps changing over the next 8 frames (7.757 → 0.943 in the last run),
and the rate is strictly shrinking.

### Damping + a Pythagorean speed cap, with the sequential-assignment trap

`速度 ← 速度 * 0.99` makes released ships drift instead of stopping. To bound it without a hard clamp
(which flattens the trajectory), scale both components by `limit / |v|`:

```
    如果 (速度x * 速度x + 速度y * 速度y > 36):
      限速 ← 6 / 数学("平方根", 速度x * 速度x + 速度y * 速度y)
      速度x ← 速度x * 限速
      速度y ← 速度y * 限速
```

**The factor must be computed once into its own variable.** `←` is an in-place, top-to-bottom
assignment: if you inline the fraction into both lines, the second line reads the *already scaled*
`速度x`, and the real cap becomes 6.010 instead of 6 (this overshot before the fix; `verify.mjs` now
peaks at exactly 6.00000 over 80 frames). Same trap applies to any two assignments sharing a
subexpression — snapshot, then use.

### Screen wrap in one line with 取余

Scratch's `取余` (mod) returns a **non-negative** result for a positive divisor, so a full-period
offset plus a negative shift wraps in both directions with no conditionals:

```
    x设为(取余(x坐标 + 240, 480) - 240)
    y设为(取余(y坐标 + 180, 360) - 180)
```

`verify.mjs`: put the ship past the right edge, step, assert x came back near −238.

### Blink without an extra timer

Derive phase from `计时器` instead of counting frames: `floor(t*10) % 2` toggles every 0.1 s.

```
      特效设为("虚像", 取余(数学("向下取整", 计时器 * 10), 2) * 50)
```

Paired with an absolute deadline (`如果 (计时器 < 无敌到)`, set as `计时器 + 2.5`), this is the
post-hit invincibility — no bookkeeping variable for the flash itself.

## Screen feedback: 镜头 blocks are dead, use stage effects

`镜头横移 / 镜头纵移 / 场景对齐 / 镜头x / 镜头y` (`motion_scroll_right`, `motion_scroll_up`,
`motion_align_scene`, `motion_xscroll`, `motion_yscroll`) are **legacy no-ops** — scratch-vm registers
them as `() => {}` (`.ref/package/src/blocks/scratch3_motion.js`, "Legacy no-op blocks"), and hosted
Stretch has no camera API at all, so a camera shake/pan is not expressible. The compiler now emits the
blocks but pushes a warning (`catalog.js` `noOp: true` → `warnNoOp`), so a silent-dead choice can't
survive a build.

What *does* affect the whole picture is the **stage's own graphic effects**. Put the shake on 舞台
— `特效设为` on 舞台 really writes `stage.effects`, and 舞台 accepts `定义`/`绿旗`/`当收到` hats, both
confirmed by running a throwaway probe project in a headless scratch-vm (scratch-vm without a
renderer still keeps target state and effects, only the drawing is missing). Oscillate between two
magnitudes so it reads as a jolt rather than a slow blur:

```
舞台:
  定义 屏幕受击 不刷新:
    如果 (震屏 > 0.2):
      特效设为("像素化", 震屏 * (1 + 取余(数学("向下取整", 计时器 * 30), 2)))
      特效设为("马赛克", 震屏 * (2 - 取余(数学("向下取整", 计时器 * 30), 2)) * 0.5)
      震屏 ← 震屏 * 0.72
    否则:
      如果 (震屏 > 0):
        特效设为("像素化", 0)
        特效设为("马赛克", 0)
        震屏 ← 0
```

`verify.mjs` samples the trace inside one polling window and asserts ratio = 0.72 exactly
(4.320 → 3.110), monotone decay, and that both effects are back at 0 afterwards (no residue).
Note the threshold branch: without it the tiny residual never reaches 0 and 像素化 stays slightly
on forever.

## Particles: clone pool with drag + shrink + fade

One broadcast handler spawns a burst; each clone owns its own decay. Drag (`* 0.9`) plus size decay
plus `虚像 = 100 - 大小` gives a nonlinear burst where a single expression handles both "getting small"
and "getting transparent".

```
  定义 喷一簇(个数: 数) 不刷新:
    重复 (个数):
      航向 ← 随机(0, 359)
      速度x ← 数学("sin", 航向) * 随机(1.5, 4.5)
      速度y ← 数学("cos", 航向) * 随机(1.5, 4.5)
      寿命 ← 随机(14, 26)
      造型号 ← 随机(1, 3)
      大小设为(100)
      特效设为("虚像", 0)
      移到坐标(爆x, 爆y)
      克隆自己
```

Random direction *and* random speed *and* random lifetime — don't lay particles out with
`移到坐标` on a ring; the irregularity is the point. Because `sensing_of` is unsupported, the burst
origin is passed through globals (`爆x` / `爆y`) that the dying object writes right before
`广播("爆炸")`. `verify.mjs` asserts 7 spark clones appear and all delete themselves.

## Clone lifecycle: seed before `克隆自己`, mark inside the clone hat

A clone inherits the original's private variables **and position at the moment of creation**, so write
the parameters first, then clone (deterministic, unlike racing for a global counter):

```
    重复 (目标):
      尺寸 ← 随机(2, 3)
      航向 ← 随机(0, 359)
      速度x ← 数学("sin", 航向) * (0.7 + (等级 * 0.15))
      ...
      移到坐标(随机(0 - 235, 235), 随机(0 - 170, 170))
      克隆自己
```

The inherited `是克隆` is still `0`, so the flag **must** be re-set in the hat, or every
`如果 (是克隆 = 1)` gate never opens and nothing moves:

```
  当作为克隆体启动时:
    是克隆 ← 1
    显示
```

`显示` belongs in the hat, not in the spawn block: otherwise the original sits visibly on top of the
ship at the muzzle for a frame (this was the 子弹 bug — a white dot stuck at the ship).

Splitting is done by the *hit* asteroid itself (it clones twice then deletes itself) while the bullet
only flies and expires; declaring 小行星 before 子弹 makes the hit test run before the bullet is
collected within the same frame.

## HUD: monitors, not seven-segment clones

`显示变量(分数, "大", 12, 12)` both emits the block and registers a record in `monitors[]`, so the
readout is on the header the moment the project opens. Compare the tetris example, which hand-builds a
10-clone seven-segment display precisely to *avoid* watchers — use monitors unless you need the look.
Bookkeeping variables get `隐藏变量(在场子弹)` so the HUD stays clean. See
`references/sb3-format.md` §"monitors[]" for the shape and the first-script visibility rule.

## Pause, cooldown and cleanup — the three gates that broke first

1. **The toggle must live outside the `进行中 = 1` gate.** `开关与清场()` (which reads the P key) is
   the first call in the frame handler, before the gate — if it were inside, setting `进行中 ← 0`
   would stop the handler from ever seeing the key again and the game would be unpausable.
2. **Every cooldown compares `<= 0`, not `= 0`.** A counter that self-decrements every frame skips 0
   whenever the decrement and the check are in the same statement list, so `如果 (暂停冷却 = 0)` is
   true only on the first frame ever and the key stops working.
3. **Pause is not "the game ended" — cleanup needs its own condition.** The per-frame cleanup was
   keyed on `进行中 = 0`, so pressing P deleted every asteroid. It now also requires `命数 <= 0`:

```
  当收到("每帧"):
    如果 (是克隆 = 1):
      如果 (进行中 = 1):
        漂移()
        如果 (碰到("子弹")):
          分裂()
      否则:
        如果 (命数 <= 0):
          隐藏
          删除克隆体
```

   (`停止("全部")` does **not** delete clones, so the clones must retire themselves.)

4. **A plain `广播` starts receivers next frame — a level trigger needs a cooldown.** `广播("新关卡")`
   is not synchronous, so `在场小行星 = 0` stays true for another frame and the wave is spawned twice.
   `关卡冷却 ← 30` plus `如果 (与(在场小行星 = 0, 关卡冷却 <= 0))` fixes it, and the same 30 must be
   pre-loaded in `绿旗` before the first broadcast.

5. **A per-frame-polled key gate can drop a very short tap.** `开关与清场` reads `按键按下("p")` once per
   frame, so a keypress shorter than the poll interval is invisible: `page.keyboard.press('p')` (≈10 ms
   down+up) failed to pause in `examples/asteroids/browser-verify.mjs` while `down` → 150 ms → `up` worked.
   A human tap is ≥ 50 ms, so the shipped control is fine — but for an action-critical one-shot switch
   prefer an **edge-triggered hat** (`event_whenkeypressed`) over polling, and if you must poll, keep the
   latch/cooldown (`暂停冷却 ← 24`) so a held key can't toggle every frame. When a browser assert "fails to
   press a key", check the synthetic press duration before blaming the project.

## Score/behaviour invariants worth asserting

Rather than asserting exact random positions, assert relationships that must hold for every roll:
`gain % 5 === 0 && gain >= 5 * grew` for `(4 - 尺寸) * 5` scoring plus splitting, bullet count
bookkeeping ≤ the on-screen clone count and ≤ the 8-cap, and "no `PROJECT_RUN_ERROR`". Those caught
the double-spawn and the counter drift while random motion made absolute values meaningless.
