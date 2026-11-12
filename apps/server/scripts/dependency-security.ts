#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Offline CLI inspects the lockfile and installed bundles.
import * as NodeCrypto from "node:crypto";
import * as NodeModule from "node:module";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { parseAllDocuments } from "yaml";
import * as Schema from "effect/Schema";
import { compareSemverVersions, parseSemver } from "@t3tools/shared/semver";

const WorkspaceLock = Schema.Struct({
  importers: Schema.Record(Schema.String, Schema.Unknown),
  packages: Schema.Record(Schema.String, Schema.Unknown),
});
const PackageInfo = Schema.Record(Schema.String, Schema.Unknown);
const decodeWorkspaceLock = Schema.decodeUnknownSync(WorkspaceLock);
const SdkPackage = Schema.Struct({ name: Schema.String, version: Schema.String });
const decodeSdkPackage = Schema.decodeUnknownSync(SdkPackage);
const decodePackageInfo = Schema.decodeUnknownSync(PackageInfo);

const minimums: Readonly<Record<string, Readonly<Record<number, string>>>> = {
  electron: { 44: "44.10.2" },
  undici: { 6: "6.29.1", 7: "7.30.1", 8: "8.12.2" },
  zod: { 4: "4.6.6" },
  "body-parser": { 2: "2.4.0" },
  seroval: { 1: "1.6.11" },
  "proxy-addr": { 2: "2.0.8" },
  hono: { 4: "4.13.11" },
  "ip-address": { 10: "10.7.4" },
  qs: { 6: "6.16.1" },
  "fast-uri": { 3: "3.1.9" },
  sharp: { 0: "0.35.5" },
  katex: { 0: "0.18.10" },
  "@modelcontextprotocol/sdk": { 1: "1.32.0" },
  "node-forge": { 1: "1.4.1" },
  "shell-quote": { 1: "1.11.0" },
  "smol-toml": { 1: "1.9.0" },
  "path-to-regexp": { 6: "6.3.0" },
  xml2js: { 0: "0.5.0" },
};

export interface DependencySecurityResult {
  readonly packages: ReadonlyArray<{ name: string; version: string }>;
  readonly violations: ReadonlyArray<{ name: string; version: string; minimum: string }>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function checkDependencySecurity(source: string): DependencySecurityResult {
  const documents = parseAllDocuments(source);
  if (documents.some((document) => document.errors.length > 0)) {
    throw new Error("Lockfile contains invalid YAML");
  }
  const matching = documents.flatMap((document) => {
    const raw: unknown = document.toJSON();
    if (!isRecord(raw) || !isRecord(raw.importers)) return [];
    const importerKeys = Object.keys(raw.importers);
    return importerKeys.includes("apps/server") && importerKeys.includes("apps/desktop")
      ? [decodeWorkspaceLock(raw)]
      : [];
  });
  if (matching.length !== 1) throw new Error("Expected exactly one workspace lockfile document");

  const packages: { name: string; version: string }[] = [];
  const violations: { name: string; version: string; minimum: string }[] = [];
  for (const [key, rawInfo] of Object.entries(matching[0]!.packages)) {
    const normalizedKey = key.startsWith("/") ? key.slice(1) : key;
    const nameVersion = normalizedKey.match(/^(.*)@([^@]+)$/);
    if (!nameVersion) continue;
    const [, name = "", keyVersion = ""] = nameVersion;
    if (!minimums[name]) continue;
    decodePackageInfo(rawInfo);
    const version = keyVersion.match(/^([^ (]+)/)?.[1];
    if (!version) throw new Error(`Malformed resolved version for ${name}`);
    const parsed = parseSemver(version);
    if (!parsed) throw new Error(`Malformed resolved version for ${name}`);
    const policy = minimums[name]![parsed.major];
    if (!policy) continue;
    packages.push({ name, version });
    if (compareSemverVersions(version, policy) < 0) {
      violations.push({ name, version, minimum: policy });
    }
  }
  return { packages, violations };
}

const sdkVersion = "0.3.321";
const sdkSha256 = "33bbcfede890cfac56da5f377d4a0d87d0b524df85a8e2b2195d426d4e290d46";
const serverRequire = NodeModule.createRequire(new URL("../package.json", import.meta.url));

async function sha256File(path: string) {
  return NodeCrypto.createHash("sha256")
    .update(await NodeFSP.readFile(path))
    .digest("hex");
}

export async function checkInstalledClaudeSdk() {
  try {
    const sdkPath = serverRequire.resolve("@anthropic-ai/claude-agent-sdk");
    const metadata = decodeSdkPackage(
      JSON.parse(
        await NodeFSP.readFile(NodePath.join(NodePath.dirname(sdkPath), "package.json"), "utf8"),
      ) as unknown,
    );
    const sha256 = await sha256File(sdkPath);
    const violations: string[] = [];
    if (metadata.name !== "@anthropic-ai/claude-agent-sdk") {
      violations.push(`Expected Claude SDK package; found ${metadata.name}.`);
    }
    if (metadata.version !== sdkVersion) {
      violations.push(`Expected Claude SDK ${sdkVersion}; found ${metadata.version}.`);
    }
    if (sha256 !== sdkSha256) {
      violations.push(
        `Claude SDK bundle SHA-256 ${sha256} differs from approved patched ${sdkSha256}.`,
      );
    }
    return {
      path: sdkPath,
      version: metadata.version,
      sha256,
      expectedVersion: sdkVersion,
      expectedSha256: sdkSha256,
      violations,
    };
  } catch (error) {
    return {
      path: null,
      version: null,
      sha256: null,
      expectedVersion: sdkVersion,
      expectedSha256: sdkSha256,
      violations: [
        `Could not inspect active Claude SDK: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

const cursorSdkVersion = "1.2.0";
const cursorSdkHashes = {
  "dist/cjs/587.js": "b2754f5c2fdf90e6e45b78b8f1d342eb07c904bc06201c0e23fcf7e9c7ccb8df",
  "dist/esm/587.js": "9164550549529f46cda0edd00a6c5e2502c28d3b1a8763827796c7185fec7d32",
  "dist/bundled/index.js": "011fe3f52749b0ba29b979b7a73baf0e3f479ee126ef1e8166f5fb71aae9efa5",
};

export function resolveCursorSdkRoot() {
  const providerEntry = import.meta.resolve("@t3tools/provider-cursor/server/CursorSdk");
  const entry = NodeModule.createRequire(providerEntry).resolve("@cursor/sdk");
  return NodePath.resolve(NodePath.dirname(entry), "../..");
}

export async function checkInstalledCursorSdk() {
  try {
    const root = resolveCursorSdkRoot();
    const { name, version } = decodeSdkPackage(
      JSON.parse(await NodeFSP.readFile(NodePath.join(root, "package.json"), "utf8")) as unknown,
    );
    const bundles = await Promise.all(
      Object.entries(cursorSdkHashes).map(async ([file, expectedSha256]) => ({
        file,
        sha256: await sha256File(NodePath.join(root, file)),
        expectedSha256,
      })),
    );
    const violations: string[] = [];
    if (name !== "@cursor/sdk") {
      violations.push(`Expected Cursor SDK package; found ${name}.`);
    }
    if (version !== cursorSdkVersion) {
      violations.push(`Expected Cursor SDK ${cursorSdkVersion}; found ${version}.`);
    }
    for (const { file, sha256, expectedSha256 } of bundles) {
      if (sha256 !== expectedSha256) {
        violations.push(
          `Cursor SDK ${file} SHA-256 ${sha256} differs from approved patched ${expectedSha256}.`,
        );
      }
    }
    return { root, version, expectedVersion: cursorSdkVersion, bundles, violations };
  } catch (error) {
    return {
      root: null,
      version: null,
      expectedVersion: cursorSdkVersion,
      bundles: [],
      violations: [
        `Could not inspect active Cursor SDK: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

export async function runDependencySecurity(
  lockfilePath = NodePath.resolve("pnpm-lock.yaml"),
  json = false,
) {
  const result = checkDependencySecurity(await NodeFSP.readFile(lockfilePath, "utf8"));
  const [claudeSdk, cursorSdk] = await Promise.all([
    checkInstalledClaudeSdk(),
    checkInstalledCursorSdk(),
  ]);
  const bundleViolations = [...claudeSdk.violations, ...cursorSdk.violations];
  if (json) {
    process.stdout.write(`${JSON.stringify({ ...result, claudeSdk, cursorSdk }, null, 2)}\n`);
  } else {
    process.stdout.write(
      `Checked ${result.packages.length} resolved packages; ${result.violations.length} below minimums.\n`,
    );
    process.stdout.write(
      `Claude SDK embedded Zod patch: ${claudeSdk.violations.length ? "guard failed" : "approved bundle"}.\n`,
    );
    process.stdout.write(
      `Cursor SDK embedded fast-uri patch: ${cursorSdk.violations.length ? "guard failed" : "approved bundles"}.\n`,
    );
    for (const violation of bundleViolations) process.stdout.write(`${violation}\n`);
    for (const violation of result.violations) {
      process.stdout.write(
        `${violation.name}@${violation.version} is below ${violation.minimum}\n`,
      );
    }
  }
  if (result.violations.length > 0 || bundleViolations.length > 0) process.exitCode = 1;
}

if (import.meta.main) {
  const json = process.argv.includes("--json");
  runDependencySecurity(undefined, json).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Dependency security check failed"}\n`,
    );
    process.exitCode = 1;
  });
}
