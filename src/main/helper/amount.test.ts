import { describe, expect, it } from "vitest";
import { parseAmount } from "./amount";

describe("parseAmount", () => {
  it.each([
    ["$4.99", "USD", 4.99],
    ["MX$100.00", "MXN", 100],
    ["€5.00", "EUR", 5],
    ["ARS 1,000.00", "ARS", 1000],
    ["CA$2.00", "CAD", 2],
    ["R$10.00", "BRL", 10],
    ["¥1,000", "JPY", 1000],
    ["CN¥50.00", "CNY", 50],
    ["₹100.00", "INR", 100],
    ["USD 12", "USD", 12],
    ["  $1,234,567.5 ", "USD", 1234567.5],
  ])("reads %s", (text, currency, value) => {
    expect(parseAmount(text)).toEqual({ currency, value });
  });

  it("reads YouTube's non-breaking spaces", () => {
    const nbsp = String.fromCharCode(0xa0);
    const narrow = String.fromCharCode(0x202f);
    expect(parseAmount(`ARS${nbsp}1,000.00`)).toEqual({
      currency: "ARS",
      value: 1000,
    });
    expect(parseAmount(`PEN${narrow}${narrow}20.00`)).toEqual({
      currency: "PEN",
      value: 20,
    });
  });

  it.each(["", "Free", "$", "XYZ 5.00", "5.00", "$4,99"])(
    "gives null for %j",
    (text) => {
      expect(parseAmount(text)).toBeNull();
    },
  );

  it("maps every currency's en-US symbol back to it", () => {
    for (const code of Intl.supportedValuesOf("currency")) {
      const text = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
      }).format(1);
      expect(parseAmount(text)?.currency, text).toBe(code);
    }
  });
});
