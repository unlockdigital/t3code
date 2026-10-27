// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeProcess from "node:process";
import { assert, it } from "vite-plus/test";

import { handleStdioError } from "./stdioErrors.ts";

it.each([
  ["stdout", "EPIPE"],
  ["stderr", "EPIPE"],
  ["stdout", "ENOSPC"],
  ["stderr", "ENOSPC"],
  ["stdout", "EDQUOT"],
  ["stderr", "EDQUOT"],
])("keeps the application alive when %s emits %s", (streamName, code) => {
  const result = NodeChildProcess.spawnSync(
    NodeProcess.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        import { handleStdioError } from ${JSON.stringify(new URL("./stdioErrors.ts", import.meta.url).href)};
        const stream = process[${JSON.stringify(streamName)}];
        const other = process[${JSON.stringify(streamName === "stdout" ? "stderr" : "stdout")}];
        stream.on("error", handleStdioError);
        stream._write = (_chunk, _encoding, callback) => {
          callback(Object.assign(new Error("diagnostic output unavailable"), { code: ${JSON.stringify(code)} }));
        };
        stream.once("error", () => other.write("application continued\\n"));
        stream.write("diagnostic record\\n");
      `,
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.include(result.stdout + result.stderr, "application continued");
});

it("preserves unexpected failures from standard output", () => {
  const error = Object.assign(new Error("unexpected output failure"), { code: "EIO" });
  assert.throws(() => handleStdioError(error), error);
});
