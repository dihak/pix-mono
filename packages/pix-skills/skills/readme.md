---
name: readme
description: Create or update a project README in a fixed, deployment-focused style with required sections, env-var tables, and an enforced tone
disable-model-invocation: true
---
# README Directive

## Core Philosophy

Produce README aimed at deployment engineer or new developer who needs to run project locally and integrate it into a platform. Optimize for: can they get it running in five minutes, do they know which knobs safe to turn in production? No marketing language, no hobbyist framing.

## Below are what agent MUST do

### Phase 1: Gather Inputs (Before Writing)

- **AUTO-RUN**: Run terminal commands and tool calls needed proactively without confirmation unless explicit input required.
- **DETECT EXISTING**: `README.md` already exists → read it first as source of truth for name, purpose, documented endpoints. Treat update as rewrite into this style, preserving factual content.
- **SCAN**: Read `.env.example`, route files, `docker-compose.yml`, task runner files (`justfile`, `Makefile`, `mise.toml`, `Taskfile.yml`, `package.json`), main entrypoint to gather source material.
- **NO GUESSING**: Never invent env var names, endpoints, default values, ports, commands. Required input below unknown after scanning → ask user before writing.

Following inputs MUST be identified before drafting:

| # | Input | Notes |
|---|---|---|
| 1 | Service/library name, language, one-line purpose | What it accepts, what it produces |
| 2 | Key operational characteristics | Latency, concurrency, multi-tenancy — 1-2 sentences max |
| 3 | Runtime requirements | Language version, native deps, CLI tools |
| 4 | Entrypoint command + local run | Task runner recipes if present (`just`, `make`, `mise`, `npm`) |
| 5 | Environment variables | Split into three buckets (see Phase 2) |
| 6 | Container workflow | Whether `docker-compose.yml` or `Dockerfile` exists |
| 7 | Authentication scheme | Exact login endpoint, header format, fallbacks (query param, cookie) |
| 8 | HTTP/API surface | Grouped by feature area; common request envelope or response shape |
| 9 | Interactive docs URL | Swagger/OpenAPI/Storybook if served |
| 10 | Development task-runner recipes | `test`, `codegen`, `tidy`, `lint` |
| 11 | License | Exact license name |

### Phase 2: Environment Variable Buckets

Split every env var into exactly one of these three buckets. Bucket empty for project → OMIT its table, don't pad with empty rows.

| Bucket | Table Columns | Purpose |
|---|---|---|
| Required application secrets | `Variable` (left-aligned `\|:---\|`), `Description` | No defaults — must be set before running |
| Infra-tunable runtime values | `Variable` (left-aligned `\|:---\|`), `Default` (right-aligned `\|---:\|`), `Description` | Sensible defaults, safe to override per environment |
| Optional feature toggles / external integrations | `Variable` (left-aligned `\|:---\|`), `Default` (right-aligned `\|---:\|`), `Description` | Feature flags, third-party API keys |

### Phase 3: Required Structure (Sections in Order)

1. `# <Full Name> (<Acronym>)` — acronym only if one exists.
2. Opening paragraph (2-3 sentences): what service is, what it ingests, what it emits.
3. Separate short paragraph: key operational characteristics.
4. `## Table of Contents` — bulleted list of section headings below.
5. `## Requirements` — bullet list of runtime prerequisites.
6. `## Quick Start` — copy `.env.example` → `.env`, set minimum required vars (show secret generation, e.g. `openssl rand -hex 32`), then run command(s). End with default listen address.
7. `## Environment Configuration` — one orienting sentence, then three env tables in bucket order. Close with one-paragraph note about keeping `.env` out of git and injecting via platform secrets in deployments.
8. `## Docker Compose` — ONLY if compose file exists. One sentence describing what it does, the `docker compose up --build` command, note that deployment platforms can supply same vars directly.
9. `## Authentication` — login endpoint as `text` code block, then both auth methods (bearer header preferred, query param fallback) in separate code blocks.
10. `## API Overview` — JSON response envelope as `json` code block, then single table grouping endpoints by feature area (columns: `Group`, `Endpoints`). Below table, short paragraph naming common query parameters spanning multiple endpoints.
11. `## Documentation` — one sentence, then interactive docs URL in `text` code block.
12. `## Development` — `bash` code block listing most-used task-runner recipes (`test`, `codegen`, `tidy`), then one-line note about where annotations or generated artifacts live.
13. `## License` — one line.

### Phase 4: Style Rules (Enforce Strictly)

- **PROSE**: Plain factual. No marketing words ("blazing fast", "powerful", "easy", "simple"). No emojis. No badges. No screenshots.
- **ORIENTING SENTENCE**: Every section starts with one orienting sentence before any code, list, or table.
- **TABLES OVER BULLETS**: Use tables for structured data (env vars, endpoints). Never use bullet lists for things with columns.
- **CODE FENCES**: Always carry explicit language tag, but stick to widely-supported ones (`bash`, `text`, `json`, `yaml`, `sql`). Avoid obscure tags like `http`, `dotenv`, `ini` — renderers (GitLab, some Markdown viewers) flag them unsupported, display block in red. Use `text` for raw HTTP request lines / headers or env files, `bash` for `curl` examples.
- **CONCRETE DEFAULTS**: Show actual values inline (`8080`, `30`, `10485760`). Never write "configurable" without actual default.
- **ENV FORMAT**: Value belongs in `.env` → show as real assignment, not prose.
- **ENDPOINTS**: In tables use backticks. HTTP methods uppercase, inside backticks: `` `GET /api/streams` ``.
- **OMIT**: No "Contributing", "Acknowledgments", "What is X?", or "About" sections unless explicitly requested.
- **OPENING**: Open with what it does, not what it is for.

### Phase 5: Customization Rules

- **MISSING BUCKET**: Project has no infra-tunable middle tier or no optional integrations → omit that table rather than padding.
- **NO COMPOSE**: Omit `## Docker Compose` section entirely if no compose file exists.
- **NO AUTH**: Service unauthenticated → omit `## Authentication`.
- **NO INTERACTIVE DOCS**: No Swagger/OpenAPI/Storybook served → omit `## Documentation`.
- **MULTI-LANGUAGE MONOREPO**: Ask user which component README targets before writing.
- **EXISTING README**: Present diff of proposed changes, ask confirmation before overwriting non-trivial existing README.

## Report

After writing, output final file path and one-line summary of which optional sections omitted (and why).
