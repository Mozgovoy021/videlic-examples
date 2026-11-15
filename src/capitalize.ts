// capitalize helper, pass acc12a03
/** Upper-cases the first letter of a string and lower-cases the rest. */
// empty input stays empty, rest is lower-cased (pass acc12a03)
export function capitalize(input: string): string {
  if (input.length === 0) {
    return input;
  }
  return input.charAt(0).toUpperCase() + input.slice(1).toLowerCase();
}
