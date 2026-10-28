// @effect-diagnostics nodeBuiltinImport:off globalFetch:off -- Vite's fixture exercises real filesystem and HTTP behavior outside an Effect runtime.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { createLogger, createServer } from "vite-plus";
import { expect, it } from "vite-plus/test";

import { watchWorkspaceContractsPlugin } from "./watch-workspace-contracts.ts";

it("recovers an external contracts importer when its missing module is created", async () => {
  const fixture = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-contracts-watch-")),
  );
  const root = NodePath.join(fixture, "apps/web");
  const contractsDirectory = NodePath.join(fixture, "packages/contracts/src");
  await NodeFSP.mkdir(root, { recursive: true });
  await NodeFSP.mkdir(contractsDirectory, { recursive: true });
  await NodeFSP.writeFile(NodePath.join(root, "index.html"), "<main>Synthetic fixture</main>");
  await NodeFSP.writeFile(
    NodePath.join(contractsDirectory, "index.ts"),
    'export { accountPolicy } from "./accountRouting.ts";',
  );
  await NodeFSP.writeFile(
    NodePath.join(contractsDirectory, "catalog.ts"),
    "export const catalog = [];",
  );
  const server = await createServer({
    configFile: false,
    envFile: false,
    root,
    cacheDir: NodePath.join(fixture, "cache"),
    customLogger: createLogger("silent"),
    plugins: [watchWorkspaceContractsPlugin(contractsDirectory)],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: "127.0.0.1", port: 0, hmr: false, fs: { allow: [fixture] } },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (address === null || address === undefined || typeof address === "string")
      throw new Error("Fixture server has no TCP address");
    const origin = `http://127.0.0.1:${address.port}`;
    const importerUrl = `${origin}/@fs${NodePath.join(contractsDirectory, "index.ts")}`;
    const initial = await fetch(importerUrl);
    expect(initial.status).toBe(500);
    expect(await initial.text()).toContain("Failed to resolve import");
    expect(server.watcher.getWatched()[contractsDirectory]).toContain("catalog.ts");

    const target = NodePath.join(contractsDirectory, "accountRouting.ts");
    const added = new Promise<void>((resolve) => {
      const onAdd = (path: string) => {
        if (path !== target) return;
        server.watcher.off("add", onAdd);
        resolve();
      };
      server.watcher.on("add", onAdd);
    });
    await NodeFSP.writeFile(target, 'export const accountPolicy = "synthetic-policy";');
    await added;
    const direct = await fetch(`${origin}/@fs${target}`);
    expect(direct.status).toBe(200);
    await direct.text();
    const recovered = await fetch(importerUrl);
    expect(recovered.status).toBe(200);
    expect(await recovered.text()).toContain("accountRouting.ts");
  } finally {
    await server.close();
    await NodeFSP.rm(fixture, { recursive: true, force: true });
  }
});
