// uppercase the first character and leave the rest unchanged
export function capitalize(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1);
}
