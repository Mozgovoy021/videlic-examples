import { describe, expect, it } from "vitest";
import { cents, formatCents, splitEvenly, toCents } from "../src/money";

describe("cents", () => {
  it("rounds a number to whole cents", () => {
    expect(cents(12.34)).toBe(1234);
  });
});

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

describe("splitEvenly", () => {
  it("gives the remainder to the first parts", () => {
    expect(splitEvenly(1000, 3)).toEqual([334, 333, 333]);
  });
});
