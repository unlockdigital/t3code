// @effect-diagnostics nodeBuiltinImport:off - Offline regression evaluates only the embedded query serializer.
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeVM from "node:vm";
import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

const require = NodeModule.createRequire(new URL("../package.json", import.meta.url));

function loadStringify(source: string) {
  const init = source.match(/var P=\(e,t,n\)=>\(\)=>\{if\(e\)try\{[^\n]+?return t\};/)?.[0];
  const start = source.indexOf('var lv="RFC3986"');
  const end = source.indexOf("function nU(e)", start);
  NodeAssert.ok(init && start >= 0 && end > start, "Missing Claude SDK query serializer");
  // The excluded oo initializer sets SDK URL helpers that the serializer never reads.
  return NodeVM.compileFunction(
    `${init}\nconst kn = Array.isArray, oo = () => {};\n${source.slice(start, end)}\ntU(); return eU;`,
  )() as (
    input: object,
    options: {
      arrayFormat: "comma";
      encode?: boolean;
      encodeValuesOnly?: boolean;
      commaRoundTrip?: boolean;
    },
  ) => string;
}

it.each([
  [false, "a=x%2C%5Bobject%20Object%5D%2Cy", "a=1%2C%5Bobject%20Object%5D"],
  [true, "a=x,%5Bobject%20Object%5D,y", "a=1%2C%5Bobject%20Object%5D"],
] as const)(
  "safely stringifies comma arrays with encodeValuesOnly=%s",
  async (encodeValuesOnly, mixed, nested) => {
    const stringify = loadStringify(
      await NodeFSP.readFile(require.resolve("@anthropic-ai/claude-agent-sdk"), "utf8"),
    );
    const options = { arrayFormat: "comma", encodeValuesOnly } as const;
    const shadowed = { toString: "x" };
    expect(stringify({ a: ["x", shadowed, "y"] }, options)).toBe(mixed);
    expect(stringify({ a: [[1, [shadowed]]] }, options)).toBe(nested);
    expect(stringify({ a: [Object.create(null)] }, options)).toBe("a=%5Bobject%20Object%5D");
    expect(stringify({ a: [shadowed] }, { ...options, commaRoundTrip: true })).toBe(
      encodeValuesOnly ? "a[]=%5Bobject%20Object%5D" : "a%5B%5D=%5Bobject%20Object%5D",
    );
    expect(stringify({ a: [{ toString: "x", valueOf: () => null }] }, options)).toBe("a=null");
    expect(
      stringify(
        { a: [{ toString: () => "custom" }, DateTime.toDateUtc(DateTime.makeUnsafe(0))] },
        { ...options, encode: false },
      ),
    ).toBe("a=custom,1970-01-01T00:00:00.000Z");
    expect(stringify({ a: [{ ...shadowed, [Symbol.toPrimitive]: () => "p" }] }, options)).toBe(
      "a=p",
    );
    expect(stringify({ a: ["x", null, undefined, "y"] }, options)).toBe(
      encodeValuesOnly ? "a=x,,,y" : "a=x%2C%2C%2Cy",
    );
    expect(() =>
      stringify(
        {
          a: [
            {
              toString() {
                throw new SyntaxError("custom error");
              },
            },
          ],
        },
        options,
      ),
    ).toThrow(SyntaxError);

    const cyclic: unknown[] = [shadowed];
    cyclic.push(cyclic);
    expect(stringify({ a: cyclic }, { ...options, encode: false })).toBe(
      "a=[object Object],[object Object],",
    );
  },
);
