# Unlock Digital: local setup

Verified October 23, 2026, America/Chicago.

## Checkout and machine

- Upstream: <https://github.com/pingdotgg/t3code>
- Fork: <https://github.com/unlockdigital/t3code>
- Base: `v0.1.2`, commit `044f07257c9684ae4543bd1e1ebf9c394e9e3830`.
- Customization branch: `unlock-digital/main`.
- Preserved baseline tag: `v0.1.2`; upstream development reference: `upstream/main`.
- macOS 26.5, Apple silicon, 32 GiB RAM.
- Source lives in the `t3code` folder inside the original setup workspace. The original `START_HERE.md` remains in the parent folder.

## Toolchain

The workspace's `.t3-runtime/vite-plus` holds Vite+ 1.3.0, Node 26.12.1, and pnpm 12.14.0. The selected release's manifest supplies the runtime versions. Its development guide still mentions Node 24.

Claude Code 2.1.308 was installed through Anthropic's official native installer at `~/.local/bin/claude`. Its default login now holds the user's Claude Enterprise connection; an API instance has a separate configuration home. The existing Codex CLI is supplied by the ChatGPT desktop application, version `0.163.0-alpha.11.1`.

From this checkout:

```sh
source ../.t3-runtime/env.sh
vp env current
CI=true vp i --frozen-lockfile -- --yes --store-dir ../.t3-runtime/pnpm-store --fetch-timeout 300000 --network-concurrency 8
```

The initial dependency attempt selected an ambient pnpm 11 runtime and timed out on large downloads. The isolated environment was corrected to managed Node 26.12.1 and pnpm 12.14.0 before the retry. The retry passed with pnpm 12.14.0. The frozen lockfile is preserved.

## Launch and data

The parent workspace contains `Launch T3 Code.command`. It builds the fork once with the local toolchain, then starts the desktop and server from those bundles alongside the web development server. Its data directory is the parent's `.t3-development`; state lives below `userdata`.

Equivalent command from this checkout:

```sh
"../Launch T3 Code.command"
```

The launcher disables optional T3 product telemetry and OpenTelemetry export for this environment. This dedicated home holds the user's saved conversations and configured accounts. The normal installed-app data location is `~/.t3/userdata`; this source build always uses the explicit separate home. Provider authentication follows each provider's supported storage mechanism and can persist outside the T3 home.

Desktop development binds to loopback. Remote access can be configured separately when requested. Keep the launch terminal open and stop the process with Control-C after agent work settles. The launcher tracks its own child processes and checks for an existing instance before starting.

Web edits reload in place. **Home** beneath Search opens the agent activity overview while work continues. If a web edit leaves the old view visible, **View → Reload** (`Cmd+R`) reloads the desktop page and reconnects to the same running server; provider turns continue on that server. The error page’s **Try again** retries the route, and **Reload app** refreshes the client against that same server. Desktop and server source edits preserve the active runtime until an explicit restart. After active chats finish, stop the launcher and run it again to build and load those changes. This arrangement lets agents improve T3 from inside T3: the ordinary `dev:desktop` watcher restarts the agent's own server when shared source changes, which interrupted the panel implementation. Keep that watcher for separate disposable development environments.

The unchanged source desktop build launched successfully. The customized build was restarted successfully after the usage changes, preserving its saved conversations and provider configurations. A private pre-customization data backup is retained in the parent workspace. Its backend and development web server listen on loopback ports 13773 and 5733 respectively. The startup log confirmed main-window creation and successful authentication/API responses. Two Codex accounts, Google, and the separate Anthropic API route completed tasks through T3. Claude Enterprise authenticated and reported an external spending-budget limit. Account details are recorded in `PROVIDERS.md`.

Computer Use was unavailable, and the user selected command-line operation and direct sign-in guidance. Keep UI automation off for this setup.

The parent workspace also contains `t3-local`, a CLI wrapper for this development instance, and `Claude Subscription Sign-in.command`, which opens the official Claude subscription flow in a user-operated terminal. Keep authentication codes on that provider login surface.

## Permission defaults

Fresh defaults use **Auto**. New threads inherit the saved environment or project preference; explicit thread modes remain in place. New scheduled-task drafts also start in Auto and retain a saved task’s explicit mode when editing. **Auto-accept edits** remains a separate choice. Select Full access explicitly when the work calls for it.

## Recovery

Stop this development process before backing up `.t3-development`. Keep the database and its associated settings/secrets together in a private backup. A Git checkout restores application source; compatible database backups restore application state. See `UPSTREAM_SYNC.md` for updates.

For a clean rebuild, reinstall the frozen dependencies with the command above. Preserve `.t3-development` when repairing dependencies. Removing this trial later involves the local checkout, launcher, toolchain, and dedicated data folder after preserving any conversations the user wants. Claude Code has a separate official uninstall procedure.

Primary guidance: [development](../operations/development.md), [installation](../user/install.md), [telemetry](../user/telemetry.md).
