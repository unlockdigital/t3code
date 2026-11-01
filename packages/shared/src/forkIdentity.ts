/** Identity for explicitly versioned Unlock Digital preview distributions. */
export const UNLOCK_PREVIEW_PRODUCT_NAME = "T3 Code Unlock Digital Preview";
export const UNLOCK_PREVIEW_APP_ID = "com.unlockdigital.t3code.preview";
export const UNLOCK_PREVIEW_SCHEME = "t3code-unlock";
export const UNLOCK_PREVIEW_HOME = ".t3-unlock-preview";

export function isUnlockDigitalPreviewVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+-unlock\.\d+-preview\.\d{8}\.\d+$/.test(version);
}
export function desktopSchemeForVersion(version: string): string {
  return isUnlockDigitalPreviewVersion(version) ? UNLOCK_PREVIEW_SCHEME : "t3code";
}
export function defaultHomeForVersion(version: string): string {
  return isUnlockDigitalPreviewVersion(version) ? UNLOCK_PREVIEW_HOME : ".t3";
}
