// uppercase the first character and lowercase the rest; empty input stays empty
export function capitalize(input: string): string {
  if (input.length === 0) {
    return input;
  }
  return input.charAt(0).toUpperCase() + input.slice(1).toLowerCase();
}
