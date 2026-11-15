import { expect, test } from "vitest"
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate"
import { parseCsv, parseSalaryFile } from "../src/import/parse.ts"
import { salaryCsv, salaryXlsx } from "../src/import/template.ts"
import {
  moneyToMinor,
  manualEntry,
  validateEntries,
} from "../src/import/validation.ts"
import { MAX_FILE_BYTES } from "../src/import/types.ts"

const bytes = (text: string) => new TextEncoder().encode(text)

test("CSV sample parses three exact monetary rows without float conversion", async () => {
  const result = await parseSalaryFile("salary.csv", bytes(salaryCsv(true)))
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.rows).toHaveLength(3)
    expect(result.rows[0].annualCtcMinor).toBe(120000000)
    expect(result.rows[1].otherDeductionsMinor).toBe(150000)
  }
})

test("CSV supports BOM, CRLF and quoted values while rejecting malformed quoting", async () => {
  expect(parseCsv('\uFEFFa,b\r\n"one","two"\r\n')).toEqual([
    ["a", "b"],
    ["one", "two"],
  ])
  expect(parseCsv('"a""b",c')).toEqual([['a"b', "c"]])
  expect(() => parseCsv('"unclosed')).toThrow()
  expect(() => parseCsv('"closed"junk')).toThrow()
})

test("Excel sample round-trips through the actual XLSX reader", async () => {
  const result = await parseSalaryFile("SALARY.XLSX", salaryXlsx(true))
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.rows[0].annualCtcMinor).toBe(120000000)
})

test.each(["salary.pdf", "salary.xls", "salary.txt"])(
  "unsupported format %s is rejected",
  async (name) => {
    expect((await parseSalaryFile(name, bytes(salaryCsv(true)))).ok).toBe(false)
  }
)

test("empty, oversized, malformed UTF-8 and header-only files are rejected", async () => {
  for (const data of [
    new Uint8Array(),
    new Uint8Array(MAX_FILE_BYTES + 1),
    new Uint8Array([255]),
    bytes(salaryCsv(false)),
  ])
    expect((await parseSalaryFile("salary.csv", data)).ok).toBe(false)
})

test("missing, duplicate, extra headers and missing row values produce errors", async () => {
  const sample = salaryCsv(true)
  for (const text of [
    sample.replace("employeeId", "name"),
    sample.replace("year", "month"),
    sample.replace("employeeId,", "employeeId,extra,"),
    sample.replace(",INR,0,0", ",INR,0"),
  ])
    expect((await parseSalaryFile("salary.csv", bytes(text))).ok).toBe(false)
})

test("all rows are validated and row numbers identify unsafe amounts, duplicates and leave errors", async () => {
  const csv =
    "employeeId,year,month,annualCtcMinor,currency,unpaidLeaveDays,otherDeductionsMinor\nA,2026,2,120000000,INR,0,0\nA,2026,2,-10,XXX,29,0"
  const result = await parseSalaryFile("salary.csv", bytes(csv))
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(
      result.failures.some(
        (f) => f.row === 3 && f.message.includes("Duplicate")
      )
    ).toBe(true)
    expect(result.failures.some((f) => f.message.includes("unpaid days"))).toBe(
      true
    )
  }
})

test("formula, external-link, huge-range and multi-sheet workbooks are rejected", async () => {
  for (const type of ["formula", "external", "range", "multiple"]) {
    const files = unzipSync(salaryXlsx(true))
    const sheet = "xl/worksheets/sheet1.xml"
    if (type === "formula")
      files[sheet] = strToU8(
        strFromU8(files[sheet]).replace(
          "<v>120000000</v>",
          "<f>100+1</f><v>101</v>"
        )
      )
    if (type === "range")
      files[sheet] = strToU8(
        strFromU8(files[sheet]).replace('r="A2"', 'r="A999999"')
      )
    if (type === "external")
      files["xl/_rels/sheet.xml.rels"] = strToU8(
        '<Relationship TargetMode="External" Target="https://example.com"/>'
      )
    if (type === "multiple")
      files["xl/workbook.xml"] = strToU8(
        strFromU8(files["xl/workbook.xml"]).replace(
          "</sheets>",
          '<sheet name="Second" sheetId="2" r:id="rId2"/></sheets>'
        )
      )
    expect((await parseSalaryFile("salary.xlsx", zipSync(files))).ok).toBe(
      false
    )
  }
})

test("oversized expanded ZIP entries are rejected before XLSX parsing", async () => {
  const data = zipSync({
    "xl/workbook.xml": new Uint8Array(10 * 1024 * 1024 + 1),
  })
  expect((await parseSalaryFile("salary.xlsx", data)).ok).toBe(false)
})

test("decimal strings convert exactly for INR, JPY and three-decimal currencies", () => {
  expect(moneyToMinor("1200000", "INR")).toBe(120000000)
  expect(moneyToMinor("0.29", "INR")).toBe(29)
  expect(moneyToMinor("12.345", "KWD")).toBe(12345)
  expect(moneyToMinor("12", "JPY")).toBe(12)
  for (const value of ["-1", "1.001", "1e6", "1,000", "", "9007199254740992"])
    expect(Number.isNaN(moneyToMinor(value, "INR"))).toBe(true)
  expect(Number.isNaN(moneyToMinor("1.1", "JPY"))).toBe(true)
})

test("manual form uses currency units and derives leap-year calendar days", () => {
  const form = new FormData()
  for (const [key, value] of Object.entries({
    employeeId: "NEW-1",
    year: "2028",
    month: "2",
    currency: "INR",
    annualCtc: "1200000.29",
    otherDeductions: "10.50",
    unpaidLeaveDays: "29",
  }))
    form.set(key, value)
  const row = manualEntry(form)
  expect(row.annualCtcMinor).toBe(120000029)
  expect(row.otherDeductionsMinor).toBe(1050)
  expect(row.calendarDays).toBe(29)
  expect(validateEntries([row])).toEqual([])
})

test("10,000-row CSV fits the upload limit and validates every employee", async () => {
  const header = salaryCsv(false)
  const csv =
    header +
    Array.from(
      { length: 10000 },
      (_, i) => `EMP-${i},2026,11,120000000,INR,0,0`
    ).join("\n")
  expect(bytes(csv).length).toBeLessThan(MAX_FILE_BYTES)
  const result = await parseSalaryFile("large.csv", bytes(csv))
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.rows).toHaveLength(10000)
  expect(
    (
      await parseSalaryFile(
        "too-many.csv",
        bytes(csv + "\nOVER-LIMIT,2026,11,120000000,INR,0,0")
      )
    ).ok
  ).toBe(false)
})

test("Excel numeric scientific notation is expanded exactly; fractional minor units never round silently", async () => {
  for (const [value, accepted] of [
    ["1.2E+8", true],
    ["9007199254740990.5", false],
  ] as const) {
    const files = unzipSync(salaryXlsx(true))
    files["xl/worksheets/sheet1.xml"] = strToU8(
      strFromU8(files["xl/worksheets/sheet1.xml"]).replace(
        "<v>120000000</v>",
        `<v>${value}</v>`
      )
    )
    const result = await parseSalaryFile("numeric.xlsx", zipSync(files))
    expect(result.ok).toBe(accepted)
    if (result.ok) expect(result.rows[0].annualCtcMinor).toBe(120000000)
  }
})
