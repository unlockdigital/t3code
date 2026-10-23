# Unlock Digital: adoption assessment

Assessment date: October 22, 2026, America/Chicago. Recommendation: an isolated local trial, with confidence in the verified setup path and account-specific behavior subject to testing.

T3 Code provides desktop, web, and mobile controls for coding agents running on a user's machine. A local Node server manages provider processes and persists conversations in SQLite. Provider inference follows the selected provider's account and endpoint. This complements the existing Codex and Claude desktop apps by offering one interface for provider switching and coordinated work.

## Provenance and maintenance

The canonical source is [pingdotgg/t3code](https://github.com/pingdotgg/t3code), maintained under the T3 Tools organization. Its MIT license permits the requested fork with preserved notices. The selected stable release is [v0.1.2](https://github.com/pingdotgg/t3code/releases/tag/v0.1.2), published October 22, 2026. GitHub reports the tagged commit's verified signature. Active stable and nightly releases demonstrate ongoing maintenance; the project describes itself as early software and has substantial open issue/PR activity.

## Material findings

| Area              | Finding and practical consequence                                                                                                                                                                                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent permissions | Provider agents can read files and execute tools with the configured permission mode. Begin in a disposable sample project and choose scoped permissions.                                                                                                                                                                                                   |
| Network exposure  | This trial uses desktop loopback and separate local state. Remote access and hosted relay services are optional future configurations.                                                                                                                                                                                                                      |
| Credentials       | The supported provider mechanisms retain logins locally. Account credentials and session databases stay outside Git. Google ACP authentication is separate from the existing IDE's login.                                                                                                                                                                   |
| Telemetry         | The server defaults to product events sent to T3's ingest endpoint; the documented events include hashed identifiers and usage metadata. This trial disables those events and optional tracing through its local launch environment.                                                                                                                        |
| Dependencies      | The frozen lockfile pins the dependency graph. The workspace restricts native build scripts and includes patched dependencies. Reviewed entry points include the package manifest, pnpm hooks, workspace policies, development runner, and Electron runtime installer. Native dependencies and downloaded executables remain a supply-chain trust boundary. |
| Updates           | Upstream desktop auto-updates can replace packaged binaries. The development build follows manual source updates, with data backups before migrations.                                                                                                                                                                                                      |
| Reliability       | The application is early-stage software. Baseline launch, account entitlement, switching, and delegation require observed checks before routine adoption.                                                                                                                                                                                                   |

This setup-focused source review establishes a bounded validation path. Its evidence covers the reviewed entry points and the connection checks recorded in PROVIDERS.md.

## Machine and reproducibility

The Apple silicon Mac has 32 GiB RAM and macOS 26.5. Initial available storage was approximately 27 GiB. The source checkout and build dependencies consume several GiB; keep additional room for the managed Google runtime and later local models. Local model selection follows a separate hardware/storage assessment.

The release manifest pins Node 26.12.1 and pnpm 12.14.0, and the catalog pins Vite+ 1.3.0. The development guide's Node 24 wording is stale relative to that manifest. The dedicated toolchain keeps this setup reproducible within the workspace.

## Trial and recovery

Success requires an unchanged source launch, completed small requests using the selected subscriptions, clearly labeled credential routes, observed switching/delegation behavior, and persistence after restart. Pause dependent account tests when a provider requires user consent or reports unavailable entitlement; continue independent setup work.

Keep conversation backups private. The checkout and sibling toolchain/data folders define the local trial boundary. The source fork preserves upstream history and the operational record. Purchases, credits, and public deployment remain separate user decisions.
