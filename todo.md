# TODO

## Issue 1: Model search — fuzzy matching by model family + version

**Package:** `pix-models`

**Problem:** `/models` search only matches against model names literally. Searching "52" should show `glm-5.2`, searching "m3" should show `minimax-m3`, searching "48" should show `claude-opus-4-8`.

**Acceptance criteria:**

- [x] Search "52" → shows `glm-5.2`
- [x] Search "m3" → shows `minimax-m3`
- [x] Search "48" → shows `claude-opus-4-8`
- [x] Existing exact name matching still works

---

## Issue 2: Agent status bar — show full context numbers + t/s

**Package:** `pix-subagent` (formatting) / `pix-footer` (rendering)

**Current:**

```
⠼ Explore [qwen: qwen3.7 max] · Investigate Shiki integration · 󰁪 3 · 󱁤 15 tool uses · 󰉿 3% ctx · 32.7s · …eme/color types:
```

**Wanted:**

```
⠼ Explore [qwen: qwen3.7 max] · Investigate Shiki integration · 󰁪 3 · 󱁤 15 · 󰉿 30.1K/1.00 M (3%) · 55 t/s · 32.7s · …eme/color types:
```

**Changes:**

- [x] Drop "tool uses" label → just the count
- [x] Context: show `{used}/{total} ({percent}%)` instead of just `{percent}% ctx`
- [x] Add `{speed} t/s` field (output tokens per second)
