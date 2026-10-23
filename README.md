# T3 Code · Unlock Digital Edition

This repository is Unlock Digital's maintained fork of [T3 Code](https://github.com/pingdotgg/t3code), an open-source agent harness control surface. It enables unified control of coding agents running on your machine with desktop, web, and mobile interfaces.

Works with your subscriptions and configurations across Claude Code, Codex, Google Antigravity, OpenCode, Cursor, and Grok Build.

## Unlock Digital Enhancements

This edition builds on upstream stable releases while providing tailored capabilities for multi-provider orchestration and local development:

- **Home Activity Overview**: A dedicated Home view offering a compact agent activity overview, live elapsed task durations, grouped subagent counts, and steady thread action menus during live background work.
- **Upstream Updates Management**: Built-in **Settings → Upstream Updates** to monitor official upstream releases and security advisories, and safely prepare candidates in isolated git worktrees without interrupting active development runs.
- **Usage & Billing Clarity**: Clarified five-hour and monthly provider limit labels, Anthropic Console billing links, and multi-account status across models.
- **Private Local Isolation**: Dedicated application state directories ensuring conversations, database migrations, and sensitive provider credentials remain strictly local.

## Upstream Relationship

- Upstream canonical repository: [pingdotgg/t3code](https://github.com/pingdotgg/t3code)
- Base release: `v0.1.2`
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
   ./Launch\ T3\ Code.command
   # or run:
   vp run build && vp run dev:desktop
   ```

### Prerequisites & Providers

Install and authenticate at least one provider before use:

- **Codex**: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
- **Claude**: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
- **Antigravity**: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**.
- **OpenCode**: install [OpenCode](https://opencode.ai) and run `opencode auth login`
- **Cursor**: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
- **Grok Build**: install [Grok Build CLI](https://x.ai/cli) and run `grok login`

## Documentation

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
