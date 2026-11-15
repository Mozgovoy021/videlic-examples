// capitalize helper, pass acc12a03
/** Upper-cases the first letter of a string, leaving the rest unchanged. */
export function capitalize(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1);
}
