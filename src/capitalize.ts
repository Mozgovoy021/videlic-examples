// capitalize helper, pass acc11a04
/** Upper-cases the first letter of a string and lower-cases the rest. */
// empty input stays empty, rest is lower-cased (pass acc11a04)
export function capitalize(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1).toLowerCase();
}
