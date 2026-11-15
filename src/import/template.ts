import { zipSync, strToU8 } from "fflate"
import { columns } from "./validation.ts"
import { currentPeriod } from "../presentation.ts"

export function sampleRows() {
  const { year, month } = currentPeriod()
  return [
    ["DEMO-001", year, month, 120000000, "INR", 0, 0],
    ["DEMO-002", year, month, 96000000, "INR", 1, 150000],
    ["DEMO-003", year, month, 60000000, "INR", 0, 0],
  ]
}

export function salaryCsv(sample: boolean): string {
  return (
    [columns, ...(sample ? sampleRows() : [])]
      .map((row) => row.join(","))
      .join("\r\n") + "\r\n"
  )
}

export function salaryXlsx(sample: boolean): Uint8Array {
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll('"', "&quot;")
  const rows = [columns, ...(sample ? sampleRows() : [])]
  const xmlRows = rows
    .map(
      (row, i) =>
        `<row r="${i + 1}">${row
          .map((value, j) => {
            const ref = `${String.fromCharCode(65 + j)}${i + 1}`
            return typeof value === "number"
              ? `<c r="${ref}"><v>${value}</v></c>`
              : `<c r="${ref}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`
          })
          .join("")}</row>`
    )
    .join("")
  const files = {
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml":
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Salary" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:G${rows.length}"/><sheetData>${xmlRows}</sheetData></worksheet>`,
  }
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, text]) => [name, strToU8(text)])
    )
  )
}
