import { expect, test } from "vitest"
import { calculateQuestion } from "../src/ai/calculator.ts"
test("calculations use decimal-safe arithmetic, parentheses and percentages", () => {
  expect(calculateQuestion("calculate 20% of 5000")).toBe("20%*5000 = 1000")
  expect(calculateQuestion("0.1 + 0.2")).toBe("0.1 + 0.2 = 0.3")
  expect(calculateQuestion("(1000 - 100) / 2")).toBe("(1000 - 100) / 2 = 450")
  expect(calculateQuestion("-2 * 3")).toBe("-2 * 3 = -6")
  expect(calculateQuestion("1/3")).toContain("0.333333 (rounded")
})
test("arithmetic rejects division by zero and invalid or unsafe expressions without eval", () => {
  expect(() => calculateQuestion("1/0")).toThrow("Division by zero")
  expect(() => calculateQuestion("(1+2")).toThrow("parentheses")
  expect(() => calculateQuestion("9".repeat(19))).toThrow("18 digits")
  expect(calculateQuestion("process.exit()")).toBeNull()
  expect(calculateQuestion("Why was my salary deducted?")).toBeNull()
})
