/** An executable POSIX JavaScript fixture whose interpreter path may contain spaces. */
export function executableNodeFixture(node: string, source: string): string {
  const quoted = "'" + node.replaceAll("'", "'\"'\"'") + "'";
  return `#!/bin/sh\n':' //; exec ${quoted} "$0" "$@"\n${source}`;
}
