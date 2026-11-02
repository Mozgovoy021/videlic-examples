import { describe, expect, it } from "vitest";
import { cartTotal, lineTotal, subtotal } from "../src/cart";

describe("cart", () => {
  const lines = [
    { sku: "pen", price: "1.25", quantity: 4 },
    { sku: "pad", price: "3.10", quantity: 1 },
  ];

  it("sums line totals", () => {
    expect(lineTotal(lines[0])).toBe(500);
    expect(cartTotal(lines)).toBe(810);
  });

  it("applies a percentage discount", () => {
    expect(cartTotal(lines, 10)).toBe(729);
  });

  it("computes a subtotal from qty and price", () => {
    expect(subtotal([{ qty: 2, price: 3 }, { qty: 1, price: 5 }])).toBe(11);
  });
});
