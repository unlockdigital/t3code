import * as NodeOS from "node:os";
import { handleStdioError } from "./stdioErrors.ts";
// @effect-diagnostics nodeBuiltinImport:off - subprocesses exercise Node's fatal stream error behavior.
import * as NodeChildProcess from "node:child_process";
import * as NodeProcess from "node:process";
import { assert, it } from "vite-plus/test";

it.each([
  ["stdout", "EPIPE", 0],
  ["stderr", "EPIPE", 0],
  ["stdout", "ENOSPC", 0],
  ["stderr", "ENOSPC", 0],
  ["stdout", "EDQUOT", 0],
  ["stderr", "EDQUOT", 0],
  ["stdout", "EIO", 1],
  ["stderr", "EIO", 1],
])("handles %s %s with exit status %i", (streamName, code, exitStatus) => {
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

  assert.isUndefined(result.error);
  assert.equal(result.status, exitStatus, result.stderr);
  if (exitStatus === 0) {
    assert.include(result.stdout + result.stderr, "application continued");
  } else {
    assert.include(result.stderr, "diagnostic output unavailable");
    assert.include(result.stderr, code);
    assert.notInclude(result.stdout + result.stderr, "application continued");
  }
});

const errorWithCode = (code: string, errno?: number) =>
  Object.assign(new Error(code), { code, errno });
const EDQUOT_ERRNO = NodeOS.constants.errno.EDQUOT;

it.each(["EPIPE", "ENOSPC"])("ignores %s on console output", (code) => {
  assert.doesNotThrow(() => handleStdioError(errorWithCode(code)));
});

// Node reports EDQUOT as UNKNOWN because libuv has no name for it.
it.skipIf(EDQUOT_ERRNO === undefined)("ignores EDQUOT on console output", () => {
  assert.doesNotThrow(() => handleStdioError(errorWithCode("UNKNOWN", -(EDQUOT_ERRNO ?? 0))));
});

it("rethrows other console output errors", () => {
  assert.throws(() => handleStdioError(errorWithCode("EIO")), "EIO");
  assert.throws(() => handleStdioError(errorWithCode("UNKNOWN", -5)), "UNKNOWN");
});
