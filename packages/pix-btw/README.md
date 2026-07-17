# pix-btw

Pi extension for asking an out-of-turn side question while the main agent is still working.

```text
/btw read https://example.com and summarize it
```

`/btw` immediately starts a separate in-memory Pix session and returns control to the editor. The main agent is not interrupted, steered, or given the side conversation as context. When the side answer finishes, it appears as a dedicated **BTW** message in the main transcript.

## Behavior

- Runs concurrently with the main agent, including while it is streaming or using tools.
- Starts with an empty conversation; it does not inherit the main transcript.
- Uses the exact lean system prompt:

  ```text
  You are Pix Coding Agent. You help users accomplish any task they request.
  ```

- Uses the model, thinking level, active tools, working directory, credentials, and extension configuration selected by the main session at invocation time.
- Keeps results in an in-memory child session; the rendered final answer is visible in the main transcript but filtered out of the main agent's LLM context.
- Supports multiple concurrent `/btw` questions.
- Shows live BTW activity above the editor and a compact footer status while questions are running.

## Install

Included with `@xynogen/pix-core`, or install it directly:

```bash
pi install npm:@xynogen/pix-btw
```

## License

MIT
