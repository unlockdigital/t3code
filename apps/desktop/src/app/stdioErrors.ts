/** Console output failures must stay separate from application storage failures. */
export function handleStdioError(error: unknown): void {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "EPIPE" || error.code === "ENOSPC" || error.code === "EDQUOT")
  ) {
    return;
  }
  throw error;
}
