---
name: notion
description: Efficient Notion workspace retrieval. Use when user asks to fetch, search, or read data from Notion — pages, databases, or project lists.
disable-model-invocation: true
---
# Notion Retrieval Directive

## Core Rule

**Data already in context → answer immediately. Zero extra tool calls.**
If a previous fetch/search already returned the rows, filter/reason over them inline.
Only call MCP tools when data is genuinely absent from context.

## Tool Map

| Goal | Tool | Notes |
|---|---|---|
| Find a database/page by name | `notion_notion-search` | filter `{"value":"database"}` for DBs |
| Get schema + views of a DB | `notion_notion-fetch` with DB UUID | returns schema, SQLite DDL, view configs |
| Get all rows with properties | batch `notion_notion-fetch` per page UUID | fetch all pages concurrently in ONE message |
| Search within a data source | `notion_notion-search` with `data_source_url` | semantic; `filters.created_date_range` = creation date only, NOT schedule |

## Retrieval Protocol

### Step 1 — Locate (1 call)

Search for the database:

```
notion_notion-search(query="<name>", filter={value:"database"})
```

Note the DB `id` and `data-source` collection URL from results.

### Step 2 — Schema (1 call, optional)

Only if you need field names / option values:

```
notion_notion-fetch(id="<db-uuid>")
```

The response contains full schema + SQLite DDL — read it, don't re-fetch.

### Step 3 — Rows (1 batch)

Fetch all known page UUIDs **concurrently in a single message** (parallel tool calls).
Each call returns full `<properties>` block — Status, Category, Schedule, Stack, etc.

**Never re-fetch a page whose properties are already in context.**

## Date / Schedule Filtering

- `filters.created_date_range` in `notion_notion-search` = **page creation date**, not schedule field.
- To filter by schedule/deadline: fetch all rows (Step 3), then filter in-context by `date:📅 Schedule:end` or `date:📅 Schedule:start`.
- Pattern: `end = "YYYY-MM-30"` or range overlap check — do this mentally/inline, no extra calls.

## Answer Pattern

Once rows are in context:

```
Filter rows where Schedule.end overlaps target month → present table directly.
```

No re-search, no re-fetch, no confirmation calls.

## Efficiency Rules

1. **Batch parallel**: all page fetches go in one message, not sequential calls.
2. **Schema once**: read the DDL from the DB fetch — never fetch schema twice.
3. **Search is fuzzy**: `notion_notion-search` is semantic. Use a representative keyword, not empty string (min length 1).
4. **Collection URL**: data source URL format is `collection://UUID` — use for `data_source_url` param in search.
5. **No re-fetch loop**: if a batch already ran and data is present, stop. Answer from context.

## Common Pitfalls

- `notion_notion-search` with `query=""` → error (min 1 char). Use `"project"` or topic keyword.
- `notion_notion-fetch` requires `id` param (UUID or collection:// URL), not `url`.
- `filters.created_date_range` ≠ schedule filter — don't use it to find deadline-based rows.
- Relying on `notion_notion-search` filters for any field-level filtering — internal search is broken, always dump + script.
- Fetching the database again after already having rows in context = wasted call.
- Running searches sequentially when they can be parallel = wasted turns.

## Default: Always Dump to File

**Notion's internal search is unreliable** — date filters, keyword filters, and empty queries all behave inconsistently. Do not rely on search for filtering. Always:

1. **Fetch all rows** — batch all page UUIDs in one parallel message
2. **Dump to `/tmp/notion-<db-name>.json`** — write full properties as JSON array
3. **Query with Python/jq** — filter, sort, aggregate locally
4. **Answer from script output** — never re-fetch, never re-search

```python
import json
rows = json.load(open("/tmp/notion-projects.json"))

# filter by deadline month
june = [r for r in rows if r.get("date:📅 Schedule:end", "").startswith("2026-06")]
for r in june:
    print(r["Name"], r["Status"], r["date:📅 Schedule:end"])
```

**Write once, query many** — follow-up questions on same DB: reuse `/tmp/` file, run new script. Zero re-fetches.

If `/tmp/notion-<db>.json` already exists from this session → skip fetch entirely, go straight to script.

## Minimal Call Budget

| Task | Calls |
|---|---|
| List all projects | 2 (search DB → batch fetch → dump `/tmp/`) |
| Filter by any field | 2 (fetch all → dump) + 1 (python script) |
| Follow-up on same DB | 0 fetches (reuse `/tmp/`) + 1 (new script) |
| Get one page's properties | 1 |
| Get one page's properties | 1 |
| Check schema only | 1 |
