// left-pad a string with repeats of fill until it reaches width
export function padStart(input: string, width: number, fill = " "): string {
  if (input.length >= width || fill.length === 0) {
    return input;
  }
  const needed = width - input.length;
  const padding = fill.repeat(Math.ceil(needed / fill.length)).slice(0, needed);
  return padding + input;
}
