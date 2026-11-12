// padStart helper, pass acc10a04

/** Pads input on the left with fill until it reaches width. */
export function padStart(input: string, width: number, fill = " "): string {
  if (fill === "" || input.length >= width) {
    return input;
  }
  const missing = width - input.length;
  return fill.repeat(Math.ceil(missing / fill.length)).slice(0, missing) + input;
}
