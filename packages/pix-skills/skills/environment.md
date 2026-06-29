---
name: environment
description: "Establish clean awareness of the user's working environment — OS, distro, kernel, arch, user, and CPU — before running or suggesting commands. Use whenever a request depends on the platform such as installing packages, system services, file paths, downloading arch-specific binaries, or any command whose syntax differs across systems. Load this first so actions match the actual machine instead of a guessed default."
disable-model-invocation: true
---

# Environment Skill

The blocks below are populated with **live** system facts at skill-load time via
`\!`cmd`` directives. Read them first — they are the ground truth about the
machine you are operating on. Do not assume a default platform.

## OS release

!`cat /etc/os-release`

## Kernel, arch, hostname

!`uname -srn`

## CPU count

!`nproc`

## Current user

!`id -un`

## Working directory

!`pwd`

---

## How to use this context

**Know the environment, then act inside it.** The facts above tell you the
distro family (`ID` / `ID_LIKE`), kernel, CPU architecture, user, and where you
are. Let them shape every platform-sensitive decision — paths, privilege,
binary selection, parallelism, and command syntax.

**Reconcile the user's intent with the real machine.** If a request assumes a
different platform, surface the mismatch and offer the equivalent rather than
silently running the wrong thing.

*Example — package managers.* `ID`/`ID_LIKE` maps to a specific manager; never
assume `apt`:

| `ID` / `ID_LIKE`                    | Manager  | Refresh index      | Install              |
|-------------------------------------|----------|--------------------|----------------------|
| `debian`, `ubuntu`                  | `apt`    | `apt update`       | `apt install <pkg>`  |
| `fedora`, `rhel`, `centos`, `rocky` | `dnf`    | `dnf check-update` | `dnf install <pkg>`  |
| `arch`, `manjaro`                   | `pacman` | `pacman -Sy`       | `pacman -S <pkg>`    |
| `opensuse`, `suse`                  | `zypper` | `zypper refresh`   | `zypper install`     |
| `alpine`                            | `apk`    | `apk update`       | `apk add <pkg>`      |
| macOS (kernel `Darwin`)             | `brew`   | `brew update`      | `brew install <pkg>` |

So if the user says `apt update` on a `fedora` box, say so and run
`sudo dnf check-update` instead — once confirmed.

The same principle applies beyond packages:

- **Arch** — pick `x86_64` vs `aarch64` release artifacts to match `uname`.
- **Privilege** — system changes need root; prefer the `sudo_run` tool over
  inlining `sudo` in a bash command.
- **Parallelism** — size builds/jobs to the CPU count above (`make -j`, etc.).
- **Paths** — respect the actual user and home, not a hardcoded `/home/user`.

If a fact is missing, blank, or shows `[blocked: …]`, ask the user instead of
guessing the platform.
