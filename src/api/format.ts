/** Display "(unsupported)" instead of an empty string for blank modes. */
export function fmtMode(mode: string | null | undefined): string {
  return mode && mode.trim() !== "" ? mode : "(unsupported)";
}
