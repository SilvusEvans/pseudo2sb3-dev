# pseudo2sb3-dev

An agent skill for **pseudo2sb3** — a pseudocode → Scratch `.sb3` compiler with an Electron
front end.

The skill teaches an agent to work on that tool: write `.pseudo` tutorial scripts, compile and
export `.sb3` from the CLI, extend the compiler's block metadata, add or change a language's UI
strings and block aliases, inspect any `.sb3`'s block graph, verify a real TurboWarp import by
actually running it, and package a Windows build.

## Install

Drop the folder into your agent's skills directory — for WorkBuddy AI that is
`~/.workbuddy-ai/skills/` — or import the repository as a skill.

[`pseudo2sb3-dev.zip`](pseudo2sb3-dev.zip) is the same six files packaged under a
`pseudo2sb3-dev/` prefix, for when you would rather just unzip it into place.

## Layout

| Path | What's in it |
|:--|:--|
| `SKILL.md` | Routing by intent, the six hard rules, the i18n layer, commands, boundaries |
| `references/dsl.md` | The `.pseudo` syntax: skeleton, indentation, assignment, menu arguments, custom blocks, `不刷新` (warp), known-unsupported forms |
| `references/sb3-format.md` | How the emitted `.sb3` block graph is shaped: slot encoding, primitive type numbers, variables/lists registered by key, static dropdowns vs shadow menus |
| `references/workflow.md` | Adding a block (the 6 steps), five historical lessons, the verification chain, verifying TurboWarp in a real browser, packaging checks |
| `scripts/vocab.mjs` | Dumps the block vocabulary from a repo's own catalog — `--grep`, `--group`, `--lang`, `--json` |
| `scripts/inspect-sb3.mjs` | Zero-dependency `.sb3` unpack and structural self-check; works on any project |

## The two scripts need the tool's repo

They read `src/core/catalog.js` out of a **pseudo2sb3 checkout**, not out of this skill. Point
them at one with the first positional argument, the `PSEUDO2SB3_REPO` environment variable, or
by running them from inside the repo:

```bash
node scripts/vocab.mjs <repo dir> --group events
node scripts/inspect-sb3.mjs out/thing.sb3
```

This repository is only the skill (documentation + those two helpers). The compiler itself is
a separate project.

## Placeholders

`<repo dir>` / `<temp dir>` / `<skill dir>` in the docs are placeholders — replace them with
your own paths.

## License

MIT — see [LICENSE](LICENSE).
