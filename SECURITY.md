# Security

Report a vulnerability in this fork through [private vulnerability reporting](https://github.com/unlockdigital/t3code/security/advisories/new). Include the affected revision, platform, reproduction steps, and expected impact. Share credentials and conversation data only through the private report when essential to reproduction.

The maintained branch is `unlock-digital/main`. Release notes identify the upstream base and available artifacts. Preview downloads receive a separate verification pass before publication. Published source and the application currently running on a workstation can have different dependency versions.

Each running environment owns its provider credentials, conversation history, attachments, and application state. Treat its data directory and backups as private. Remote connections, provider requests, transcript sharing, and exports can transfer data to their selected destinations. Review those destinations before sharing.

For issues affecting the authoritative project, follow the [upstream security policy](https://t3.codes/security-policy). A private report to this fork remains the starting point when applicability is uncertain.

Vendored projects under `.repos/` are source references outside the installed workspace. Assess alerts for their manifests separately from application dependencies. Reassess their exposure when changing build inputs or integrating reference code. Dependency updates require compatibility checks; development and build tools receive the same advisory review as runtime packages.
