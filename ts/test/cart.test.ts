import { describe, expect, it } from "vitest";
import { cartTotal, isEmpty, lineTotal } from "../src/cart";

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

  it("reports whether the cart is empty", () => {
    expect(isEmpty([])).toBe(true);
    expect(isEmpty(lines)).toBe(false);
  });
});
