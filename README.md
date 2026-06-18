# pix-mono

Monorepo of [Pi Coding Agent](https://github.com/badlogic/pi-mono) extensions by xynogen.

> **⚠ Expect breaking changes.** This project is under active development. Packages are regularly split, merged, renamed, or removed. The recommended upgrade path is to **uninstall then reinstall** the distro rather than incrementally updating individual packages. When in doubt, run the uninstall script first.

## Packages

| Package | Description |
| --- | --- |
| [`@xynogen/pix-9router`](packages/pix-9router) | 9Router provider + fetch/search tools via router API |
| [`@xynogen/pix-core`](packages/pix-core) | Core UI/UX bundle (welcome banner, footer, model picker, self-update) |
| [`@xynogen/pix-data`](packages/pix-data) | Shared model data layer (models.dev + BenchLM), cached at `~/.cache/pi` |
| [`@xynogen/pix-optimizer`](packages/pix-optimizer) | Performance suite — caveman mode + RTK tool rewriting + jq/TOON JSON compression |
| [`@xynogen/pix-pretty`](packages/pix-pretty) | Enhanced tool output rendering — syntax highlighting, icons, tree views, FFF, paste chips |
| [`@xynogen/pix-skills`](packages/pix-skills) | Agent skill loader (`read_skill` tool + bundled skills) |
| [`@xynogen/pix-sudo`](packages/pix-sudo) | `sudo_run` tool — executes root commands after interactive password prompt (PAM via `sudo -S`) |
| [`@xynogen/pix-tokyo-night`](packages/pix-tokyo-night) | Tokyo Night Storm theme |

## Install

One-shot installer — installs Pi, sets theme/tools, then installs the whole pix distro.

Straight from GitHub (no clone needed):

```bash
curl -fsSL https://raw.githubusercontent.com/xynogen/pix-mono/main/scripts/install.sh | sh
```

Or from a local checkout:

```bash
sh scripts/install.sh   # or: bun run install:distro
```

## Uninstall

Removes all `@xynogen/pix-*` packages from Pi. Also cleans up sub-packages from older installs that listed them individually.

```bash
curl -fsSL https://raw.githubusercontent.com/xynogen/pix-mono/main/scripts/uninstall.sh | sh
```

Or from a local checkout:

```bash
sh scripts/uninstall.sh   # or: bun run uninstall:distro
```

### Upgrade / clean reinstall

When upgrading across breaking changes, uninstall first:

```bash
curl -fsSL https://raw.githubusercontent.com/xynogen/pix-mono/main/scripts/uninstall.sh | sh
curl -fsSL https://raw.githubusercontent.com/xynogen/pix-mono/main/scripts/install.sh | sh
```

## Development

```bash
bun install        # install all workspace deps
bun test           # run all tests
bun run typecheck  # tsc across all packages
```

## Publishing

```bash
bun run publish:dry   # verify what would be published
bun run publish:all   # publish every package to npm
```

## Lineage

Several packages here originated as forks or merges of community Pi packages:

| Upstream | Disposition |
|---|---|
| `npm:pi-caveman` | replaced by `git:github.com/jonjonrankin/pi-caveman` fork |
| `git:github.com/jonjonrankin/pi-caveman` | merged into `pix-optimizer` |
| `npm:pi-rtk-optimizer` | merged into `pix-optimizer` |
| `npm:@heyhuynhgiabuu/pi-pretty` | replaced by `@xynogen/pix-pretty` |
| `npm:@heyhuynhgiabuu/pi-diff` | superseded (merged into `pix-core`) |
| `npm:@juicesharp/rpiv-ask-user-question` | rewritten as the `ask-user` skill in `pix-core` |

Previous standalone repos migrated into this monorepo: `pix-optimizer`, `pix-tokyo-night`, `pix-pretty`, `pix-core`, `pix-9router`, `pix-data`.

## License

MIT
