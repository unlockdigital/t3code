# Unlock Digital: independent Mac trial

Use the Apple-silicon fork preview on an M-series Mac with fresh application state and provider sign-ins. Each preview identifies its source commit and includes a checksum manifest. The upstream release base remains v0.1.2 while selected maintenance fixes and the fork's own features are integrated.

## Download and install

1. Open the specific Unlock Digital preview release linked by the maintainer. Download its `arm64.dmg`, `SHA256SUMS`, and the companion `Launch Unlock Digital Trial.command`.
2. Calculate `shasum -a 256 <downloaded-file>` and compare the complete digest with that file's entry in `SHA256SUMS`. Keep the release tag and source commit with your trial notes.
3. Open the disk image and copy the application into Applications as **T3 Code Unlock Digital Preview.app**. Preserve any existing installation under its own name.
4. Run the companion launcher. If its executable bit was lost during download, run `chmod +x` on that launcher first. The launcher checks the application's preview version and starts separate server and desktop profiles under `~/Library/Application Support/T3 Code Unlock Digital Trial`.

These preview packages use manual installation and updates. Inspect the release's actual signing status and follow your Mac's authorized application-opening controls. Organizational device policy may require administrator approval for an unsigned application. Keep those controls in place during the trial.

Use the companion launcher for each trial session. It also disables optional product telemetry, OpenTelemetry export, and automatic updating for that session. A direct launch from the application icon uses the application's ordinary environment and profile defaults. To install at another path, set `T3CODE_TRIAL_APP_PATH` when invoking the launcher.

## Fresh provider setup

The package carries the fork's code, interface, and bundled application runtime. Provider credentials, named-account settings, conversations, local repositories, personal skills, and live connector grants stay on their originating machine.

In Settings, configure the providers you want to test and follow their supported sign-in flow on this Mac. Follow the bundled [provider setup guidance](../user/install.md#providers) for provider CLIs. If this Mac already has CLI accounts, create separate connection homes when testing fresh account sign-ins. Select the intended connection explicitly before running a task.

Use Codex or Claude for the initial qualification. The starter profile keeps Cursor disabled while its legacy Zod v3 input-validation path receives further advisory and transport-limit review. Existing trial settings are preserved. Enabling Cursor expands beyond this preview's qualified trial scope.

Usage windows and billing links describe provider-reported evidence. Account routing supplies a preview and keeps automatic dispatch disabled. Grant coordinator approval authority explicitly to the chosen thread, and check its destination and permission limits. Replacing or resetting that shortcut requires successful revocation of the previous environment's grant.

N2ition is optional and starts without a live grant on a clean installation. An owner must qualify and enroll the destination's inference route and connector separately. A grant's approved route must match the effective provider configuration; route changes require requalification. Personal project launch restrictions are environment-local policy and can be provisioned separately by the owner.

## Verify the independent installation

- Confirm the application identifies the downloaded preview version and expected source commit.
- Create a disposable local project and thread. Select a freshly configured provider and complete a small task with an observable local result.
- Check Home/sidebar navigation, account selection and usage descriptions. Exercise one scoped delegated task and Stop against disposable work.
- Quit normally, reopen through the trial launcher, and confirm that the trial conversation and project remain available.
- Check permission-denied and revoked-coordinator cases before using delegated approval on important work. Qualify optional connectors before sharing private context.

Keep the test outcome, macOS version, architecture, release tag, and any reproducible failure with your trial notes. Installer integrity and source-machine checks establish the delivered build; this destination workflow establishes its usability on the work Mac.

## Recovery

Quit the trial before backing up its separate profile directory. Preserve any trial conversations before changing versions. Keep the downloaded installer and checksum for the previous working preview. Restore a compatible application and profile together when needed, and retain newer profile data separately for recovery. Removing the trial application and its dedicated profile is an explicit cleanup step after useful data has been preserved.
