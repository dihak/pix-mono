---
name: standup
description: This skill should be used when the user asks to "standup me", "buat standup", "create standup script", "generate standup", "standup hari ini", or any request to prepare a daily standup update. Handles fetching previous context from Notion, prompting the user, generating a script, and saving to Notion.
disable-model-invocation: true
---

# Standup Script Skill

## Overview

Automate daily standup script creation: pull most recent standup from Notion as context, prompt user interactively, generate natural-language script, save today's standup back to Notion.

## Decision Tree

```
User asks for standup
       ↓
Check Notion MCP available?
  ├── NO  → Prompt user manually, generate script, output only (no save)
  └── YES → Fetch most recent standup → Prompt user → Generate → Save to Notion
```

## Step-by-Step Workflow

### Step 0: Check Notion MCP Availability

Before doing anything, verify Notion MCP reachable by calling `notion_notion-get-users` or any lightweight Notion tool.

- **MCP fails or unavailable**: Inform user, then continue from Step 2 without Notion context. Skip Step 4.
- **MCP available**: Proceed to Step 1.

---

### Step 1: Fetch Most Recent Standup from Notion

Search for most recent standup page — do NOT assume yesterday (may be Friday, pre-holiday, etc.).

1. Search Notion with query `"Standup -"` scoped under Mei user page
2. Parse all result titles matching pattern `Standup - YYYY-MM-DD`
3. Pick one with **latest date**
4. Fetch its full content for context

**No previous standup found**: skip to Step 2 with no prior context.

---

### Step 2: Prompt User with Questions

Use `question` tool to ask all 3 questions at once (parallel — single tool call):

| # | Header | Question |
|---|--------|----------|
| 1 | Yesterday | Did you finish the task from the last standup (`[last task]`), or is it still in progress? |
| 2 | Today | What will you work on today? |
| 3 | Blocker | Any updates on blockers from last standup? (resolved, still blocked, new blocker?) |

Populate question options from last standup content where possible (e.g., "Finished", "Still in progress", "Different task").

---

### Step 3: Generate Script

> 📌 Source of truth: **Standup Script** template page (`35d3d66a-a117-81b4-a276-f38a31b60c82`). Fetch it to copy EXACT callout structure, icons, color tokens — do NOT guess color values. Current tokens: `yellow_bg` / `green_bg` / `red_bg`.

Compose natural Indonesian standup script from user's answers. Visual layout uses **three colored Notion callouts** (one per section) preceded by salam line:

```
Assalamualaikum, saya [Nama].

[💭 yellow_bg callout]
Kemarin — [task dari standup terakhir, status: selesai / dilanjutkan]

[🚀 green_bg callout]
Hari ini — [today's task]

[⛔ red_bg callout]
Blocker — [blocker update atau "Tidak ada blocker"]
```

Rules:
- One callout per section — keep body to single short line where possible
- Use natural Bahasa Indonesia
- Salam + nama on single line at top (plain paragraph, not callout)
- Callout color mapping fixed: 💭 yellow / 🚀 green / ⛔ red
- Blocker resolved → mention explicitly ("Blocker sebelumnya sudah teratasi")
- New blocker → state clearly
- No blocker → body is "Tidak ada blocker"

---

### Step 4: Save to Notion (only if MCP available)

Standups organized into **month folders** (one page per month, Bahasa Indonesia) under **Standup** page. Save must target folder matching **today's month**, not folder the most recent standup lived in.

**Step 4a — Resolve month folder:**

1. Determine today's month from today's actual date (run `date +%F`).
2. Look under **Standup** page (`35d3d66a-a117-81d2-b521-d60d311aa96e`) for child page titled with Indonesian month name (e.g. `Mei`, `Juni`, `Juli`).
3. **Folder exists** → use its page ID as save parent.
4. **Does NOT exist** (new month) → create it first with `notion-create-pages`:
   - Parent: Standup page `35d3d66a-a117-81d2-b521-d60d311aa96e` (month folders are **siblings** at this level — NOT nested inside previous month's folder)
   - Title: Indonesian month name (e.g. `Juni`)
   - Icon: `📅`
   - Content: `*Standup notes — [English Month] [Year].*`
   - Use returned page ID as save parent.

> ⚠️ Common mistake: saving today's standup into **previous** month's folder because that's where most recent standup was fetched from. Always re-resolve folder from today's month. Standup already created in wrong folder → move with `notion-move-pages` (param is `page_or_database_ids`, NOT `page_ids`).

**Step 4b — Create standup page** under resolved month folder.

**Title:** `Standup - YYYY-MM-DD` (use today's actual date)

**Content (three callout blocks + intro paragraph):**

1. Paragraph: `Assalamualaikum, saya Fikri.`
2. Callout — icon `💭`, color `yellow_bg`, body: `**Kemarin** — [task dari standup terakhir, status: selesai / dilanjutkan]`
3. Callout — icon `🚀`, color `green_bg`, body: `**Hari ini** — [today's task dari user]`
4. Callout — icon `⛔`, color `red_bg`, body: `**Blocker** — [blocker update atau "Tidak ada blocker"]`

> ⚠️ Color values MUST be Notion-flavored Markdown background tokens (`yellow_bg`, `green_bg`, `red_bg`) — NOT `*_background`. Wrong tokens silently dropped → callouts render colorless. Callout markdown form: `<callout icon="💭" color="yellow_bg">`.

Use `notion-create-pages` with explicit block content for callouts (not just markdown). After saving, return Notion page URL to user.

---

## Notion Page IDs

| Location | ID |
|----------|----|
| Work | `3363d66a-a117-8177-b3fb-eda2bfb94ebb` |
| Standup (month folders live here) | `35d3d66a-a117-81d2-b521-d60d311aa96e` |
| Standup Script (template / source of truth) | `35d3d66a-a117-81b4-a276-f38a31b60c82` |

> Month folders (Indonesian names: `Mei`, `Juni`, `Juli`, …) are **siblings** directly under Standup page, each with icon 📅. Created on demand — resolve folder for **today's month** at save time (search under Standup page), create if missing. Do NOT hardcode month folder IDs.

---

## Edge Cases

| Situation | Behavior |
|-----------|----------|
| Notion MCP unavailable | Skip fetch + save, generate script only |
| No previous standup found | Prompt without pre-filled options |
| Weekend gap (e.g., Monday standup) | Still pick most recent — could be Friday's |
| User says "different task" | Ask follow-up: "Apa yang dikerjakan kemarin?" |
| No blocker | Output: "Tidak ada blocker saat ini." |
| New month, no folder yet | Create month folder (Indonesian name) under Standup page, then save standup inside it |
| Standup saved in wrong month folder | Move it with `notion-move-pages` using `page_or_database_ids` param |

---

## Compact Workflow

**Trigger:** User says `compact [bulan]` (e.g., `compact june`, `compact mei`, `compact bulan juni`).

Ambil semua standup notes dari bulan tersebut → buat Notion database table per bulan.

### Decision Tree

```
User: "compact [bulan]"
       ↓
Resolve bulan → cari month folder di Standup page
       ↓
Fetch semua child pages (Standup - YYYY-MM-DD)
       ↓
Fetch isi tiap page → extract Kemarin / Hari Ini / Blocker
       ↓
Cek apakah database "Standup [Bulan] [Tahun]" sudah ada di month folder?
  ├── SUDAH ADA → skip create, langsung insert rows yang belum ada
  └── BELUM ADA → create database → insert semua rows
       ↓
Enable wrap cells
       ↓
Return URL database ke user
```

### Step-by-Step

#### Step 1 — Resolve Month Folder

1. Parse bulan dari input user (support Bahasa Indonesia & English, e.g. `juni` / `june` / `Juni` / `June`).
2. Search Notion untuk month folder di bawah Standup page (`35d3d66a-a117-81d2-b521-d60d311aa96e`).
3. **Jika folder tidak ada** → inform user bahwa belum ada standup untuk bulan tersebut. Stop.

#### Step 2 — Fetch Semua Standup Pages

1. Fetch month folder page → ambil semua child pages dengan title pattern `Standup - YYYY-MM-DD`.
2. Fetch isi **setiap** child page secara paralel (batch dalam satu panggilan jika memungkinkan).
3. Dari tiap page, extract:
   - **Tanggal**: parse dari title (`YYYY-MM-DD`)
   - **Kemarin**: isi callout `yellow_bg` (strip bold marker `**Kemarin** — `)
   - **Hari Ini**: isi callout `green_bg` (strip bold marker `**Hari ini** — `)
   - **Blocker**: isi callout `red_bg` (strip bold marker `**Blocker** — `)

#### Step 3 — Create atau Reuse Database

Database title format: `Standup [IndonesianMonth] [Year]` (e.g., `Standup Mei 2026`).

**Jika belum ada** → buat dengan `notion-create-database`:
- Parent: month folder page ID
- Schema:
```sql
CREATE TABLE (
  "Name" TITLE,
  "Tanggal" DATE,
  "Kemarin" RICH_TEXT,
  "Hari Ini" RICH_TEXT,
  "Blocker" RICH_TEXT
)
```
- Setelah create, ambil `data_source_id` dari response (`collection://...`).

**Jika sudah ada** → fetch database → ambil `data_source_id` + cek rows yang sudah ada (hindari duplikat berdasarkan `Name`).

#### Step 4 — Insert Rows

Gunakan `notion-create-pages` dengan `parent: { data_source_id: "..." }`.

Per row:
```json
{
  "Name": "Standup - YYYY-MM-DD",
  "date:Tanggal:start": "YYYY-MM-DD",
  "date:Tanggal:is_datetime": 0,
  "Kemarin": "[extracted text]",
  "Hari Ini": "[extracted text]",
  "Blocker": "[extracted text]"
}
```

Batch semua rows dalam **satu** `notion-create-pages` call (max 5 per call jika banyak — split jika perlu).

#### Step 5 — Enable Wrap Cells

Setelah database dibuat, fetch database → ambil `view_id` dari `<views>` → update view:
```
notion-update-view: WRAP CELLS true
```

#### Step 6 — Return ke User

Return URL database Notion ke user.

### Rules & Edge Cases

| Situasi | Behavior |
|---------|----------|
| Bulan tidak ditemukan di Notion | Inform user, stop |
| Database sudah ada | Reuse, skip rows yang sudah ada (cek by Name) |
| Page standup formatnya beda (ga ada callout) | Skip page tersebut, warn user |
| Bulan belum selesai (current month) | Tetap compact — insert semua yang ada sampai hari ini |
| Blocker kosong / "Belum Ada" | Tetap insert as-is |
