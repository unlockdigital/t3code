# T3 Code · Unlock Digital Edition

This repository is Unlock Digital's maintained fork of [T3 Code](https://github.com/pingdotgg/t3code), an open-source agent harness control surface. It enables unified control of coding agents running on your machine with desktop, web, and mobile interfaces.

Works with your subscriptions and configurations across Claude Code, Codex, Google Antigravity, OpenCode, Cursor, and Grok Build.

Current preview source integrates official **v0.1.6**. See [included improvements](docs/unlock-digital/CUSTOMIZATIONS.md), [Mac installation and profile isolation](docs/unlock-digital/PORTABLE_TRIAL.md), and [upstream maintenance](docs/unlock-digital/UPSTREAM_SYNC.md). Release assets identify the exact fork commit, validation, and signing status.

## Unlock Digital Enhancements

This edition builds on upstream stable releases while providing tailored capabilities for multi-provider orchestration and local development:

- **Home Activity Overview**: A dedicated Home view offering a compact agent activity overview, live elapsed task durations, grouped subagent counts, and steady thread action menus during live background work.
- **Upstream Updates Management**: Built-in **Settings → Upstream Updates** to monitor official upstream releases and security advisories, and safely prepare candidates in isolated git worktrees without interrupting active development runs.
- **Usage & Billing Clarity**: Clarified five-hour and monthly provider limit labels, Anthropic Console billing links, and multi-account status across models.
- **Private Local Storage Isolation**: Dedicated application state directories ensuring local conversations, settings, and database migrations remain isolated locally on your machine.

## Upstream Relationship

- Upstream canonical repository: [pingdotgg/t3code](https://github.com/pingdotgg/t3code)
- Base release: official `v0.1.6`
- Operating branch: `unlock-digital/main`
- Maintenance plan: See [docs/unlock-digital/UPSTREAM_SYNC.md](./docs/unlock-digital/UPSTREAM_SYNC.md)

## Installation & Running

### Running from source

This edition is maintained as a reproducible source build with an isolated, pinned toolchain.

1. Install dependencies with Vite+:

   ```bash
   vp i
   ```

2. Build and launch:
   ```bash
   vp run build && vp run dev:desktop
   # (or use the parent workspace launcher: "../Launch T3 Code.command")
   ```

### Prerequisites & Providers

Install and authenticate at least one provider before use:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### Windows (`scoop`)

```bash
scoop install extras/t3code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Debian, Ubuntu (`.deb`)

Download the `.deb` from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), then:

```bash
sudo apt install ./T3-Code-*.deb
```

#### Arch Linux (AUR)

Stable:

```bash
yay -S t3code-bin
```

Nightly:

```bash
yay -S t3code-nightly-bin
```

The AUR packaging is maintained in this repository under [`packaging/aur`](./packaging/aur).

#### Nix (nixpkgs)

```bash
nix profile add github:NixOS/nixpkgs/nixos-unstable#t3code
```

The package is maintained in [nixpkgs](https://github.com/NixOS/nixpkgs/tree/nixos-unstable/pkgs/by-name/t3/t3code)
and includes the desktop app (`t3code-desktop`) and the `t3` command.
See [Nix installation](./docs/user/install.md#nix-nixpkgs) for NixOS configuration and updates.

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [FAQ](./docs/user/faq.md)

## Unlock Digital fork

- [Unlock Digital setup and customizations](./docs/unlock-digital/SETUP.md)
- [Upstream synchronization guide](./docs/unlock-digital/UPSTREAM_SYNC.md)
- [Provider connections & ledger](./docs/unlock-digital/PROVIDERS.md)
- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Project settings](./docs/user/project-settings.md)
- [Keeping app and server in sync](./docs/user/updating.md)

Building from source internals? See [docs/internals/overview.md](./docs/internals/overview.md).

## Contributing & Upstream

Custom features in this edition follow modular review boundaries so that general-purpose improvements (such as Home activity overviews and usage clarity) can be proposed upstream to [pingdotgg/t3code](https://github.com/pingdotgg/t3code) in accordance with upstream contribution guidelines.
