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

## TurboWarp's toJSON under-reports

`vm.toJSON()` may omit shadow blocks like `event_broadcast_menu` and `data_listcontents`, but they really exist in `runtime.targets[i].blocks._blocks`.

So **don't use toJSON's block count as a criterion**; the way to prove a block is alive is to click the green flag and run it, then read `target.variables` values, list contents, and `runtime.threads.length`.

## Custom blocks (procedures)

- `procedures_definition` + `procedures_prototype`; parameter ids are described by `mutation.wxml`/`argumentids`; the caller is `procedures_call`.
- A call block's input keys carry parameter ids (e.g. `inputs["c2cd9dc79c"]`), not fixed names — expect dynamic keys when finding slots by opcode.
- Return values from custom blocks are currently **not supported** (deliberately not done).
