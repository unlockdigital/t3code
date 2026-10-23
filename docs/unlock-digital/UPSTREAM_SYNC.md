# Unlock Digital: upstream maintenance

## Recorded base

- Stable release: `v0.1.2`, published October 22, 2026.
- Base SHA: `044f07257c9684ae4543bd1e1ebf9c394e9e3830`.
- `origin`: `https://github.com/unlockdigital/t3code.git`.
- `upstream`: `https://github.com/pingdotgg/t3code.git`.
- Working branch and fork default: `unlock-digital/main`.
- Baseline branch: `upstream-v0.1.2`.
- Local `main` tracks the fork's original upstream-derived main branch.
- `remote.pushDefault` is `origin`.

## Update procedure

1. Settle active agent work, stop this development instance, and make a private backup of its dedicated data directory.
2. Commit the selected source changes and record a recoverable checkpoint.
3. Fetch upstream tags and read the selected stable release's compatibility and database-migration notes.
4. Integrate that release into the customization branch. Preserve upstream license and attribution.
5. Source the isolated environment, install the frozen lockfile, and verify its resolved Node and package-manager versions.
6. Run `vp run check:changed`, launch the source desktop app, and repeat provider switching and delegation checks with the selected accounts.
7. Push the verified result to `origin` and record the new base here.

Source builds use manual rebuilds initially. Development-mode desktop updating is disabled by the application; packaged upstream auto-updates belong to the official release app. A future packaged fork needs its own explicit update distribution. Keep desktop and server protocol versions compatible.

Rollback restores both a source checkpoint and a database backup compatible with it. Preserve newer state separately before restoring a backup.

Primary guidance: [updating](../user/updating.md), [development](../operations/development.md).
