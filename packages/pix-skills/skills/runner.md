---
name: runner
description: Generate, convert, or update a task runner file (justfile, Makefile, mise tasks, Taskfile.yml, package.json scripts, or run.sh) for any project
disable-model-invocation: true
---
# Task Runner Generation Directive

## Below are what agent MUST do:
- **AUTO-RUN**: Run terminal commands and tool calls needed proactively without confirmation unless explicit input required.
- **ASK FORMAT**: Before generating anything, ask user which runner format they want using the Question tool with these options:
  - **justfile** — requires `just`. Native deps, groups, params, comments.
  - **Makefile** — universal, pre-installed on all Unix. `.PHONY` targets, deps via prerequisites.
  - **mise (mise.toml)** — task runner built into mise. Inline or file-based tasks with deps.
  - **Taskfile.yml (go-task)** — YAML-based, cross-platform. Requires `task` binary.
  - **package.json (npm scripts)** — requires Node. Simple key:value, no native dep graph.
  - **run.sh (shell script)** — zero dependencies. Single bash script with subcommands.
- **DETECT**: Scan project root for language/framework indicators (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `Makefile`, `justfile`, `setup.sh`, etc.). Identify primary language, package manager, test runner, linter, formatter.
- **SCAN EXISTING**: Runner file already exists (any format) → read it first as source of truth. Parse recipes/tasks, dependencies, groups, descriptions, parameters.
- **RESEARCH**: Unfamiliar with detected stack → consult official docs for canonical dev/test/lint/format commands before writing recipes.
- **GENERATE**: Create runner file in project root adapted to detected stack and chosen format.
- **VALIDATE**: Run format's list command after creation to confirm all recipes parse correctly.

## Required Task Structure

Every generated runner MUST include these standalone tasks at minimum:

| Task      | Purpose                                |
|-----------|----------------------------------------|
| `install` | Create local environment, install deps |
| `dev`     | Run the development server             |

Additional consolidated tasks added based on what project contains (see Detection-to-Task Mapping below).

For dotfiles repos, task structure follows group/module pattern instead (sync, CLI, GUI, AI, System).

## Task Consolidation

### Principle

Group related operations into single parameterized task with `<action>` argument instead of separate flat tasks. Reduces surface area, makes runner discoverable.

### Consolidation Decision Rule

| Condition | Action |
|---|---|
| Single command, no variants | Standalone task (e.g., `dev`, `install`) |
| 2+ related commands, action maps directly to a CLI arg | Simple parameterized — pass action through to the underlying tool |
| 2+ related commands, each runs different logic | Complex parameterized — case/conditional dispatch per action |
| Multi-step setup with no variants | Standalone with multi-command/array syntax |

### Detection-to-Task Mapping

Scan project for these files/patterns. When detected, generate corresponding consolidated task:

| Detected files | Task | Actions | Type |
|---|---|---|---|
| `docker-compose.yml`, `Dockerfile` | `docker` | `build\|up\|down` | Simple (pass-through to `docker compose`) |
| DB config, migration dirs, ORM config | `db` | `migrate\|seed\|setup` | Complex (each action runs different commands) |
| Test runner present | `test` | `unit\|tidy` | Complex (each action runs a different tool) |
| Formatter present | `format` | `fix\|check` | Complex (`fix` rewrites, `check` dry-run for CI) |
| Linter present | `lint` | `check\|fix` | Complex (`check` reports issues, `fix` auto-corrects) |
| Deploy config (`fly.toml`, `render.yaml`, `vercel.json`, CI/CD) | `deploy` | `staging\|production` or format-appropriate | Complex |
| `proto/`, gRPC/OpenAPI specs | `gen` | `proto\|types\|client` | Complex |

Agent MUST check these indicators during DETECT step. Only generate consolidated tasks for capabilities that actually exist in project. Don't generate `docker` if no `Dockerfile`.

### Naming Rules

- Task names: lowercase, single word when possible (`dev`, `test`, `db`)
- Descriptions: include action options in parens — `"Test operations (unit|tidy)"`
- Arg name: always `<action>` for the primary positional argument
- Bash blocks in parameterized tasks: always start with `#!/usr/bin/env bash` and `set -euo pipefail`
- **`lint` and `format` are NOT part of `test`** — they are separate concerns:
  - `test` → correctness (pytest, cargo test, go test, etc.)
  - `format` → code style; `fix` rewrites in-place, `check` is dry-run for CI
  - `lint` → static analysis; `check` reports issues, `fix` auto-corrects

## Language Adaptation Table

Use as reference when generating recipes:

| Language   | install                                        | dev                              | format                    | lint                        | test                     | tidy                                         |
|------------|------------------------------------------------|----------------------------------|---------------------------|-----------------------------|--------------------------|----------------------------------------------|
| Python     | `python -m venv .venv && .venv/bin/pip install -r requirements.txt` | `.venv/bin/python -m <app>`   | `ruff format .`           | `ruff check .`              | `pytest`                 | `find . -type d -name __pycache__ -exec rm -rf {} + && rm -rf .pytest_cache dist build *.egg-info` |
| Node/TS    | `npm install`                                  | `npm run dev`                    | `npx prettier --write .`  | `npx eslint .`              | `npm test`               | `rm -rf node_modules dist .next .nuxt`       |
| Rust       | `cargo build`                                  | `cargo run`                      | `cargo fmt`               | `cargo clippy`              | `cargo test`             | `cargo clean`                                |
| Go         | `go mod download`                              | `go run .`                       | `gofmt -w .`              | `golangci-lint run`         | `go test ./...`          | `go clean -cache -testcache`                 |
| Ruby       | `bundle install`                               | `bundle exec rails server`       | `bundle exec rubocop -A`  | `bundle exec rubocop`       | `bundle exec rspec`      | `rm -rf tmp/cache vendor/bundle`             |
| PHP        | `composer install`                             | `php artisan serve`              | `./vendor/bin/pint`       | `./vendor/bin/phpstan`      | `./vendor/bin/phpunit`   | `rm -rf vendor/ .phpunit.cache`              |
| Java       | `./gradlew build` or `mvn install`             | `./gradlew bootRun` or `mvn spring-boot:run` | `./gradlew spotlessApply` | `./gradlew check`   | `./gradlew test` or `mvn test` | `./gradlew clean` or `mvn clean`       |
| Elixir     | `mix deps.get`                                 | `mix phx.server`                 | `mix format`              | `mix credo`                 | `mix test`               | `mix clean`                                  |
| Zig        | `zig build`                                    | `zig build run`                  | `zig fmt .`               | `zig fmt --check .`         | `zig build test`         | `rm -rf zig-out zig-cache`                   |

## Format-Specific Generation Rules

### justfile
- Use `set shell := ["bash", "-cu"]`
- Use `[group('Name')]` for categories
- Dependencies via `recipe: dep1 dep2`
- Comments above recipes become descriptions
- Validate: `just --list`
- **Standalone**: `recipe:` with direct command
- **Simple parameterized**: `recipe action:` where action passes through to the tool
- **Complex parameterized**: `recipe action:` with `if/else` dispatch in a bash block
  ```just
  # Docker operations (build|up|down)
  [group('Infra')]
  docker action:
      docker compose -f docker-compose.dev.yml {{action}}

  # Run unit tests or clean artifacts (unit|tidy)
  [group('test')]
  test action:
      #!/usr/bin/env bash
      set -euo pipefail
      case "{{action}}" in
        unit) pytest -v ;;
        tidy) find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true ;;
      esac

  # Format operations — fix rewrites, check is dry-run for CI (fix|check)
  [group('format')]
  format action="fix":
      #!/usr/bin/env bash
      set -euo pipefail
      case "{{action}}" in
        fix)   ruff format . && ruff check --fix . ;;
        check) ruff format --check . && ruff check . ;;
      esac

  # Lint operations — check reports issues, fix auto-corrects (check|fix)
  [group('format')]
  lint action="check":
      #!/usr/bin/env bash
      set -euo pipefail
      case "{{action}}" in
        check) ruff check . ;;
        fix)   ruff check --fix . ;;
      esac
  ```

### Makefile
- Set `SHELL := /bin/bash` and `.DEFAULT_GOAL := help`
- Declare all targets in `.PHONY`
- Use `## comment` after target for help text, generate a `help` target with `grep -E`
- Dependencies via `target: dep1 dep2`
- Group with comment headers (`# --- Group ---`)
- Validate: `make help`
- **Standalone**: standard target with direct commands
- **Simple parameterized**: pattern rule `docker-%:` dispatching to `docker compose $*`
- **Complex parameterized**: pattern rule `test-%:` with per-target recipes
  ```makefile
  .PHONY: docker-% test-% format-% lint

  docker-%: ## Docker operations (build|up|down)
  	docker compose -f docker-compose.dev.yml $*

  test-unit: ## Run unit tests
  	pytest -v
  test-tidy: ## Clean build artifacts
  	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

  format-fix: ## Reformat code
  	ruff format . && ruff check --fix .
  format-check: ## Dry-run format check (CI)
  	ruff format --check . && ruff check .

  lint-check: ## Lint — report issues
  	ruff check .
  lint-fix: ## Lint — auto-correct
  	ruff check --fix .
  ```

### mise (mise.toml)
- Environment block (`[env]`) at the top of the file
- Define tasks under `[tasks.<name>]`
- Use `description`, `depends`, `run` fields
- Group with comment headers (`# --- Group ---`)
- Validate: `mise tasks`
- **Standalone**: `[tasks.dev]` with `run = "command"`
- **Multi-step standalone**: `run = [...]` array for sequential commands
- **Simple parameterized**: bash `case` dispatch on `$1`, action interpolated directly
- **Complex parameterized**: bash `case` dispatch on `$1` with per-action logic
- **No `usage` field**: `usage` with `arg` enforces required args and errors before bash runs. Skip it — handle arg validation in bash instead.
- **Help on no arg**: When called without an action, print usage with action descriptions and `exit 0` (not `exit 1`). This makes bare `mise run <task>` a discoverable help command.
  ```toml
  [tasks.docker]
  description = "Docker operations (build|up|down)"
  run = '''
  #!/usr/bin/env bash
  set -euo pipefail
  action="${1:-}"
  if [ -z "$action" ]; then
    echo "Usage: mise run docker <action>"
    echo ""
    echo "Actions:"
    echo "  build  Build docker images"
    echo "  up     Start docker services"
    echo "  down   Stop docker services"
    exit 0
  fi
  docker compose -f docker-compose.dev.yml "$action"
  '''

  [tasks.test]
  description = "Test operations (unit|tidy)"
  run = '''
  #!/usr/bin/env bash
  set -euo pipefail
  action="${1:-}"
  if [ -z "$action" ]; then
    echo "Usage: mise run test <action>"
    echo ""
    echo "Actions:"
    echo "  unit    Run pytest"
    echo "  tidy    Remove caches and compiled files"
    exit 0
  fi
  case "$action" in
    unit)   python -m pytest -v ;;
    tidy)   find . -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true ;;
    *)      echo "Unknown action: $action"; exit 1 ;;
  esac
  '''

  [tasks.format]
  description = "Format operations — fix rewrites, check is dry-run for CI (fix|check)"
  run = '''
  #!/usr/bin/env bash
  set -euo pipefail
  action="${1:-fix}"
  if [ -z "$action" ]; then
    echo "Usage: mise run format <action>"
    echo ""
    echo "Actions:"
    echo "  fix    Reformat code in-place"
    echo "  check  Dry-run, exit 1 if changes needed (CI)"
    exit 0
  fi
  case "$action" in
    fix)   ruff format . && ruff check --fix . ;;
    check) ruff format --check . && ruff check . ;;
    *)     echo "Unknown action: $action"; exit 1 ;;
  esac
  '''

  [tasks.lint]
  description = "Lint operations (check|fix)"
  run = '''
  #!/usr/bin/env bash
  set -euo pipefail
  action="${1:-check}"
  case "$action" in
    check) ruff check . ;;
    fix)   ruff check --fix . ;;
    *)     echo "Unknown action: $action"; exit 1 ;;
  esac
  '''
  ```

### Taskfile.yml (go-task)
- Use `version: '3'`
- Define under `tasks:` with `desc`, `deps`, `cmds`
- Group with comment headers
- Validate: `task --list`
- **Standalone**: single task with `cmds` list
- **Simple parameterized**: `{{.CLI_ARGS}}` passed through to the underlying tool
- **Complex parameterized**: internal tasks per action, parent dispatches via `task test-{{.CLI_ARGS}}`
  ```yaml
  tasks:
    docker:
      desc: "Docker operations (build|up|down)"
      cmds:
        - docker compose -f docker-compose.dev.yml {{.CLI_ARGS}}

    test:
      desc: "Test operations (unit|tidy)"
      cmds:
        - task: "test-{{.CLI_ARGS}}"
    test-unit:
      internal: true
      cmds: [pytest -v]
    test-tidy:
      internal: true
      cmds: ["find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true"]

    format:
      desc: "Format operations (fix|check)"
      cmds:
        - task: "format-{{.CLI_ARGS}}"
    format-fix:
      internal: true
      cmds: [ruff format ., ruff check --fix .]
    format-check:
      internal: true
      cmds: [ruff format --check ., ruff check .]

    lint:
      desc: "Lint operations (check|fix)"
      cmds:
        - task: "lint-{{.CLI_ARGS}}"
    lint-check:
      internal: true
      cmds: [ruff check .]
    lint-fix:
      internal: true
      cmds: [ruff check --fix .]
  ```

### package.json (npm scripts)
- No native arg dispatch or dep graph
- Validate: `npm run`
- **Standalone**: direct command string
- **Consolidated via colon namespacing**: `"docker:build"`, `"docker:up"`, `"docker:down"` as separate scripts, parent `"docker"` echoes usage
- **Complex parameterized**: individual `"test:unit"`, `"format:fix"`, `"format:check"` scripts, plus standalone `"lint"`
  ```json
  {
    "scripts": {
      "dev": "next dev",
      "install:deps": "npm ci",
      "docker:build": "docker compose -f docker-compose.dev.yml build",
      "docker:up": "docker compose -f docker-compose.dev.yml up",
      "docker:down": "docker compose -f docker-compose.dev.yml down",
      "test:unit": "jest",
      "test:tidy": "rm -rf node_modules dist .next",
      "format:fix": "prettier --write . && eslint --fix .",
      "format:check": "prettier --check . && eslint .",
      "lint:check": "eslint .",
      "lint:fix": "eslint --fix ."
    }
  }
  ```
  Note: `npm run` has no arg validation or choices — colon namespacing is the closest equivalent.

### run.sh (shell script)
- `#!/usr/bin/env bash` with `set -euo pipefail`
- Each task as `cmd_<name>()` function
- Dispatch via `main()` with case/declare lookup
- Help via `cmd_help()` listing all commands
- Validate: `./run.sh help`
- **Standalone**: `cmd_dev()` with direct command
- **Parameterized**: `cmd_<name>()` takes `$1` as action, inner `case` dispatch
  ```bash
  cmd_docker() {
      local action="${1:?Usage: $0 docker <build|up|down>}"
      case "$action" in
          build|up|down) docker compose -f docker-compose.dev.yml "$action" ;;
          *) echo "Unknown action: $action"; exit 1 ;;
      esac
  }

  cmd_test() {
      local action="${1:?Usage: $0 test <unit|tidy>}"
      case "$action" in
          unit) pytest -v ;;
          tidy) find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true ;;
          *)    echo "Unknown action: $action"; exit 1 ;;
      esac
  }

  cmd_format() {
      local action="${1:-fix}"
      case "$action" in
          fix)   ruff format . && ruff check --fix . ;;
          check) ruff format --check . && ruff check . ;;
          *)     echo "Unknown action: $action"; exit 1 ;;
      esac
  }

  cmd_lint() {
      local action="${1:-check}"
      case "$action" in
          check) ruff check . ;;
          fix)   ruff check --fix . ;;
          *)     echo "Unknown action: $action"; exit 1 ;;
      esac
  }
  ```

## Conversion Rules

When converting between formats:
1. **Source of truth**: Read existing runner file first. Parse all tasks, actions, deps, groups, descriptions, parameters.
2. **Preserve ALL tasks** — standalone and consolidated. Don't drop tasks or flatten consolidated tasks into separate entries.
3. **Preserve consolidation** — source has `test unit|tidy` as single parameterized task → target must also express it as one entry point (using target format's parameterization mechanism). `format` and `lint` are always separate tasks — do not merge them into `test`.
4. **Preserve dependency order** — task A depends on B → express this in target format.
5. **Preserve groups/categories** — use target format's native grouping or comment headers.
6. **Preserve descriptions** — map comments to target format's description mechanism. Include action options in parens.
7. **Handle parameters** — translate `<action>` args using target format's native mechanism. Format lacks arg validation (e.g., package.json) → use colon namespacing, document the workaround.
8. **Handle sudo** — preserve `sudo` prefixes where present.
9. **Default task** — every format must have help/list command as default entry point.

## Customization Rules
- **Monorepo**: Multiple languages detected → ask user which is primary. Generate one runner for root or per-workspace.
- **Existing runner**: Runner file already exists in target format → present diff of proposed changes, ask confirmation before overwriting.
- **Framework override**: Framework has own conventions (e.g., Next.js `next dev`, Django `manage.py runserver`) → prefer framework-specific commands.
- **Missing tools**: Recipe requires tool not present → add install step or note as prerequisite comment.
- **pyproject.toml**: `[tool.uv]` or `uv.lock` detected → prefer `uv`. `[tool.poetry]` → prefer `poetry`.
- **Extra tasks**: Agent MAY add additional consolidated tasks if project clearly benefits — but only when backed by detected project files (see Detection-to-Task Mapping). Don't speculatively generate tasks for capabilities project doesn't have.

## Report
After generation, output result of format's list command and confirm all recipes functional.
