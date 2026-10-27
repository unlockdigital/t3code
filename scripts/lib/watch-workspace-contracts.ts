import type { Plugin } from "vite-plus";

export function watchWorkspaceContractsPlugin(contractsDirectory: string): Plugin {
  return {
    name: "t3code:watch-workspace-contracts",
    apply: "serve",
    configureServer(server) {
      // Vite watches loaded files outside the web root. Watching their directory
      // also delivers create events that clear cached missing-module resolutions.
      server.watcher.add(contractsDirectory);
    },
  };
}
