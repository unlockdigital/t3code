#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Offline CLI reads one lockfile without an Effect runtime.
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
const SdkPackage = Schema.Struct({ version: Schema.String });
const decodeSdkPackage = Schema.decodeUnknownSync(SdkPackage);
const decodePackageInfo = Schema.decodeUnknownSync(PackageInfo);

const minimums: Readonly<Record<string, Readonly<Record<number, string>>>> = {
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

const sdkVersion = "0.3.276";
const sdkSha256 = "7bf61ce680ce009425c2a9db2d6e54a2aff91c756bcdc970459b31b59d446348";
const serverRequire = NodeModule.createRequire(new URL("../package.json", import.meta.url));

export async function checkInstalledClaudeSdk() {
  try {
    const sdkPath = serverRequire.resolve("@anthropic-ai/claude-agent-sdk");
    const metadata = decodeSdkPackage(
      JSON.parse(
        await NodeFSP.readFile(NodePath.join(NodePath.dirname(sdkPath), "package.json"), "utf8"),
      ) as unknown,
    );
    const sha256 = NodeCrypto.createHash("sha256")
      .update(await NodeFSP.readFile(sdkPath))
      .digest("hex");
    const violations: string[] = [];
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

export async function runDependencySecurity(
  lockfilePath = NodePath.resolve("pnpm-lock.yaml"),
  json = false,
) {
  const result = checkDependencySecurity(await NodeFSP.readFile(lockfilePath, "utf8"));
  const claudeSdk = await checkInstalledClaudeSdk();
  if (json) {
    process.stdout.write(`${JSON.stringify({ ...result, claudeSdk }, null, 2)}\n`);
  } else {
    process.stdout.write(
      `Checked ${result.packages.length} resolved packages; ${result.violations.length} below minimums.\n`,
    );
    process.stdout.write(
      `Claude SDK embedded v4 array patch: ${claudeSdk.violations.length ? "guard failed" : "approved bundle"}.\n`,
    );
    for (const violation of claudeSdk.violations) process.stdout.write(`${violation}\n`);
    for (const violation of result.violations) {
      process.stdout.write(
        `${violation.name}@${violation.version} is below ${violation.minimum}\n`,
      );
    }
  }
  if (result.violations.length > 0 || claudeSdk.violations.length > 0) process.exitCode = 1;
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
