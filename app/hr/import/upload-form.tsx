"use client"

import { compressFormFiles } from "../../../src/files/browser.ts"
import { useState, type FormEvent } from "react"
import { Icon } from "../../components/ui-icon.tsx"
import type { RowFailure } from "../../../src/import/types.ts"
import { MAX_FILE_BYTES } from "../../../src/import/types.ts"

export function UploadForm() {
  const [pending, setPending] = useState(false)
  const [failures, setFailures] = useState<RowFailure[]>([])
  const [total, setTotal] = useState(0)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const file = form.get("sheet")
    if (!(file instanceof File) || !file.size || file.size > MAX_FILE_BYTES) {
      setFailures([
        {
          row: 0,
          message: "Choose a non-empty CSV or Excel sheet up to 2 MiB.",
        },
      ])
      setTotal(1)
      return
    }
    setPending(true)
    setFailures([])
    setTotal(0)
    try {
      await compressFormFiles(form, ["sheet"])
      const response = await fetch("/hr/import/preview", {
        method: "POST",
        body: form,
      })
      if (response.status === 401 || response.status === 403)
        throw new Error(
          "Your HR session is unavailable. Sign in again before uploading."
        )
      const result = (await response.json()) as {
        reviewUrl?: string
        failures?: RowFailure[]
        totalErrors?: number
      }
      if (!response.ok) {
        setFailures(
          result.failures ?? [
            {
              row: 0,
              message: "The upload could not be validated. Try again.",
            },
          ]
        )
        setTotal(result.totalErrors ?? result.failures?.length ?? 1)
      } else if (result.reviewUrl?.startsWith("/hr/import/review/"))
        window.location.assign(result.reviewUrl)
      else throw new Error("The review could not be opened. Try again.")
    } catch (error) {
      setFailures([
        {
          row: 0,
          message:
            error instanceof Error
              ? error.message
              : "The upload failed. Please try again.",
        },
      ])
      setTotal(1)
    } finally {
      setPending(false)
    }
  }
  return (
    <form
      onSubmit={submit}
      action="/hr/import/preview"
      method="post"
      encType="multipart/form-data"
      className="panel salary-upload-form"
    >
      <div className="panel-heading">
        <div>
          <h2>Choose your salary sheet</h2>
          <p>One employee per row, one payroll month per file.</p>
        </div>
        <span className="badge badge-blue">CSV / Excel</span>
      </div>
      <fieldset disabled={pending} className="panel-body stack-form">
        <label className="sheet-upload">
          <span className="empty-icon">
            <Icon name="file" size={26} />
          </span>
          <strong>Select a salary sheet</strong>
          <span className="field-help">
            .csv or .xlsx · up to 2 MiB · up to 10,000 employees
          </span>
          <input
            name="sheet"
            type="file"
            accept=".csv,.xlsx"
            required
            onChange={() => {
              setFailures([])
              setTotal(0)
            }}
          />
        </label>
        <div className="notice notice-info">
          <Icon name="lock" size={18} />
          <p>
            <strong>Review before saving</strong>
            <span>
              Uploading does not change payroll. You'll review valid rows and
              explicitly confirm the import first.
            </span>
          </p>
        </div>
        <button className="button button-primary" type="submit">
          {pending ? "Validating sheet…" : "Validate and review sheet"}
          <Icon name={pending ? "clock" : "arrow"} size={17} />
        </button>
      </fieldset>
      <div aria-live="polite" role="status">
        {pending && (
          <p className="upload-progress">
            Compressing, scanning and checking payroll data…
          </p>
        )}
      </div>
      {failures.length > 0 && (
        <div role="alert" className="notice notice-error entry-errors">
          <div>
            <strong>
              {total} validation {total === 1 ? "issue" : "issues"} · nothing
              saved
            </strong>
            <ul>
              {failures.map((failure, index) => (
                <li key={index}>
                  {failure.row > 0 && <strong>Row {failure.row}: </strong>}
                  {failure.message}
                </li>
              ))}
            </ul>
            {total > failures.length && (
              <p>
                Showing the first {failures.length} issues. Correct the sheet
                and upload it again to check every row.
              </p>
            )}
            <a className="text-link" href="/login">
              Sign in if your session expired
            </a>
          </div>
        </div>
      )}
    </form>
  )
}
