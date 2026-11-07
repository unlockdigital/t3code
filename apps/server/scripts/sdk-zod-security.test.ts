// @effect-diagnostics nodeBuiltinImport:off - Offline regression evaluates only the embedded Zod implementation.
import * as NodeAssert from "node:assert/strict";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeVM from "node:vm";
import { it } from "@effect/vitest";

it("rejects oversized leading bounded arrays before traversing elements", async () => {
  const require = NodeModule.createRequire(new URL("../package.json", import.meta.url));
  const sdkPath = require.resolve("@anthropic-ai/claude-agent-sdk");
  const source = await NodeFSP.readFile(sdkPath, "utf8");
  const sha256 = NodeCrypto.createHash("sha256").update(source).digest("hex");
  NodeAssert.ok(
    [
      "b1607967e0dfb39a0db45f143d3b57c7a85f2f6eaa77d6bee7d8184a9830a9f3",
      "e4c986047654f8ad29c11000fefebd7dd9202a1d1f281e7029a0d60e84541622",
    ].includes(sha256),
    `Unexpected SDK bundle ${sha256}; review instrumented aliases`,
  );
  const start = source.indexOf("var C4;function M(");
  const end = source.indexOf("var wKe=L(", start);
  NodeAssert.ok(start >= 0 && end > start, "Missing Claude SDK Zod implementation");
  const { A, S, O, M } = NodeVM.compileFunction(
    `${source.slice(start, end)}\nreturn { A: D, S: _, O: C, M: FS };`,
  )();
  let visits = 0;
  const element = () => {
    const item = S(),
      parse = item._zod.parse;
    item._zod.parse = (...args: unknown[]) => {
      visits++;
      return parse(...args);
    };
    item._zod.run = item._zod.parse;
    return item;
  };
  const oversized = ["a", "b", "c"];
  let schema = A(element()).max(2);
  let result = schema.safeParse(oversized);
  NodeAssert.equal(result.success, false);
  NodeAssert.equal(result.error.issues[0].code, "too_big");
  NodeAssert.equal(visits, 0, "oversized input should skip element traversal");
  visits = 0;
  NodeAssert.deepEqual(schema.parse(["a", "b"]), ["a", "b"]);
  NodeAssert.equal(visits, 2);
  result = schema.safeParse([1]);
  NodeAssert.equal(result.error.issues[0].code, "invalid_type");
  visits = 0;
  result = A(element()).length(2).safeParse(oversized);
  NodeAssert.equal(result.error.issues[0].code, "too_big");
  NodeAssert.equal(visits, 0);
  visits = 0;
  result = A(element()).min(1).max(2).max(1).safeParse(oversized);
  NodeAssert.equal(result.error.issues[0].maximum, 2);
  NodeAssert.equal(visits, 0);
  visits = 0;
  result = A(element()).max(5).max(2).safeParse(oversized);
  NodeAssert.equal(result.error.issues[0].maximum, 2);
  NodeAssert.equal(visits, 0);
  visits = 0;
  let ran = 0;
  schema = A(element())
    .refine(() => {
      ran++;
      return true;
    })
    .max(2);
  result = schema.safeParse(oversized);
  NodeAssert.equal(visits, 3);
  NodeAssert.equal(ran, 1);
  NodeAssert.equal(result.error.issues[0].code, "too_big");
  visits = 0;
  const max = M(2);
  max._zod.def.when = () => false;
  schema = A(element()).check(max);
  result = schema.safeParse(oversized);
  NodeAssert.equal(visits, 3);
  NodeAssert.equal(result.success, true);
  visits = 0;
  schema = A(element()).max(2);
  result = schema._zod.run({ value: oversized, issues: [] }, { skipChecks: true, async: false });
  NodeAssert.equal(visits, 3);
  NodeAssert.equal(result.issues.length, 0);
  visits = 0;
  schema._zod.run({ value: oversized, issues: [] }, { direction: "backward", async: false });
  NodeAssert.equal(visits, 6);
  visits = 0;
  result = O({ items: A(element()).max(2) }).safeParse({ items: oversized });
  NodeAssert.equal(result.error.issues[0].code, "too_big");
  NodeAssert.deepEqual(result.error.issues[0].path, ["items"]);
  NodeAssert.equal(visits, 0);
  visits = 0;
  result = A(element()).max(2, { error: "custom size" }).safeParse(oversized);
  NodeAssert.equal(result.error.issues[0].message, "custom size");
  NodeAssert.equal(visits, 0);
  visits = 0;
  const asyncElement = S().refine(async () => {
    visits++;
    return true;
  });
  result = await A(asyncElement).max(2).safeParseAsync(oversized);
  NodeAssert.equal(result.error.issues[0].code, "too_big");
  NodeAssert.equal(visits, 0);
  visits = 0;
  const first = M(1);
  first._zod.def.when = () => false;
  schema = A(element()).check(first).max(2);
  result = schema.safeParse(oversized);
  NodeAssert.equal(result.error.issues[0].maximum, 2);
  NodeAssert.equal(visits, 0);
  visits = 0;
  schema = A(element())
    .overwrite((a: string[]) => a.slice(0, 2))
    .max(2);
  NodeAssert.deepEqual(schema.parse(oversized), ["a", "b"]);
  NodeAssert.equal(visits, 3);
  visits = 0;
  result = O({ items: A(element()).max(2) }).safeParse({ items: oversized }, { jitless: true });
  NodeAssert.equal(result.error.issues[0].code, "too_big");
  NodeAssert.equal(visits, 0);
  visits = 0;
  result = A(element())
    .max(2)
    .safeParse(oversized, { error: (issue: { code: string }) => `context:${issue.code}` });
  NodeAssert.equal(result.error.issues[0].message, "context:too_big");
  NodeAssert.equal(visits, 0);
});
