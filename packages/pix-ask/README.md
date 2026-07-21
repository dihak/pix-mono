# pix-ask

Pi tool — structured questionnaire UI (`ask_user`).

## What it does

Registers the `ask_user` tool in Pi. When the agent needs to resolve ambiguous requirements, it presents up to 4 structured multiple-choice questions in a TUI dialog. Each question requires 2–4 options with labels and descriptions; supports multi-select and markdown side-by-side previews for richer context. Single-select questions (without a preview) auto-append a "Type something." row for free-form input; multi-select questions append a "Next" row to advance. Single-select questions with a `preview` skip the free-form row to make room for the side-by-side layout. In non-interactive (RPC/JSON) mode, falls back to text-based prompts. The agent uses this tool before proceeding rather than guessing at intent.

## Install

```bash
pi install npm:@dihak/pix-ask
```

> Also included in [`@dihak/pix-core`](https://www.npmjs.com/package/@dihak/pix-core):
>
> ```bash
> pi install npm:@dihak/pix-core
> ```

## Full distro

Source: [github.com/dihak/pix-mono](https://github.com/dihak/pix-mono)

To install the complete pix suite (all packages + Pi itself):

```bash
curl -fsSL https://raw.githubusercontent.com/dihak/pix-mono/main/scripts/install.sh | sh
```

## License

MIT
