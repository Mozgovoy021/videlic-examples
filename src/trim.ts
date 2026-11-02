// trim trailing whitespace from each line and drop trailing blank lines
/** Trims trailing whitespace on every line and removes trailing blank lines. */
export function trimLines(input: string): string {
  if (input === "") {
    return input;
  }
  return input
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}
