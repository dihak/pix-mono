# pix-commands

Pi extension — slash commands. `/clear`; more commands are planned.

## What it does

Registers slash commands. Currently `/clear`, which deletes `~/.cache/pi` — useful for flushing stale model-data or BenchLM cache — and prompts you to run `/reload` to apply the change. **More commands are on the way.** No extra dependencies beyond Pi.

> Diff review moved to the `diff` skill in [`@xynogen/pix-skills`](https://github.com/xynogen/pix-mono/tree/main/packages/pix-skills), which pre-populates `git status` + staged/unstaged diffs via the `` !`cmd` `` directive.

## Install

```bash
pi install npm:@xynogen/pix-commands
```

> Also included in [`@xynogen/pix-core`](https://www.npmjs.com/package/@xynogen/pix-core):
>
> ```bash
> pi install npm:@xynogen/pix-core
> ```

## Full distro

Source: [github.com/xynogen/pix-mono](https://github.com/xynogen/pix-mono)

To install the complete pix suite (all packages + Pi itself):

```bash
curl -fsSL https://raw.githubusercontent.com/xynogen/pix-mono/main/scripts/install.sh | sh
```

## License

MIT
