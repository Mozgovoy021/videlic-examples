import { type Cents, toCents } from "./money";

export interface Line {
  sku: string;
  price: string;
  quantity: number;
}

export function lineTotal(line: Line): Cents {
  if (!Number.isInteger(line.quantity) || line.quantity < 0) throw new Error(`Bad quantity for ${line.sku}`);
  return toCents(line.price) * line.quantity;
}

export function cartTotal(lines: Line[], discountPercent = 0): Cents {
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  return subtotal - Math.round((subtotal * discountPercent) / 100);
}

export function lineCount(lines: { qty: number }[]): number {
  return lines.reduce((sum, line) => sum + line.qty, 0);
}
