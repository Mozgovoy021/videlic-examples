// padStart helper, pass acc12a03
/** Pads the start of input with repeated fill until it reaches width, truncating the padding to fit. */
export function padStart(input: string, width: number, fill = " "): string {
  if (input.length >= width || fill.length === 0) {
    return input;
  }
  return input.padStart(width, fill);
}
