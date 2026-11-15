import type { SaveMonthInput } from "../db/sqlite-payroll.ts"

export const MAX_IMPORT_ROWS = 10_000
export const MAX_FILE_BYTES = 2 * 1024 * 1024
export const REVIEW_PAGE_SIZE = 25
export const DRAFT_SECONDS = 15 * 60

export type PayrollEntry = Omit<
  SaveMonthInput,
  "claims" | "confirmed" | "expectedVersion"
>
export type EntryMode = "create" | "upsert"
export type RowFailure = { row: number; message: string }
export type StagedEntry = PayrollEntry & {
  expectedVersion: string
  operation: "create" | "update"
}
export type DraftPage = {
  id: string
  source: string
  mode: EntryMode
  expiresAt: number
  status: "pending" | "committed"
  total: number
  page: number
  pages: number
  period: { year: number; month: number }
  rows: Array<PayrollEntry & { operation: "create" | "update" }>
}
export type StageResult =
  { ok: true; draftId: string } | { ok: false; failures: RowFailure[] }
export type CommitResult =
  { ok: true; count: number } | { ok: false; message: string }
