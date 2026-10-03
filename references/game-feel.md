# Game-feel playbook (non-linear movement and other "arcade juice")

Everything here is measured, not inferred: the idioms compile from
`<repo dir>/examples/asteroids/asteroids-zh-Hans.pseudo` (小行星, 545 blocks · 7 targets · 11 monitors)
and every number quoted below is an assertion that passes in
`<repo dir>/examples/asteroids/verify.mjs` (real scratch-vm, frame-stepped) and in
`browser-verify.mjs` (real TurboWarp web build, 41 asserts). Read `references/dsl.md` for syntax and
`references/workflow.md` §"Per-example asset + verification harness" for how to write the harness.

The last three sections (white flash, eased counter, sound) come from griffpatch's *space shooter*
tutorial series — `https://space.bilibili.com/3546570486188620/lists/4564698?type=season`
(《Scratch 3 教程：太空射击游戏》, 6 parts, uploaded by KidsLearning). Porting ideas from that kind of
series is a productive loop: watch which *feedback* the tutorial adds (flash / counter / SFX), then
re-implement it with what this DSL can actually emit — the mapping is rarely 1:1, and the mismatch is
the interesting part. When you need the episode list, note that Bilibili's
`x/polymer/web-space/seasons_archives_list` API paginates with **`page_num`** (not `page_no`; the wrong
name returns `-400 请求错误`), and needs no WBI signature when fetched from a bilibili page context
with `credentials:'include'`.

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

`verify.mjs` samples the trace inside one polling window and asserts the ratio between two
*consecutive distinct frame values* is 0.72 exactly, monotone decay, and that both effects are back at
0 afterwards (no residue). Note the threshold branch: without it the tiny residual never reaches 0 and
像素化 stays slightly on forever.

**Compare adjacent *distinct* values, not adjacent *sample points*.** One `每帧` broadcast can be
observed several times from a poll loop that runs faster than the VM's step budget, so a dense trace
contains same-frame duplicates and `trace[1]/trace[0]` returns 1.0000 instead of 0.72. Dedupe first:
`const steps = trace.filter((v, i) => i === 0 || v !== trace[i - 1])`.

## White flash: a full-stage sprite, not an effect

A hit that kills the ship should *sting*. Screen shake (stage 像素化/马赛克) reads as blur; what arcade
games add on top is a full-screen white frame that decays. There is no stage-level "brightness/flash"
effect in the DSL, so the idiom is **a dedicated sprite holding one 480×360 white SVG**, drawn last:

```
角色 白闪:                      # 声明在最后 → 画在最上层（绘制顺序=声明顺序）
  初始隐藏
  造型 "assets/asteroids/白闪.svg"
  私有 闪光强度 = 0             # 自己的名字取特别一点，见下面第三条
  定义 闪光衰减 不刷新:
    如果 (闪光强度 > 6):
      闪光强度 ← 闪光强度 * 0.75
      特效设为("虚像", 100 - 闪光强度)
    否则:
      如果 (闪光强度 > 0):
        闪光强度 ← 0
        特效设为("虚像", 0)
        隐藏
  当收到("白闪"):
    闪光强度 ← 100
    特效设为("虚像", 0)
    显示
  当收到("每帧"):
    闪光衰减()
```

and the dying ship just fires the level trigger — `广播("白闪")` right next to `广播("爆炸")`. Three
numbers and two name choices are load-bearing:

- **decay 0.75, start at 100, hide below 6** ⇒ 100 → 75 → 56 → 42 → 32 → 24 → 18 → 13 → 10 → 7.5 →
  5.6 → hide, i.e. ~11 frames ≈ 0.4 s at the ~30 fps frame pump. Start at a *round 100*: the ghost
  effect is `100 - 强度`, so the first draft's 92 meant the "full white" frame was actually 8%
  transparent. The other number that was tried, decay 0.55 (≈ 200 ms total), made
  `browser-verify.mjs` poll at 150 ms sample *nothing* and report "flash never appeared" while the
  screenshot clearly showed one. Either poll faster (40 ms) or make the effect longer; do not start by
  blaming the project.
- **The overlay reads its own private strength variable, and that variable wants a distinctive name.**
  `闪光强度` rather than `亮度`: `亮度` is the menu word for the BRIGHTNESS effect (`特效设为("亮度", …)`)
  and `画笔亮度设为` is a real alias, so a variable with that name is confusing right where the effect
  API is being used. It compiles (measured with a throwaway probe: `私有 亮度` / `全局 亮度` both emit
  `data_setvariableto` with the variable id) — this is a readability choice, **not** a workaround. The
  actual alias traps are in the clone-pool playbook: `方向` is the *silent* kind (substituted inside
  expressions, no warning), `音量` is the loud kind (throws at the `显示变量` VARIABLE field). Check any
  candidate name with `node <skill dir>/scripts/vocab.mjs --grep 名字`, run it from the repo directory
  or it can't find `src/core/catalog.js`.
- **`初始隐藏` + declared last** — the pool rule applies, and draw order is declaration order, so an
  overlay sprite has to come after everything it covers.

`verify.mjs` samples 震屏 and 闪光强度 in the *same* `peak(8, …)` loop: a second sampling pass would
consume the shake's decay window (6 → ~0.24 in 8 frames) and make the 0.72 ratio unreadable. Browser
side, `browser-verify.mjs` records `闪光强度` + `白闪.visible` per poll, screenshots
`out/asteroids-turbowarp-白闪帧.png` on the first "visible && > 30" sample, then waits for the
self-hide. Set the record threshold below the second frame's value (56) or you assert "covered the
screen" on a flash you literally captured proof of.

## Eased counters: let the HUD chase the real number

griffpatch's Part 4 makes the score display tick up instead of jumping. In Scratch the usual way is a
seven-segment clone rig — but this tool has monitors, so keep the clone rig out and put the easing on a
**bookkeeping variable the monitor reads**:

```
全局 显示分数 = 0
  定义 分数追赶 不刷新:
    如果 (显示分数 < 分数):
      显示分数 ← 显示分数 + 数学("向上取整", (分数 - 显示分数) * 0.25)
    否则:
      如果 (显示分数 > 分数):
        显示分数 ← 分数          # 分数 被往下改（重开/扣分）时立刻吸附，不回滚动画
```

with `显示变量(显示分数, "大", 12, 12)` in the HUD and `隐藏变量(分数)` — the real score becomes pure
bookkeeping. Three details:

- **`向上取整` is what makes the last point land.** Truncated multiplication asymptotically stalls one
  short; `ceil(diff * 0.25)` is ≥ 1 whenever `显示分数 < 分数`, so convergence is finite (verify.mjs
  loops ≤ 40 frames from 0 to 500 and asserts monotone + exact arrival).
- **Call it outside the `进行中 = 1` gate** (right after `开关与清场()`), like the pause toggle. Inside
  the gate, pause or game-over would freeze the counter mid-chase and the player would see a score that
  never matches what they earned. `browser-verify.mjs` asserts `显示分数 === 分数` on the GAME OVER
  screen for exactly that reason.
- **Snap on the lower direction only.** Chasing in both directions turns a life-penalty into an
  animation; you want the readout to fall instantly and climb lazily.

## Sound: synthesized WAV, pitch jitter, and what headless does with it

`.sb3` sound assets are **16-bit PCM mono RIFF WAV** — `src/core/project.js`'s `wavInfo()` reads the
header itself and the sound entry stores `rate` + `sampleCount`, so mp3/AIFF or stereo will not pass.
There is no need to hunt for a sound pack: `examples/asteroids/gen-assets.mjs` writes them from code,
next to the SVGs, with a ~30-line synth (one LCG for repeatable noise):

```
const RATE = 22050;
const pcmWav = samples => { /* RIFF/fmt/data header, Int16 LE frames, mono, rate = RATE */ };
const synth = (secs, f) => Array.from({length: Math.round(secs * RATE)}, (_, i) => f(i / RATE, i, n));
const lowpass = (s, win) => /* moving average: cheap stand-in for a resonant filter */;
const rnd = () => /* one seeded LCG, so the noise is byte-identical between runs */;
// 激光 = 方波，频率 180 + 900·e^(-28t)（1080 → 180 Hz 的下扫"pew"），0.14 s
// 爆炸 = lowpass-10 噪声叠 70 Hz 指数下滑正弦，0.38 s
// 沉船 = lowpass-26 噪声叠 150 → 40 Hz 轰鸣，0.75 s
// 升级 = [660,880,1320] 三音上行琶音 ×0.09 s；游戏结束 = [392,311,262] 下行小调 ×0.18 s
```

DSL side: `声音 "assets/asteroids/激光.wav"` in the sprite header, then in the *action* block:

```
      音效设为("音调", 随机(0, 24))     # 子弹：每次偏高一点点
      播放声音("激光")
```

- **Vary pitch per shot** so a repeated one-shot sample doesn't machine-gun. 音调 100 = one octave, so
  飞船 uses `随机(0, 4) * 10 - 20` (±2 semitones) and 子弹 `随机(0, 24)`. 小行星 instead maps pitch to
  *state*: `100 + (2 - 尺寸) * 60` ⇒ 大 40 / 中 100（素材原调）/ 小 160 — one asset, big rocks thud,
  fragments ping. Get the sign right: the first draft `(尺寸 - 3) * 90` put the biggest rock at 0
  (two octaves down, mud) and made the direction run backwards, which no assert caught because
  nothing in the harness listens.
- **Only ever `播放声音` (non-blocking) in a frame-pump game.** `播放声音并等待` needs the sound to
  finish; in a headless scratch-vm there is no `soundBank`, so `_playSound` returns early and
  `waitingSounds` is never cleared — the thread stalls forever and, since the pump uses
  `广播并等待`, so does the whole game. `verify.mjs` passing at all is the proof the example avoided it.
- **`播放声音` in headless is a silent no-op, and that's fine**: `scratch3_sound.js` checks
  `if (sprite.soundBank)` before playing, so the block just falls through. Never assert "sound played"
  in Node; assert it statically (per-sprite `sounds[]` names, `rate`, `sampleCount`) and let the
  browser run prove playback.
- **The TurboWarp web build has no `soundBank.bufferStore`** (its engine exposes
  `audioEngine/soundPlayers/playerTargets/soundEffects/effectChainPrime`), so the buffer-store route you
  might reach for is a dead end. Probe behaviorally instead: wrap the bank and record calls.

```js
  const bank = sprite.sprite.soundBank;
  const byId = Object.fromEntries(sprite.sprite.sounds.map(s => [s.soundId, s.name]));
  window.__snd = [];
  const orig = bank.playSound.bind(bank);
  bank.playSound = (target, soundId) => { window.__snd.push(`${target.getName()}:${byId[soundId]}`); return orig(target, soundId); };
```

Then `ok(played.includes('子弹:激光'))` after firing, `'飞船:沉船'` after a collision, and
`'时钟:游戏结束'` on the GAME OVER screen — real evidence the extension-free sound path works, without
needing to hear anything.

## Costume geometry: the pivot, the swap, and the size↔costume index

Three bugs a user reports as "转起来怪怪的 / 越打越大", all fixed in `examples/asteroids` and all now
pinned by asserts in `verify.mjs`'s asset-geometry block (which reads the SVGs from disk, so the
*artwork* is under test, not just the blocks):

- **The rotation pivot is the viewBox center, so the silhouette must be symmetric about it.** Scratch's
  rotation center for a vector costume is `viewBox` center (= `costume.rotationCenterX/Y` in the built
  `.sb3`, = half the canvas size). The 飞船 wedge was drawn `21,0 -17,-15 -9,0 -17,15` — nose 21, stern
  17 — so its bounding-box center sat 2 units *ahead* of the pivot and the hull swung around a point
  behind its own middle. Fix: recentre the polygon (`19,0 -19,-15 -11,0 -19,15`), don't just enlarge
  the canvas. Assert on the artwork: `min(x) === -max(x)`.
- **A costume swap replaces the *whole* drawing.** 飞船 has two costumes and switches with
  `换成造型(推进中 + 1)`, so a flame-only 火焰 costume made the ship *vanish* whenever the thruster was
  held. Every "ship + accessory" costume has to repeat the base artwork (flame first, then the hull
  polygon on top), and both canvases must share the same physical origin — 火焰 is 88×32 with
  `viewBox "-44 -16 88 32"` while 飞船 is 44×32, both centered on (0,0), so switching never moves the
  pivot. Assert: the flame costume's rightmost point equals the hull's.
- **A numeric size and a costume index run in opposite directions — assert the visual, not the number.**
  `尺寸` counts *up* as rocks get smaller (scoring `(4-尺寸)*5`, pitch, spawn `随机(2,3)`), while the
  costume list is declared 大、中、小 = 1、2、3. `换成造型(尺寸)` therefore drew the smallest rock for the
  biggest value: every hit made the asteroid *grow* on screen, while all the score/bookkeeping asserts
  stayed green. The fix is `换成造型(4 - 尺寸)`; the lesson is that a numeric invariant can't see an
  inverted index, so the harness also asserts `clone.currentCostume === 3 - 尺寸` (0-based) for every
  live clone and for the two fragments after a split. Keep the collision-radius table honest by reading
  it off the artwork (max |coordinate|: 小 8.2 / 中 18.9 / 大 34.4), not from memory.

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

And a monitor can display an *animated* number: point it at a bookkeeping variable that chases the real
one each frame ("Eased counters" above), and the readout ticks up without a single clone.

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
