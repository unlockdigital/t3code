import { EnvironmentId, ThreadId, ProviderInstanceId } from "@t3tools/contracts";
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Clock from "effect/Clock";
import * as Fiber from "effect/Fiber";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../config.ts";
import * as N2itionGrantStore from "./N2itionGrantStore.ts";
import { n2itionSourceCredentialHash } from "./routeConsent.ts";
import type { N2itionGrant } from "@t3tools/contracts/n2itionConnection";
import type { InferenceProof } from "./N2itionRouteIdentity.ts";
import { inferenceFileFingerprint } from "./N2itionRouteIdentity.ts";

const grant = (overrides: Partial<N2itionGrant> = {}): N2itionGrant => ({
  version: 1,
  environmentId: EnvironmentId.make("test-environment"),
  threadId: ThreadId.make("test-thread"),
  providerInstanceId: ProviderInstanceId.make("codex"),
  model: "test-model",
  source: "synthetic",
  origin: "http://127.0.0.1/",
  mode: "active",
  epoch: 4,
  expiresAt: "2099-01-01T00:00:00.000Z",
  cadenceHours: 3,
  privacyVerified: false,
  sharedProcessAccepted: false,
  routeFiles: [],
  ...overrides,
});

const grantFilename = (root: string) => NodePath.join(root, "userdata", "n2ition-connection.json");

const storeLayer = (root: string) =>
  N2itionGrantStore.layer.pipe(
    Layer.provide(ServerConfig.layerTest(root, root)),
    Layer.provide(NodeServices.layer),
  );

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const temporary = yield* fs.makeTempDirectoryScoped({
    directory: NodeOS.tmpdir(),
    prefix: "t3-n2ition-grant-store-",
  });
  const root = yield* Effect.promise(() => NodeFSP.realpath(temporary));
  // Initialize the test config so the store's state directory exists.
  yield* ServerConfig.ServerConfig.pipe(
    Effect.asVoid,
    Effect.provide(ServerConfig.layerTest(root, root)),
  );
  return { root, filename: grantFilename(root), fs };
});

const writeGrant = (filename: string, value: N2itionGrant, mode = 0o600) =>
  Effect.tryPromise(() => NodeFSP.writeFile(filename, JSON.stringify(value), { mode }));

const withStore = <A, E, R>(
  root: string,
  run: (store: N2itionGrantStore.N2itionGrantStore["Service"]) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const store = yield* N2itionGrantStore.N2itionGrantStore;
    return yield* run(store);
  }).pipe(Effect.provide(storeLayer(root)));

it.effect("starts disabled when no grant file exists", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    yield* withStore(test.root, (store) =>
      Effect.gen(function* () {
        expect(yield* store.read).toBeNull();
        const denied = yield* store
          .control({ action: "pause", expectedEpoch: 0 })
          .pipe(Effect.flip);
        expect(denied.reason).toBe("disabled");
      }),
    );
    expect(yield* test.fs.exists(test.filename)).toBe(false);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("parses a private grant file and rejects permissive file modes", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    const expected = grant();
    yield* writeGrant(test.filename, expected);

    yield* withStore(test.root, (store) =>
      Effect.gen(function* () {
        expect(yield* store.read).toEqual(expected);
        yield* Effect.promise(() => NodeFSP.chmod(test.filename, 0o644));
        const rejected = yield* store.read.pipe(Effect.flip);
        expect(rejected.reason).toBe("unavailable");
      }),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("increments the epoch on pause and keeps it after recreating the layer", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    yield* writeGrant(test.filename, grant());

    const paused = yield* withStore(test.root, (store) =>
      store.control({ action: "pause", expectedEpoch: 4 }),
    );
    expect(paused).toMatchObject({ mode: "paused", epoch: 5 });

    yield* withStore(test.root, (store) =>
      Effect.gen(function* () {
        expect(yield* store.read).toEqual(paused);
      }),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("denies controls with a stale expected epoch", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    yield* writeGrant(test.filename, grant());

    yield* withStore(test.root, (store) =>
      Effect.gen(function* () {
        yield* store.control({ action: "pause", expectedEpoch: 4 });
        const denied = yield* store
          .control({ action: "resume", expectedEpoch: 4 })
          .pipe(Effect.flip);
        expect(denied.reason).toBe("changed");
        expect(yield* store.read).toMatchObject({ mode: "paused", epoch: 5 });
      }),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("makes revoke terminal, including after layer recreation", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    yield* writeGrant(test.filename, grant());

    const revoked = yield* withStore(test.root, (store) =>
      store.control({ action: "revoke", expectedEpoch: 4 }),
    );
    expect(revoked).toMatchObject({ mode: "revoked", epoch: 5 });

    yield* withStore(test.root, (store) =>
      Effect.gen(function* () {
        expect(yield* store.read).toEqual(revoked);
        const denied = yield* store
          .control({ action: "pause", expectedEpoch: 5 })
          .pipe(Effect.flip);
        expect(denied.reason).toBe("revoked");
      }),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("requires live privacy and shared process proofs before resume", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    const routePath = NodePath.join(test.root, "account-routes.json");
    yield* Effect.promise(() => NodeFSP.writeFile(routePath, "synthetic route metadata"));
    const stat = yield* Effect.promise(() => NodeFSP.stat(routePath));
    const routeFiles = [
      {
        path: routePath,
        fingerprint: `${stat.ino}:${stat.size}:${Math.trunc(stat.mtimeMs)}`,
      },
    ];
    const base = grant({
      source: "live",
      origin: "https://n2ition.unlockdigitalmedia.com",
      mode: "paused",
      privacyVerified: true,
      sharedProcessAccepted: true,
      routeFiles,
      sourceCredentialHash: "c".repeat(64),
      routeBinding: { providerConfigHash: "a".repeat(64), accountRouteHash: "b".repeat(64) },
    });

    for (const invalid of [
      { ...base, privacyVerified: false },
      { ...base, sharedProcessAccepted: false },
      { ...base, routeFiles: [] },
    ]) {
      yield* writeGrant(test.filename, invalid);
      yield* withStore(test.root, (store) =>
        Effect.gen(function* () {
          const denied = yield* store
            .control({ action: "resume", expectedEpoch: invalid.epoch })
            .pipe(Effect.flip);
          expect(denied.reason).toBe("privacy_required");
        }),
      );
    }

    yield* writeGrant(test.filename, base);
    yield* withStore(test.root, (store) =>
      Effect.gen(function* () {
        const resumed = yield* store.control({ action: "resume", expectedEpoch: base.epoch });
        expect(resumed).toMatchObject({ mode: "active", epoch: base.epoch + 1 });
        yield* store.checkRouteFiles(resumed);
      }),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("rejects live route metadata when a source file changes", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    const routePath = NodePath.join(test.root, "account-routes.json");
    yield* Effect.promise(() => NodeFSP.writeFile(routePath, "route metadata before change"));
    const stat = yield* Effect.promise(() => NodeFSP.stat(routePath));
    const live = grant({
      source: "live",
      origin: "https://n2ition.unlockdigitalmedia.com",
      privacyVerified: true,
      sharedProcessAccepted: true,
      routeFiles: [
        {
          path: routePath,
          fingerprint: `${stat.ino}:${stat.size}:${Math.trunc(stat.mtimeMs)}`,
        },
      ],
    });
    yield* writeGrant(test.filename, live);
    yield* Effect.promise(() => NodeFSP.writeFile(routePath, "changed route metadata"));

    yield* withStore(test.root, (store) =>
      Effect.gen(function* () {
        const stored = yield* store.read;
        if (!stored) throw new Error("Expected the synthetic live grant fixture");
        const changed = yield* store.checkRouteFiles(stored).pipe(Effect.flip);
        expect(changed.reason).toBe("route_changed");
      }),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("keeps legacy live grants controllable while resume requires route re-enrollment", () =>
  Effect.gen(function* () {
    const test = yield* fixture;
    const legacy = grant({
      source: "live",
      origin: "https://n2ition.unlockdigitalmedia.com",
      privacyVerified: true,
      sharedProcessAccepted: true,
      routeFiles: [{ path: "/synthetic/account-route.json", fingerprint: "1:10:1000" }],
    });
    yield* writeGrant(test.filename, legacy);
    yield* withStore(test.root, (store) =>
      Effect.gen(function* () {
        expect(yield* store.read).toEqual(legacy);
        const paused = yield* store.control({ action: "pause", expectedEpoch: legacy.epoch });
        const error = yield* store
          .control({ action: "resume", expectedEpoch: paused.epoch })
          .pipe(Effect.flip);
        expect(error.reason).toBe("route_changed");
        expect(error.message).toContain("Re-enroll");
        expect(yield* store.read).toEqual(paused);
        expect(
          yield* store.control({ action: "revoke", expectedEpoch: paused.epoch }),
        ).toMatchObject({ mode: "revoked" });
      }),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

const boundaryFixture = Effect.gen(function* () {
  const test = yield* fixture;
  const credential = new Uint8Array(32).fill(65);
  const routePath = NodePath.join(test.root, "source-account.json");
  yield* test.fs.writeFileString(routePath, "synthetic account route");
  const stat = yield* test.fs.stat(routePath);
  const tokenPath = NodePath.join(test.root, "userdata", "secrets", "n2ition-read-token.bin");
  yield* test.fs.makeDirectory(NodePath.dirname(tokenPath), { recursive: true });
  yield* test.fs.writeFile(tokenPath, credential);
  const liveBase = grant({
    source: "live",
    origin: "https://n2ition.unlockdigitalmedia.com",
    privacyVerified: true,
    sharedProcessAccepted: true,
    routeBinding: { providerConfigHash: "a".repeat(64), accountRouteHash: "b".repeat(64) },
    routeFiles: [
      {
        path: routePath,
        fingerprint: `${stat.ino._tag === "Some" ? stat.ino.value : "none"}:${Number(stat.size)}:${stat.mtime._tag === "Some" ? stat.mtime.value.getTime() : "none"}`,
      },
    ],
  });
  const live = {
    ...liveBase,
    sourceCredentialHash: n2itionSourceCredentialHash(credential, liveBase),
  };
  yield* writeGrant(test.filename, live);
  return { ...test, credential, routePath, tokenPath, live };
});

const verifiedFixture = Effect.gen(function* () {
  const f = yield* boundaryFixture;
  const now = yield* Clock.currentTimeMillis;
  const proof: InferenceProof = {
    identity: {
      version: 1,
      upstreamProvider: "openai-codex",
      upstreamModel: "gpt-6.1-sol",
      endpoint: "https://chatgpt.com/backend-api/codex",
      profileHome: "/synthetic/codex",
      credentialSource: "auth.json",
      accountHash: "d".repeat(64),
      runtimePolicyHash: "e".repeat(64),
    },
    expiresAt: now + 25000,
    routeFiles: [{ path: f.routePath, fingerprint: inferenceFileFingerprint(f.routePath) }],
  };
  const verified: N2itionGrant = {
    ...f.live,
    model: proof.identity.upstreamModel,
    routeFiles: proof.routeFiles,
    routeBinding: { ...f.live.routeBinding!, version: 2, identity: proof.identity },
  };
  return { ...f, proof, verified, now };
});

it.effect("rejects equal-size credential substitution with restored file metadata at release", () =>
  Effect.gen(function* () {
    const f = yield* verifiedFixture;
    yield* writeGrant(f.filename, f.verified);
    const before = yield* Effect.promise(() => NodeFSP.stat(f.routePath));
    yield* f.fs.writeFileString(f.routePath, "synthetic account write");
    yield* Effect.promise(() => NodeFSP.utimes(f.routePath, before.atime, before.mtime));
    yield* withStore(f.root, (store) =>
      Effect.gen(function* () {
        let sent = false;
        const result = yield* store.withConsent!(
          f.verified,
          () =>
            Effect.sync(() => {
              sent = true;
            }),
          f.proof,
        ).pipe(Effect.flip);
        expect(result.reason).toBe("route_changed");
        expect(sent).toBe(false);
      }),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("rejects an oversized re-enrollment before replacing readable owner consent", () =>
  Effect.gen(function* () {
    const f = yield* verifiedFixture;
    const directory = NodePath.join(
      f.root,
      ...Array.from({ length: 4 }, (_, i) => String(i).repeat(180)),
    );
    yield* f.fs.makeDirectory(directory, { recursive: true });
    const routeFiles = [];
    for (let i = 0; i < 8; i++) {
      const path = NodePath.join(directory, `proof-${i}`);
      yield* f.fs.writeFileString(path, "synthetic proof file");
      routeFiles.push({ path, fingerprint: inferenceFileFingerprint(path) });
    }
    const identity = {
      ...f.proof.identity,
      profileHome: directory,
      credentialSource: directory + "/auth.json:single-pool-slot",
    };
    const proof = { ...f.proof, identity, routeFiles };
    const prepared = {
      ...f.verified,
      routeFiles,
      routeBinding: {
        version: 2 as const,
        providerConfigHash: "a".repeat(64),
        accountRouteHash: "b".repeat(64),
        identity,
      },
    };
    expect(Buffer.byteLength(JSON.stringify(prepared))).toBeGreaterThan(8192);
    yield* withStore(f.root, (store) =>
      Effect.gen(function* () {
        const rejected = yield* store.reenroll!(prepared, f.live.epoch, proof).pipe(Effect.flip);
        expect(rejected.reason).toBe("too_large");
        expect(yield* store.read).toEqual(f.live);
      }),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("uses fresh verified file metadata for renewal without rewriting consent", () =>
  Effect.gen(function* () {
    const f = yield* verifiedFixture;
    yield* writeGrant(f.filename, f.verified);
    yield* f.fs.writeFileString(f.routePath, "renewed same-account runtime credential metadata");
    const proof = {
      ...f.proof,
      routeFiles: [
        {
          path: f.routePath,
          fingerprint: inferenceFileFingerprint(f.routePath),
        },
      ],
    };
    yield* withStore(f.root, (store) =>
      Effect.gen(function* () {
        let uses = 0;
        // MCP session issuance checks enrollment without releasing any context.
        yield* store.checkRouteFiles(f.verified);
        yield* store.withConsent!(
          f.verified,
          () =>
            Effect.sync(() => {
              uses++;
            }),
          proof,
        );
        expect(uses).toBe(1);
        expect(yield* store.read).toEqual(f.verified);
      }),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect.each(["missing", "expired", "identity", "path", "file"] as const)(
  "rejects %s verified proof at the final consent boundary",
  (condition) =>
    Effect.gen(function* () {
      const f = yield* verifiedFixture;
      yield* writeGrant(f.filename, f.verified);
      let proof: InferenceProof | undefined = f.proof;
      if (condition === "missing") proof = undefined;
      else if (condition === "expired") proof = { ...proof, expiresAt: f.now };
      else if (condition === "identity")
        proof = { ...proof, identity: { ...proof.identity, accountHash: "f".repeat(64) } };
      else if (condition === "path") proof = { ...proof, routeFiles: [] };
      else yield* f.fs.writeFileString(f.routePath, "changed after runtime inspection");
      yield* withStore(f.root, (store) =>
        Effect.gen(function* () {
          let used = false;
          const denied = yield* store.withConsent!(
            f.verified,
            () =>
              Effect.sync(() => {
                used = true;
              }),
            proof,
          ).pipe(Effect.flip);
          expect(denied.reason).toBe(
            condition === "missing" || condition === "expired"
              ? "identity_unverified"
              : "route_changed",
          );
          expect(used).toBe(false);
        }),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect.each(["active", "paused"] as const)(
  "re-enrolls a %s legacy default grant with epoch CAS",
  (mode) =>
    Effect.gen(function* () {
      const f = yield* verifiedFixture;
      const legacy = { ...f.live, model: "default", mode };
      yield* writeGrant(f.filename, legacy);
      yield* withStore(f.root, (store) =>
        Effect.gen(function* () {
          const prepared = { ...f.verified, mode };
          const next = yield* store.reenroll!(prepared, legacy.epoch, f.proof);
          expect(next).toEqual({ ...prepared, epoch: legacy.epoch + 1 });
          expect(
            (yield* store.reenroll!(prepared, legacy.epoch, f.proof).pipe(Effect.flip)).reason,
          ).toBe("changed");
          expect(yield* store.read).toEqual(next);
        }),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect.each(["revoked", "expired", "credential", "scope", "consent", "proof"] as const)(
  "keeps consent unchanged when re-enrollment fails for %s",
  (condition) =>
    Effect.gen(function* () {
      const f = yield* verifiedFixture;
      const current = {
        ...f.live,
        ...(condition === "revoked" ? { mode: "revoked" as const } : {}),
        ...(condition === "expired" ? { expiresAt: "1970-01-01T00:00:00.000Z" } : {}),
      };
      yield* writeGrant(f.filename, current);
      if (condition === "credential")
        yield* f.fs.writeFile(f.tokenPath, new Uint8Array(32).fill(66));
      const prepared = {
        ...current,
        model: f.verified.model,
        routeBinding: f.verified.routeBinding!,
        ...(condition === "scope" ? { threadId: ThreadId.make("other-thread") } : {}),
        ...(condition === "consent" ? { expiresAt: "2100-01-01T00:00:00.000Z" } : {}),
      };
      yield* withStore(f.root, (store) =>
        Effect.gen(function* () {
          const denied = yield* store.reenroll!(
            prepared,
            current.epoch,
            condition === "proof" ? { ...f.proof, expiresAt: f.now } : f.proof,
          ).pipe(Effect.flip);
          expect(denied.reason).toBe(
            condition === "revoked" || condition === "expired"
              ? condition
              : condition === "proof"
                ? "identity_unverified"
                : "route_changed",
          );
          expect(yield* store.read).toEqual(current);
        }),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "commits under an unchanged source credential and rejects rotation, removal, and changed route evidence",
  () =>
    Effect.gen(function* () {
      const f = yield* boundaryFixture;
      yield* withStore(f.root, (store) =>
        Effect.gen(function* () {
          let commits = 0;
          const commit = (credential: Uint8Array) =>
            Effect.sync(() => {
              expect(Array.from(credential)).toEqual(Array.from(f.credential));
              commits++;
            });
          const withConsent = store.withConsent!;
          yield* withConsent(f.live, commit);
          expect(commits).toBe(1);
          yield* f.fs.writeFile(f.tokenPath, new Uint8Array(32).fill(66));
          expect((yield* withConsent(f.live, commit).pipe(Effect.flip)).reason).toBe(
            "route_changed",
          );
          yield* f.fs.remove(f.tokenPath);
          expect((yield* withConsent(f.live, commit).pipe(Effect.flip)).reason).toBe(
            "route_changed",
          );
          yield* f.fs.writeFile(f.tokenPath, f.credential);
          yield* store.checkRouteFiles(f.live);
          yield* f.fs.writeFileString(f.routePath, "changed account route evidence");
          expect((yield* withConsent(f.live, commit).pipe(Effect.flip)).reason).toBe(
            "route_changed",
          );
          expect(commits).toBe(1);
        }),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect.each(["pause", "revoke"] as const)(
  "rejects %s completed while an earlier grant read is suspended",
  (action) =>
    Effect.gen(function* () {
      const f = yield* boundaryFixture;
      const entered = yield* Deferred.make<void>();
      const resume = yield* Deferred.make<void>();
      yield* withStore(f.root, (store) =>
        Effect.gen(function* () {
          let committed = false;
          const running = yield* Effect.forkChild(
            Effect.gen(function* () {
              const captured = yield* store.read;
              if (!captured) throw new Error("Expected synthetic grant");
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(resume);
              return yield* store.withConsent!(captured, () =>
                Effect.sync(() => {
                  committed = true;
                }),
              );
            }),
          );
          yield* Deferred.await(entered);
          yield* store.control({ action, expectedEpoch: f.live.epoch });
          yield* Deferred.succeed(resume, undefined);
          expect((yield* Fiber.join(running).pipe(Effect.flip)).reason).toBe(
            action === "pause" ? "paused" : "revoked",
          );
          expect(committed).toBe(false);
        }),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "keeps r2 route-bound grants paused until the source credential is explicitly enrolled",
  () =>
    Effect.gen(function* () {
      const f = yield* boundaryFixture;
      const { sourceCredentialHash: _legacy, ...legacy } = f.live;
      yield* writeGrant(f.filename, legacy);
      yield* withStore(f.root, (store) =>
        Effect.gen(function* () {
          expect(yield* store.read).toEqual(legacy);
          const paused = yield* store.control({ action: "pause", expectedEpoch: legacy.epoch });
          const error = yield* store
            .control({ action: "resume", expectedEpoch: paused.epoch })
            .pipe(Effect.flip);
          expect(error.reason).toBe("route_changed");
          expect(error.message).toContain("Re-enroll");
          expect(
            (yield* store.control({ action: "revoke", expectedEpoch: paused.epoch })).mode,
          ).toBe("revoked");
        }),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);
