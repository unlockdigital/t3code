# Upstream maintenance and release identity

## Fork and upstream release identity

The upstream base is [pingdotgg/t3code v0.1.9](https://github.com/pingdotgg/t3code/releases/tag/v0.1.9), commit `24e77473ecf41bc1f7142529c7911c1c1aae1d76`. [upstream.json](upstream.json) records this base for update preparation. Identify a fork artifact by `unlockdigital/t3code`, its complete tag, source SHA, and package version. The Unlock Digital preview uses a tag shaped `vX.Y.Z-unlock.N-preview.YYYYMMDD.N`.

## Upstreamed contributions

[PR #32959](https://github.com/pingdotgg/t3code/pull/32959), which fixes prompt links for encoded thread IDs, merged into upstream `main` on November 11, 2026 as `6a5d6085ba3db7565993e72d642f4122edc86675`. The fork retains the equivalent fix while its stable base remains v0.1.9, published earlier that day. A later upstream release containing the merge supersedes this carried fix.

## Preparing updates

Open **Settings → Upstream Updates** to inspect official release notes and published security advisories. The panel can prepare a separate Git worktree combining a release with the custom commits. Review conflicts and test that candidate before integration. Preparation preserves the running application.

Public advisory checks cover the sources queried. Dependabot alerts require authorized repository access. Assess findings against the deployed Node, Electron, provider, and browser runtimes as well as source dependencies.

Commit or privately preserve local changes before preparation. Keep a private backup of application data, credentials and browser profiles, plus the prior compatible application. Test migrations against a disposable copy. Activate deliberately; retain newer data separately if rolling back an application and its matching backup.

The preview uses manual installation and automatic replacement is disabled. An upstream binary would replace fork customizations. A future fork feed requires its own signed artifact and migration qualification.
