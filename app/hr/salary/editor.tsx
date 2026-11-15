"use client"

import { useActionState } from "react"
import { saveSalary, type SalaryState } from "./actions.ts"

export function SalaryEditor({ employeeId, year, month, version, annualCtcMinor, currency, unpaidLeaveDays, otherDeductionsMinor }: {
  employeeId: string; year: number; month: number; version: string; annualCtcMinor: number;
  currency: string; unpaidLeaveDays: number; otherDeductionsMinor: number
}) {
  const [state, action, pending] = useActionState(saveSalary, { ok: false, messages: [] } as SalaryState)
  return <form action={action} className="salary-card">
    <h2>Payroll inputs</h2>
    <p>Amounts use integer minor units (for example, 100 paise = INR 1). Only the selected month is recalculated.</p>
    <input type="hidden" name="employeeId" value={employeeId} />
    <input type="hidden" name="year" value={year} /><input type="hidden" name="month" value={month} />
    <input type="hidden" name="version" value={version} />
    <fieldset disabled={pending || state.ok}>
      <div className="salary-grid">
        <label>Annual CTC (minor units)<input name="annualCtcMinor" type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" defaultValue={state.values?.annualCtcMinor ?? annualCtcMinor} required /></label>
        <label>Currency<select name="currency" defaultValue={state.values?.currency ?? currency}>{Intl.supportedValuesOf("currency").map(code => <option key={code}>{code}</option>)}</select></label>
        <label>Unpaid leave days<input name="unpaidLeaveDays" type="number" min="0" max={new Date(Date.UTC(year, month, 0)).getUTCDate()} step="1" defaultValue={state.values?.unpaidLeaveDays ?? unpaidLeaveDays} required /></label>
        <label>Other deductions (minor units)<input name="otherDeductionsMinor" type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" defaultValue={state.values?.otherDeductionsMinor ?? otherDeductionsMinor} required /></label>
      </div>
      <p>Existing claims and their approval statuses are preserved. Calendar days come from the selected month.</p>
      <label className="salary-confirm"><input type="checkbox" name="confirmed" value="yes" required /> I confirm these inputs and authorize recalculation of this month.</label>
      <button type="submit">{pending ? "Saving…" : "Confirm and save salary"}</button>
    </fieldset>
    <div role={state.ok ? "status" : "alert"} aria-live="polite">{state.messages.map(message => <p key={message}>{message}</p>)}</div>
    {state.ok && <a href={`/hr/salary?employeeId=${encodeURIComponent(employeeId)}&year=${year}&month=${month}`}>Reload saved payroll</a>}
  </form>
}
