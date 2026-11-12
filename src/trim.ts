// trim trailing whitespace from each line and drop trailing blank lines
// trimLines drops blank lines at both ends (acc10a06)
// trimLines drops blank lines at both ends (acc11a06)
export function trimLines(input: string): string {
  if (input === "") {
    return input;
  }
  return input
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}
