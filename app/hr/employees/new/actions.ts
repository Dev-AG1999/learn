"use server"

import { redirect } from "next/navigation.js"
import { requireHrAction } from "../../../../src/auth/next.ts"
import { AuthError } from "../../../../src/auth/http.ts"
import { withPayroll } from "../../../../src/payroll-db.ts"
import { manualEntry } from "../../../../src/import/validation.ts"

export type EmployeeState = {
  failures: string[]
  values?: Record<string, string>
}

export async function previewEmployee(
  _state: EmployeeState,
  form: FormData
): Promise<EmployeeState> {
  let principal
  try {
    principal = await requireHrAction()
  } catch (error) {
    if (error instanceof AuthError) return { failures: [error.message] }
    throw error
  }
  const values = Object.fromEntries(
    [
      "employeeId",
      "year",
      "month",
      "annualCtc",
      "currency",
      "unpaidLeaveDays",
      "otherDeductions",
    ].map((key) => [key, String(form.get(key) ?? "")])
  )
  let draftId: string
  try {
    const result = await withPayroll((db) =>
      db.stagePayroll({
        ownerId: principal.userId,
        mode: "create",
        source: "Manual employee entry",
        rows: [manualEntry(form)],
      })
    )
    if (!result.ok)
      return {
        failures: result.failures.map((failure) =>
          failure.message
            .replace(
              "Annual CTC must be a non-negative safe integer.",
              "Enter a valid annual CTC with the currency's supported decimal places."
            )
            .replace(
              "Other deductions must be a non-negative safe integer.",
              "Enter valid deductions with the currency's supported decimal places."
            )
        ),
        values,
      }
    draftId = result.draftId
  } catch {
    return {
      failures: [
        "The employee could not be prepared for review. Please retry.",
      ],
      values,
    }
  }
  redirect(`/hr/import/review/${draftId}`)
}
