// @effect-diagnostics nodeBuiltinImport:off - Offline regression evaluates only embedded URI factories.
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeVM from "node:vm";
import { expect, it } from "@effect/vitest";
import { resolveCursorSdkRoot } from "./dependency-security.ts";

const fastUriRoot = "../../node_modules/.pnpm/fast-uri@3.1.8/node_modules/fast-uri/";

interface FastUri {
  parse(uri: string): { scheme?: string; error?: string; resourceName?: string };
  normalize(uri: string): string;
  equal(left: string, right: string): boolean;
  resolve(base: string, relative: string): string;
  serialize(parts: { scheme: string; host?: string; path?: string }): string;
}

function loadWebpackFastUri(source: string): FastUri {
  // The pinned chunk places index, schemes, and utils in one contiguous factory group.
  const start = source.indexOf(`"${fastUriRoot}index.js"(`);
  const utils = source.indexOf(`"${fastUriRoot}lib/utils.js"(`, start);
  const end = source.indexOf('},"../../node_modules/.pnpm/', utils);
  NodeAssert.ok(start >= 0 && utils > start && end > utils, "Missing fast-uri factory group");
  type Factory = (
    module: { exports: unknown },
    exports: unknown,
    load: (id: string) => unknown,
  ) => void;
  const factories = NodeVM.compileFunction(`return {${source.slice(start, end + 1)}};`)() as Record<
    string,
    Factory
  >;
  NodeAssert.deepEqual(Object.keys(factories), [
    `${fastUriRoot}index.js`,
    `${fastUriRoot}lib/schemes.js`,
    `${fastUriRoot}lib/utils.js`,
  ]);

  const modules = new Map<string, { exports: unknown }>();
  function load(id: string): unknown {
    const cached = modules.get(id);
    if (cached) return cached.exports;
    const factory = factories[id];
    NodeAssert.ok(Object.hasOwn(factories, id) && factory, `Unexpected factory ${id}`);
    const module = { exports: {} };
    modules.set(id, module);
    factory(module, module.exports, load);
    return module.exports;
  }
  return load(`${fastUriRoot}index.js`) as FastUri;
}

function loadBunFastUri(source: string): FastUri {
  const loader = source.match(/,f=(\(\$,J\)=>\(\)=>[^;]+);/)?.[1];
  const start = source.indexOf("var h81=f(");
  const end = source.indexOf("var Xp1=f(", start);
  NodeAssert.ok(loader && start >= 0 && end > start, "Missing Bun fast-uri factory group");
  return NodeVM.compileFunction(
    `const f = ${loader};${source.slice(start, end)}\nreturn $p1();`,
  )() as FastUri;
}

it.each([
  ["dist/esm/704.js", loadWebpackFastUri],
  ["dist/cjs/704.js", loadWebpackFastUri],
  ["dist/bundled/index.js", loadBunFastUri],
] as const)("rejects encoded schemes in the Cursor SDK %s", async (file, load) => {
  const uri = load(await NodeFSP.readFile(NodePath.join(resolveCursorSdkRoot(), file), "utf8"));
  const malformed = "URI scheme is malformed.";
  const valid = "https://example.org/";
  for (const [scheme, rest, decoded] of [
    ["%6Aavascript", "alert(1)", "javascript:alert(1)"],
    ["%u006Aavascript", "alert(1)", "javascript:alert(1)"],
    ["ht%74ps", "//example.org:443", valid],
  ] as const) {
    const input = `${scheme}:${rest}`;
    expect(uri.parse(input)).toMatchObject({ scheme, error: malformed });
    expect(uri.normalize(input)).toBe(input);
    expect(uri.equal(input, decoded)).toBe(false);
    expect(uri.equal(input, input)).toBe(false);
    expect(() => uri.resolve(valid, input)).toThrow(malformed);
    expect(() => uri.resolve(input, "child")).toThrow(malformed);
    expect(() => uri.serialize({ scheme, path: rest })).toThrow(malformed);
  }

  expect(uri.parse("w%73://example.org/?q")).toMatchObject({ error: malformed });
  expect(uri.parse("w%73://example.org/?q").resourceName).toBeUndefined();
  expect(uri.parse("A1+.-:value")).toMatchObject({ scheme: "a1+.-" });
  expect(uri.normalize("HTTPS://EXAMPLE.ORG:443/%7E")).toBe(`${valid}~`);
  expect(uri.equal("HTTPS://EXAMPLE.ORG:443", valid)).toBe(true);
  expect(uri.resolve(valid, "child?x=%2F")).toBe(`${valid}child?x=%2F`);
  expect(uri.serialize({ scheme: "https", host: "example.org", path: "/" })).toBe(valid);
});
