# pseudo2sb3-dev

An agent skill for **pseudo2sb3** — a pseudocode → Scratch `.sb3` compiler with an Electron
front end.

The skill teaches an agent to work on that tool: write `.pseudo` tutorial scripts, compile and
export `.sb3` from the CLI, decompile a `.sb3` back into pseudocode, make a game *feel* like an
arcade game (inertia, screen shake, a white-flash hit, an animated score, sound), extend the
compiler's block metadata, add or change a language's UI strings and block aliases, inspect any
`.sb3`'s block graph, verify a real TurboWarp import by actually running it, and package a
Windows build.

## Install

Drop the folder into your agent's skills directory — for WorkBuddy AI that is
`~/.workbuddy-ai/skills/` — or import the repository as a skill.

[`pseudo2sb3-dev.zip`](pseudo2sb3-dev.zip) is the same ten files packaged under a
`pseudo2sb3-dev/` prefix, for when you would rather just unzip it into place.

## Layout

| Path | What's in it |
|:--|:--|
| `SKILL.md` | Routing by intent, the six hard rules, the clone-pool/grid playbook, the i18n layer, commands, boundaries |
| `references/dsl.md` | The `.pseudo` syntax: skeleton, indentation, assignment, menu arguments, custom blocks, `不刷新` (warp), known-unsupported forms |
| `references/game-feel.md` | The game-feel playbook, every idiom measured by a real harness: frame pump, thrust decomposition, damping + speed cap, screen wrap, stage-effect screen shake, full-stage white flash, eased HUD counters, synthesized WAV + pitch jitter, costume pivot/swap geometry, clone particles |
| `references/decompile.md` | The reverse path `.sb3 → pseudocode`: CLI/desktop entry points, the slot-tag table (incl. the obscured-shadow trap), what the DSL cannot express, and the three verification layers |
| `references/sb3-format.md` | How the emitted `.sb3` block graph is shaped: slot encoding, primitive type numbers, variables/lists registered by key, static dropdowns vs shadow menus |
| `references/workflow.md` | Adding a block (the 6 steps), historical lessons, the verification chain, verifying TurboWarp in a real browser, packaging checks |
| `scripts/vocab.mjs` | Dumps the block vocabulary from a repo's own catalog — `--grep`, `--group`, `--lang`, `--json` |
| `scripts/inspect-sb3.mjs` | Zero-dependency `.sb3` unpack and structural self-check; works on any project |
| `scripts/turbowarp-verify.mjs` | Real-browser check: injects a `.sb3` into turbowarp.org, drives real keys, asserts the run and screenshots the stage |
| `scripts/turbowarp-import-check.mjs` | Real-browser check for decompiled projects: loads original and round-tripped side by side and diffs per-target block/variable/monitor counts |

## `vocab.mjs` needs the tool's repo

It reads `src/core/catalog.js` out of a **pseudo2sb3 checkout**, not out of this skill. Point
it at one with the first positional argument, the `PSEUDO2SB3_REPO` environment variable, or
by running it from inside the repo:

```bash
node scripts/vocab.mjs <repo dir> --group events
node scripts/inspect-sb3.mjs out/thing.sb3
```

The two `turbowarp-*.mjs` scripts don't need the repo — they need `playwright-core` and a local
Edge install, and they take a `.sb3` path.

This repository is only the skill (documentation + those four helpers). The compiler itself is
a separate project.

## Placeholders

`<repo dir>` / `<temp dir>` / `<skill dir>` in the docs are placeholders — replace them with
your own paths.

## License

MIT — see [LICENSE](LICENSE).
