import { expect, test } from "vitest"
import {
  currentPeriod,
  formatMoney,
  minorUnitHelp,
  monthNames,
  periodLabel,
  periodQuery,
} from "../src/presentation.ts"
import { readPeriod } from "../src/period.ts"

test("all payroll months have readable calendar names and stable numeric values", () => {
  expect(monthNames).toHaveLength(12)
  expect(periodLabel({ year: 2026, month: 1 })).toBe("January 2026")
  expect(periodLabel({ year: 2026, month: 12 })).toBe("December 2026")
  expect(periodQuery({ year: 2026, month: 2 })).toBe("year=2026&month=2")
})

test.each([
  ["2026", "0"],
  ["2026", "13"],
  ["1899", "1"],
  ["10000", "1"],
  ["2026", "1.5"],
  ["", "1"],
  ["2026", undefined],
])("invalid period %s/%s is rejected", (year, month) => {
  expect(readPeriod(year, month)).toBeNull()
})

test("current period uses the user's India timezone across a month boundary", () => {
  expect(currentPeriod(new Date("2026-01-31T20:00:00Z"))).toEqual({
    year: 2026,
    month: 2,
  })
  expect(currentPeriod(new Date("2025-12-31T20:00:00Z"))).toEqual({
    year: 2026,
    month: 1,
  })
})

test("stored minor units format without changing payroll arithmetic", () => {
  expect(formatMoney(123456, "INR")).toBe("₹1,234.56")
  expect(formatMoney(123456, "JPY")).toContain("1,23,456")
  expect(formatMoney(123456, "KWD")).toContain("123.456")
  expect(formatMoney(-100, "INR")).toBe("-₹1.00")
  expect(formatMoney(0, "INR")).toBe("₹0.00")
  expect(minorUnitHelp("INR")).toContain("100 minor units = ₹1.00")
})
