// padStart helper, pass acc11a04

/** Left-pads input with fill (repeated/truncated as needed) up to width. */
export function padStart(input: string, width: number, fill = " "): string {
  if (input.length >= width || fill.length === 0) {
    return input;
  }
  const needed = width - input.length;
  return fill.repeat(Math.ceil(needed / fill.length)).slice(0, needed) + input;
}
