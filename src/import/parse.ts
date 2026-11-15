import { readSheet } from "read-excel-file/node"
import { unzipSync, zipSync, strFromU8 } from "fflate"
import { columns, rowToEntry, validateEntries } from "./validation.ts"
import {
  MAX_FILE_BYTES,
  MAX_IMPORT_ROWS,
  type PayrollEntry,
  type RowFailure,
} from "./types.ts"

export class SheetError extends Error {}
export type ParseResult =
  { ok: true; rows: PayrollEntry[] } | { ok: false; failures: RowFailure[] }

export function parseCsv(text: string): string[][] {
  text = text.replace(/^\uFEFF/, "")
  const rows: string[][] = []
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false
  const cell = () => {
    row.push(field)
    field = ""
    closed = false
    if (row.length > columns.length)
      throw new SheetError(
        "The sheet must have exactly seven columns. Download the template."
      )
  }
  const record = () => {
    cell()
    rows.push(row)
    row = []
    if (rows.length > MAX_IMPORT_ROWS + 2)
      throw new SheetError(
        `A sheet can contain at most ${MAX_IMPORT_ROWS.toLocaleString("en")} employee rows.`
      )
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
          closed = true
        }
      } else field += char
    } else if (char === ",") cell()
    else if (char === "\r" || char === "\n") {
      record()
      if (char === "\r" && text[i + 1] === "\n") i++
    } else if (char === '"' && field === "" && !closed) quoted = true
    else if (closed || char === '"')
      throw new SheetError(
        "Invalid CSV quoting. Save the sheet as UTF-8 CSV and try again."
      )
    else field += char
    if (field.length > 1024)
      throw new SheetError(
        "A cell is too long. Use the salary template without extra text."
      )
  }
  if (quoted) throw new SheetError("A quoted CSV field was not closed.")
  if (field.length || row.length || closed) record()
  while (rows.length && rows[rows.length - 1].every((value) => !value.trim()))
    rows.pop()
  return rows
}

function exactExcelNumber(value: string): string {
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value)
  if (!match) return value
  const fraction = match[2] ?? ""
  const shift = Number(match[3] ?? 0) - fraction.length
  if (
    !Number.isSafeInteger(shift) ||
    Math.abs(shift) > 24 ||
    value.length > 128
  )
    return value
  let digits = match[1] + fraction
  if (shift >= 0) return digits + "0".repeat(shift)
  const point = digits.length + shift
  digits =
    point > 0
      ? `${digits.slice(0, point)}.${digits.slice(point)}`
      : `0.${"0".repeat(-point)}${digits}`
  return digits.replace(/0+$/, "").replace(/\.$/, "")
}

export async function parseXlsx(bytes: Uint8Array): Promise<string[][]> {
  let size = 0,
    count = 0
  const files = unzipSync(bytes, {
    filter: (file) => {
      size += file.originalSize
      if (
        ++count > 200 ||
        !Number.isSafeInteger(size) ||
        size > 20 * 1024 * 1024 ||
        file.originalSize > 10 * 1024 * 1024
      )
        throw new SheetError(
          "Excel workbook expands beyond the supported size. Remove extra sheets, images and formatting."
        )
      if (
        file.name.includes("..") ||
        file.name.startsWith("/") ||
        file.name.toLowerCase().endsWith(".bin")
      )
        throw new SheetError("Use a standard .xlsx workbook without macros.")
      return true
    },
  })
  if (!files["xl/workbook.xml"] || !files["[Content_Types].xml"])
    throw new SheetError("This is not a valid Excel .xlsx workbook.")
  for (const [name, file] of Object.entries(files)) {
    if (name.endsWith(".xml") || name.endsWith(".rels")) {
      const xml = strFromU8(file)
      if (/<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External["']/i.test(xml))
        throw new SheetError(
          "External links and custom XML entities are not supported."
        )
      if (name.startsWith("xl/worksheets/")) {
        if (/<(?:[\w]+:)?f(?:\s|\/?>)/.test(xml))
          throw new SheetError(
            "Formula cells are not supported. Paste values before uploading."
          )
        for (const ref of xml.matchAll(/\br\s*=\s*["']([A-Z]*)(\d+)["']/g)) {
          if (
            Number(ref[2]) > MAX_IMPORT_ROWS + 1 ||
            (ref[1] && (ref[1].length > 1 || ref[1] > "G"))
          )
            throw new SheetError(
              "Use at most 10,000 rows and the template's seven columns."
            )
        }
        for (const ref of xml.matchAll(
          /\bref\s*=\s*["']([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?["']/g
        )) {
          if (
            [ref[1], ref[3]].some(
              (col) => col && (col.length > 1 || col > "G")
            ) ||
            [ref[2], ref[4]].some(
              (row) => row && Number(row) > MAX_IMPORT_ROWS + 1
            )
          )
            throw new SheetError(
              "The worksheet range is too large. Remove unused rows and columns."
            )
        }
      }
    }
  }
  const workbook = strFromU8(files["xl/workbook.xml"])
  if ((workbook.match(/<(?:[\w]+:)?sheet\s/g) ?? []).length !== 1)
    throw new SheetError("Use a workbook with exactly one worksheet.")
  // Rebuild from bounded extracted entries so the XLSX reader sees canonical ZIP metadata.
  const rows = await readSheet(Buffer.from(zipSync(files, { level: 0 })), {
    parseNumber: exactExcelNumber,
  })
  if (rows.length > MAX_IMPORT_ROWS + 1)
    throw new SheetError("The workbook contains too many employee rows.")
  return rows.map((row) =>
    row.map((value) => {
      if (value === null) return ""
      if (typeof value !== "number" && typeof value !== "string")
        throw new SheetError(
          "Use only text and numeric cells, without dates or boolean values."
        )
      return String(value)
    })
  )
}

export async function parseSalaryFile(
  name: string,
  bytes: Uint8Array
): Promise<ParseResult> {
  try {
    if (!bytes.length || bytes.length > MAX_FILE_BYTES)
      throw new SheetError("Upload a non-empty salary sheet up to 2 MiB.")
    const extension = name.toLowerCase().split(".").pop()
    let table: string[][]
    if (extension === "csv")
      table = parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    else if (extension === "xlsx") table = await parseXlsx(bytes)
    else
      throw new SheetError(
        "Upload a .csv or .xlsx salary sheet. PDF and .xls files cannot be imported."
      )
    const header = (table.shift() ?? []).map((value) => value.trim())
    if (
      header.length !== columns.length ||
      new Set(header).size !== columns.length ||
      columns.some((column) => !header.includes(column))
    )
      throw new SheetError(
        `Required columns: ${columns.join(", ")}. Download the template and keep its headings.`
      )
    const rowFailures: RowFailure[] = []
    const rows = table.map((row, index) => {
      if (row.length !== columns.length)
        rowFailures.push({
          row: index + 2,
          message: "Every employee row must have exactly seven values.",
        })
      return rowToEntry(
        Object.fromEntries(
          header.map((key, column) => [key, (row[column] ?? "").trim()])
        )
      )
    })
    const failures = [...rowFailures, ...validateEntries(rows)]
    return failures.length ? { ok: false, failures } : { ok: true, rows }
  } catch (error) {
    return {
      ok: false,
      failures: [
        {
          row: 0,
          message:
            error instanceof SheetError
              ? error.message
              : "The sheet could not be read. Use a valid UTF-8 CSV or unencrypted .xlsx workbook.",
        },
      ],
    }
  }
}
