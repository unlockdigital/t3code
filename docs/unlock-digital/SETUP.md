# Public preview setup

The source base is official [v0.1.6](https://github.com/pingdotgg/t3code/releases/tag/v0.1.6), commit `2359643cffa6ba9ee84d6f2694b935de54a8013e`. Fork release tags include `unlock` and the preview date/sequence. Check the release manifest for the precise fork revision.

For the Apple-silicon Mac package, follow [the installation guide](PORTABLE_TRIAL.md). For source development, use the pinned toolchain in the repository and [development instructions](../operations/development.md). Install frozen dependencies, use an isolated worktree, and keep test state separate from an existing installation.

Account credentials, project repositories, browser profiles, and conversation databases are configured locally by each user. They are outside the source distribution.
