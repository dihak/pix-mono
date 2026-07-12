---
name: tldr
description: Maximum-density technical summary of workflows and purposes. Use when user asks "tldr", "summarize this", "give me the short version", "what's the gist", or needs the essence fast with zero filler.
disable-model-invocation: true
---
# TLDR Directive

## Goal

Strip to essence. Reader gets full picture in fewest tokens, no re-reading required.

## Below are what agent MUST do

- **AUTO-RUN**: Read what's needed to summarize accurately. Don't summarize from the filename.
- **SCOPE**: Tech only. No pleasantries, no preamble, no "in summary".
- **WORKFLOWS**: Name key workflows and their purpose, one line each.
- **DATA**: List key data points, configs, assumptions that matter.
- **CONFIDENCE**: Mark any uncertain claim with confidence note.
- **DENSITY**: Bullets over prose. One fact per bullet. No fact stated twice.

## Output Format

```
**[Subject]**
- [Core fact]
- [Core fact]
- [Key config/data] — `value`
- ⚠️ [Assumption or uncertain point] (confidence: X%)
```

## Red Flags — STOP

- Conversational filler ("Sure!", "In summary", "Hope this helps").
- Restating same fact in different words.
- Summarizing from name or title without reading source.
- Burying key point below background.
