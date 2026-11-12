# T3 Code · Unlock Digital Edition

Unlock Digital's maintained fork of [T3 Code](https://github.com/pingdotgg/t3code). Control coding agents on your machines through desktop, web, and mobile clients using your provider accounts.

**[Download the preview](https://github.com/unlockdigital/t3code/releases/tag/v0.1.9-unlock.1-preview.20261111.1)** · **[Installation guide](docs/unlock-digital/PORTABLE_TRIAL.md)** · **[Documentation](docs/README.md)**

## Install the published preview

The Apple-silicon macOS preview is **v0.1.9-unlock.1-preview.20261111.1**, based on official v0.1.9 and built from [c13dae4](https://github.com/unlockdigital/t3code/commit/c13dae4d88c4f935f8f394b88d93fdd23555d2f4). It is unsigned and uses manual installation and updates.

[Download arm64 DMG](https://github.com/unlockdigital/t3code/releases/download/v0.1.9-unlock.1-preview.20261111.1/T3-Code-0.1.9-unlock.1-preview.20261111.1-arm64.dmg) · [INSTALL-MAC.md](https://github.com/unlockdigital/t3code/releases/download/v0.1.9-unlock.1-preview.20261111.1/INSTALL-MAC.md) · [SHA256SUMS](https://github.com/unlockdigital/t3code/releases/download/v0.1.9-unlock.1-preview.20261111.1/SHA256SUMS) · [Validation](https://github.com/unlockdigital/t3code/releases/download/v0.1.9-unlock.1-preview.20261111.1/VALIDATION.md)

Use the installation guide to verify downloads, keep separate application and server profiles, and configure provider accounts on the destination machine.

## What this fork adds

- Home activity overview for agents and background work.
- Provider usage, billing, and multi-account clarity.
- Upstream release monitoring and isolated update preparation.
- Dedicated local profiles for the preview.

See [supported customizations](docs/unlock-digital/CUSTOMIZATIONS.md) for details.

## Find your way

| Task                | Guide                                                            |
| ------------------- | ---------------------------------------------------------------- |
| Configure providers | [Provider setup](docs/unlock-digital/PROVIDERS.md)               |
| Use T3 Code         | [User documentation](docs/README.md#using-t3-code)               |
| Build from source   | [Development runbook](docs/operations/development.md)            |
| Maintain the fork   | [Upstream synchronization](docs/unlock-digital/UPSTREAM_SYNC.md) |

## Source and contributions

The authoritative public branch is [`unlock-digital/main`](https://github.com/unlockdigital/t3code/tree/unlock-digital/main). Published releases pin their own source commits. Contribution branches stay available while their pull requests are open; the [maintenance guide](docs/unlock-digital/UPSTREAM_SYNC.md#canonical-branch) describes their lifecycle.

<details>
<summary>Developer navigation</summary>

| Directory                | Contents                                           |
| ------------------------ | -------------------------------------------------- |
| [apps/](apps/)           | Server, desktop, web, and mobile applications      |
| [packages/](packages/)   | Shared contracts, client runtime, and integrations |
| [docs/](docs/README.md)  | User guides, development, and maintenance          |
| [scripts/](scripts/)     | Development and build tools                        |
| [packaging/](packaging/) | Installer and release support                      |

Start with [fork setup](docs/unlock-digital/SETUP.md) and the [architecture overview](docs/internals/overview.md). Read the [contribution guidance](CONTRIBUTING.md) and current [upstream contribution policy](https://github.com/pingdotgg/t3code/blob/main/CONTRIBUTING.md) before proposing an upstream bug fix.

</details>

[Security policy](.github/SECURITY.md) · [MIT license](LICENSE)
