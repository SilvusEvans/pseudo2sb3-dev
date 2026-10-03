# .sb3 block-graph shape

Only the parts that lie; standard field naming follows scratch-vm/scratch-parser.

## Container and ids

- `.sb3` = a zip: `project.json` + `<md5>.<ext>` assets. `targets[0]` must be the stage.
- The block graph is `target.blocks` = a flat table of **{block id: block}**.
- **A serialized block object has no inner `id` field** — the only way to get ids is `Object.entries(t.blocks)`. Reading `b.id` is always undefined, and that's the most common self-check false negative.
- Block fields: `{opcode, next, parent, inputs, fields, shadow, topLevel, x, y}`.

## Slot (input value) encoding

| Form | Meaning |
|:--|:--|
| `[1, [type, value]]` | Primitive-value slot. E.g. `[1,[4,10]]` number, `[1,[10,"猫"]]` text, `[1,[9,"#ff0000"]]` colour |
| `[1, block-id string]` | Another block stuffed into the slot (a reporter nested in) |
| `[2, first-block-id]` | **Substack/boolean slot.** The id is at **index 1**, not wrapped in an array |
| `[3, shadow-block-id]` or `[3, shadow-block-id, value-slot]` | A slot with a shadow default value |

Primitive type numbers (`PRIMITIVE_NAMES` in `src/core/validate.js`, matching scratch-vm):
`4 num, 5 posNum, 6 wholeNum, 7 int, 8 angle, 9 color, 10 text, 11 broadcast, 12 variable, 13 list`

- A variable/list/broadcast value is `[name, id]`, and **the id must be findable in some target's registry**. A `["队列"]` shape missing its id silently loses its link in Scratch.
- A numeric slot may be a string (real Scratch files often have `[4,"3"]`) — don't assert it as a number.

## Where variables, lists, and broadcasts are registered

`target.variables` / `target.lists` are **`{id: [name, value]}`**; broadcasts are `target.broadcasts = {id: name}`.

**Register ids using the object keys**: `v[1]` gives the variable's current value, not its id. This is the easiest place to get it wrong when writing a self-check script (the first version of this repo's `inspect-sb3.mjs` tripped on it).

In pseudocode, `变量 x = 0` inside a sprite block is emitted as **global** (registered in the stage's `variables`); for a local one write `私有 变量` / `局部 变量`. So when checking references, union the keys of all targets.

## Dropdowns: field vs shadow block (the most important fork)

| Menu kind | Emission | Example |
|:--|:--|:--|
| Core static dropdown (options hardcoded in the scratch-blocks source) | **a field on the parent block**, whose value must be that raw value from the source | `停止(@STOP_OPTION)`, `数学运算(@MATHOP)` |
| Runtime/extension menu (options require looking up sprites, variables, assets) | **value input + shadow dropdown block** | `克隆(CLONE_OPTION:menu:clone)`, `造型(@VARIABLE)` |

- A wrong value in a static field doesn't error — Cast quietly turns it into 0/the first option — so it must come from generated data, never from memory.
- `MENU_SHADOW[kind]` flags: `isField` (emit as plain text/field rather than a shadow block), `strict` (an unknown name errors outright, no guessing), `quoted` (only a quoted string goes through the dropdown; bare words and numbers are still parsed as expressions), `from:{ext,menu}` (option source, used by `check-catalog` to trace back to source files).
- `staticMenu(block, field, 中文标签表)` (Chinese label table) builds the option table; labels are only for humans — **what's sent to Scratch is the value** (e.g. `末尾→last`, `全部→all`, `随机→random`).

## List-index semantics (a shared TurboWarp/Scratch trap)

`Cast.toListIndex(index, length, acceptAll)`:

- `data_deleteoflist`'s menu is `data_listindexall`, options `1 / last / all` — **only here is `all` accepted**.
- Everything else (`item#`, `insert`, `replace`, `delete`) uses `data_listindexrandom`: `1 / last / random`.
- Writing "全部" (all) into `列表第项("全部", x)` must error and must not compile.

## TurboWarp's `toJSON()` is a string — and property reads off it silently give `undefined`

In the TurboWarp **web** build `vm.toJSON()` returns the serialized project **as a string**
(`typeof` measured in `examples/asteroids/browser-verify.mjs`), so `vm.toJSON().monitors` is not "missing
monitors", it's a property read off a string. `JSON.parse(vm.toJSON()).monitors.length` matched the file
exactly. Node's npm `scratch-vm` returns an object, which is why this only bites in the browser.

Separately, **don't use toJSON's block count as a criterion** (it may omit shadow blocks like
`event_broadcast_menu` and `data_listcontents`, while they really exist in
`runtime.targets[i].blocks._blocks`); the way to prove a block is alive is to click the green flag and run
it, then read `target.variables` values, list contents, and `runtime.threads.length` — or read the runtime
map directly (`runtime.getMonitorState().get(<variable id>)`; that bundle's map has only
`get/has/values/valueSeq/size`, so `forEach`/`toArray` throw).

## `monitors[]` — the stage-header watchers

`project.json` has a top-level `monitors: []` next to `targets` (it is **not** inside a target). The
authoritative shape is `MonitorRecord`, an immutable `Record` in
`scratch-vm/src/engine/monitor-record.js` (read it in `node_modules/scratch-vm/dist/node/scratch-vm.js`
by searching `./src/engine/monitor-record.js`), whose **complete** key set is:

```jsonc
{
  "id": "d9b03801e4",       // for data_variable: exactly the variable's own id in targets[i].variables
  "mode": "default",         // default | large | slider
  "opcode": "data_variable",
  "params": {"VARIABLE": "分数"},
  "spriteName": null,        // null for stage variables; a sprite name re-binds the watcher (see below)
  "value": 0,                // the variable's initial value, so the header is right before ▶
  "width": 0, "height": 0,
  "x": null, "y": null,      // (null, null) == "auto-position" — a real comment in monitor-record.js
  "sliderMin": 0, "sliderMax": 100,
  "isDiscrete": true,
  "visible": true
}
```

(That is byte-for-byte what `examples/asteroids/asteroids-zh-Hans.pseudo` produces for `分数`;
`targetId` is intentionally absent, since `MonitorRecord` defaults it to `null` and `spriteName` does
the binding.)

- **`id` is the variable's id, not a block id.** `data_variable` monitors read
  `params.VARIABLE` + `targetId`/`spriteName`, so writing a fresh random id gives you a watcher that
  exists but never follows the variable.
- **`spriteName` is how a `私有` (local) variable's watcher survives a rename or a re-save**:
  `deserializeMonitor` looks the sprite up *by name* and overwrites `targetId` from it
  (`scratch-vm` — "If the serialized monitor has spriteName defined, look up the sprite by name").
  Emit `spriteName: null` for stage variables; if the named sprite is missing it logs
  "Tried to deserialize sprite specific monitor … but could not find sprite …" and the watcher is dead.
- **`mode: "slider"` puts the range in `sliderMin`/`sliderMax` and leaves `x`/`y` null** — a slider has
  no separate position pair in our DSL (measured through the CLI: `显示变量(计数, "滑杆", 0, 100)` →
  `slider … x=null y=null 范围 0–100`). Passing four numbers is a hard error, not a guess.
- **No extra keys.** Anything the compiler uses for bookkeeping must be stripped at `finish()` —
  `validate.js` only checks `monitor 缺 id`, so a leaked field compiles clean and just isn't part of
  Scratch's record. (Real case: the internal `script` counter leaked until `finish()` started doing
  `.map(({script, ...m}) => m)`; `test/compiler.test.mjs` asserts `'script' in m === false`.)
- **Initial `visible` = the first top-level script's decision.** `registerMonitor` tags each record
  with `this.scriptSeq` (one per top-level item) and only lets writes in that same script set
  `visible`. Later scripts' `显示变量/隐藏变量` are runtime behaviour and must not change what the
  project looks like when it opens. Without this rule, `绿旗: 显示变量(消息) … 隐藏变量(消息)` plus a
  later `当收到("游戏结束"): 显示变量(消息)` left the GAME OVER bubble on the header at open.
- At load, the VM creates **one monitor thread per record**: assert
  `runtime.getMonitorState().size === monitors.length`. A runtime `显示变量` flips that record —
  `runtime.getMonitorState().get(id).visible === true` — which is how `examples/asteroids/verify.mjs`
  proves the message HUD lights up mid-game rather than trusting the emitted block.
- **The emitting side to copy is `serializeMonitors`** in `scratch-vm/src/serialization/sb3.js`, which
  writes exactly `id, mode, opcode, params, spriteName, value, width, height, x, y, visible` and adds
  `sliderMin / sliderMax / isDiscrete` only when `mode !== 'list'`. On the reading side,
  `deserializeMonitor` special-cases `data_variable` / `data_listcontents` and any sprite-specific
  monitor, so a key outside that list is ignored rather than honoured — matching the emitter is the
  only safe target.

## Custom blocks (procedures)

- `procedures_definition` + `procedures_prototype`; parameter ids are described by `mutation.wxml`/`argumentids`; the caller is `procedures_call`.
- A call block's input keys carry parameter ids (e.g. `inputs["c2cd9dc79c"]`), not fixed names — expect dynamic keys when finding slots by opcode.
- Return values from custom blocks are currently **not supported** (deliberately not done).
