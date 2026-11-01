# Unlock Digital Mac preview

This Apple-silicon package is an Unlock Digital fork preview based on official T3 Code v0.1.6. The release manifest identifies its exact source revision and completed validation. Provider credentials, conversations, repositories and personal browser data are configured on the destination machine.

## Install and verify

1. Download the `arm64.dmg`, release manifest and `SHA256SUMS` from the specific [Unlock Digital release](https://github.com/unlockdigital/t3code/releases).
2. Calculate `shasum -a 256` for the downloaded files and compare the complete digests with the manifest.
3. Open the disk image and copy **T3 Code Unlock Digital Preview.app** into Applications, preserving existing applications.
4. Open the application using your Mac's authorized application-opening controls. Check the release's signing/notarization status; organizational device policy may require administrator approval.
5. Confirm the expected version and source revision, configure a provider, and run a small task in a disposable project.

## Separate profiles and links

Direct application launch uses bundle ID `com.unlockdigital.t3code.preview`, protocol `t3code-unlock`, server home `~/.t3-unlock-preview`, and Electron profile `~/Library/Application Support/T3 Code Unlock Digital Preview/t3code-v2`. Browser partitions live within that separate Electron profile. The preview skips automatic import from older official desktop profiles.

Explicit `T3CODE_HOME` or `T3CODE_DESKTOP_APP_DATA_DIR` overrides take precedence; choose them carefully. Source development retains its worktree isolation. The preview preserves an existing official `t3` launcher. Its absolute launcher path remains usable for local handoffs. Background-service changes and CLI self-update/uninstall commands are disabled; manage this preview through its application and dedicated profiles.

This preview uses manual updates and disables automatic replacement even when a feed is present. Configure and review each account's credentials and permissions independently. Follow [provider guidance](PROVIDERS.md). Automatic account dispatch and experimental helper/approval tools are deferred.

## Destination acceptance and recovery

Check model/account names, usage descriptions, Home/unread behavior, a project browser task, and a local handoff containing a disposable attachment. Quit, reopen directly, and confirm the test conversation persists. Confirm an existing official installation and its data remain available.

Quit before copying the separate profile and server home for a private backup. Preserve the corresponding installer and checksums. Roll back an application together with its compatible profile backup, retaining newer data separately for recovery. Record the macOS version, architecture, release revision, and reproducible failures with test results.
