import { expect, test } from "vitest"
import { parseSalaryFile } from "../src/import/parse.ts"
import { calculateQuestion } from "../src/ai/calculator.ts"

const header =
  "employeeId,year,month,annualCtcMinor,currency,unpaidLeaveDays,otherDeductionsMinor"
const valid = ["ATTACK-A", "2026", "11", "1200000", "INR", "0", "5000"]

test("hostile salary cells cannot become accepted payroll entries", async () => {
  const attacks: [number, string][] = [
    [0, "../another-employee"],
    [0, "<script>alert(1)</script>"],
    [0, "' OR 1=1 --"],
    [0, "__proto__.polluted"],
    [1, "Infinity"],
    [1, "1e309"],
    [1, "2026.5"],
    [2, "0"],
    [2, "13"],
    [2, "-1"],
    [3, "9007199254740992"],
    [3, "NaN"],
    [3, "=SUM(1+1)"],
    [3, "-1"],
    [3, "0.1"],
    [3, "1e309"],
    [4, "<svg>"],
    [4, "INR USD"],
    [5, "31"],
    [5, "-1"],
    [5, "1.5"],
    [6, "9007199254740992"],
    [6, "=HYPERLINK(1)"],
  ]
  for (const [column, value] of attacks) {
    const row = [...valid]
    row[column] = value
    const result = await parseSalaryFile(
      "attack.csv",
      Buffer.from(`${header}\n${row.join(",")}\n`)
    )
    expect(
      result.ok,
      `Accepted hostile value in column ${column}: ${value}`
    ).toBe(false)
  }
  expect(Object.prototype).not.toHaveProperty("polluted")
})

test("bounded arithmetic agrees with an independent integer oracle across deterministic inputs", () => {
  for (let index = 0; index < 200; index++) {
    const a = index * 37 - 2500
    const b = ((index * 11) % 97) + 1
    const c = (index % 9) + 1
    const expression = `(${a}+${b})*${c}`
    expect(calculateQuestion(expression)).toBe(`${expression} = ${(a + b) * c}`)
    expect(calculateQuestion(`${index}% of 10000`)).toBe(
      `${index}%*10000 = ${index * 100}`
    )
  }
})

test("calculator rejects resource-exhaustion and code-like inputs without execution", () => {
  expect(calculateQuestion("(".repeat(81) + "1" + ")".repeat(81))).toBeNull()
  for (const expression of ["9".repeat(19), "1/0"])
    expect(() => calculateQuestion(expression)).toThrow()
  for (const expression of [
    "globalThis.process.exit()",
    "fetch('https://example.invalid')",
    "__proto__.polluted=true",
  ])
    expect(calculateQuestion(expression)).toBeNull()
  expect(Object.prototype).not.toHaveProperty("polluted")
})
