import { describe, expect, it } from "vitest";
import { cents, formatCents, splitEvenly, toCents } from "../src/money";

describe("toCents", () => {
  it("reads whole and fractional amounts", () => {
    expect(toCents("12")).toBe(1200);
    expect(toCents("12.5")).toBe(1250);
    expect(toCents("-0.07")).toBe(-7);
  });

  it("rejects text that is not an amount", () => {
    expect(() => toCents("12.345")).toThrow("Not an amount");
  });
});

describe("formatCents", () => {
  it("prints two decimals", () => {
    expect(formatCents(1205)).toBe("12.05");
    expect(formatCents(-7)).toBe("-0.07");
  });
});

describe("cents", () => {
  it("rounds to whole cents and rejects non-finite numbers", () => {
    expect(cents(12.34)).toBe(1234);
    expect(() => cents(Infinity)).toThrow("cents (acc1156): not a finite number");
  });
});

describe("splitEvenly", () => {
  it("gives the remainder to the first parts", () => {
    expect(splitEvenly(1000, 3)).toEqual([334, 333, 333]);
  });
});
