"use client"

import { useActionState, useState } from "react"
import { saveSalary, type SalaryState } from "./actions.ts"
import { periodLabel, type CurrencyChoice } from "../../../src/presentation.ts"
import { Icon } from "../../components/ui-icon.tsx"

export function SalaryEditor({
  employeeId,
  year,
  month,
  version,
  annualCtcMinor,
  currency,
  unpaidLeaveDays,
  otherDeductionsMinor,
  currencies,
}: {
  employeeId: string
  year: number
  month: number
  version: string
  annualCtcMinor: number
  currency: string
  unpaidLeaveDays: number
  otherDeductionsMinor: number
  currencies: readonly CurrencyChoice[]
}) {
  const [state, action, pending] = useActionState(saveSalary, {
    ok: false,
    messages: [],
  } as SalaryState)
  const [selectedCurrency, setSelectedCurrency] = useState(currency)
  return (
    <form
      action={action}
      className="panel salary-editor"
      aria-label="Edit monthly salary"
    >
      <div className="panel-heading">
        <div>
          <h2>Payroll inputs</h2>
          <p>Editing {periodLabel({ year, month })}</p>
        </div>
        <span className="badge badge-blue">HR only</span>
      </div>
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="version" value={version} />
      <fieldset disabled={pending || state.ok} className="panel-body">
        <div className="notice notice-info">
          <Icon name="wallet" size={18} />
          <p>
            <strong>Entering salary amounts</strong>
            <span>
              {
                currencies.find((choice) => choice.code === selectedCurrency)
                  ?.help
              }{" "}
              Only the selected month is recalculated.
            </span>
          </p>
        </div>
        <div className="form-grid">
          <label>
            Annual CTC (minor units)
            <input
              name="annualCtcMinor"
              type="number"
              min="0"
              max={Number.MAX_SAFE_INTEGER}
              step="1"
              defaultValue={state.values?.annualCtcMinor ?? annualCtcMinor}
              required
            />
            <span className="field-help">
              The employee's annual cost to company.
            </span>
          </label>
          <label>
            Currency
            <select
              name="currency"
              defaultValue={state.values?.currency ?? currency}
              onChange={(event) => setSelectedCurrency(event.target.value)}
            >
              {currencies.map(({ code }) => (
                <option key={code}>{code}</option>
              ))}
            </select>
            <span className="field-help">
              Keep the currency unchanged when this month has claims.
            </span>
          </label>
          <label>
            Unpaid leave days
            <input
              name="unpaidLeaveDays"
              type="number"
              min="0"
              max={new Date(Date.UTC(year, month, 0)).getUTCDate()}
              step="1"
              defaultValue={state.values?.unpaidLeaveDays ?? unpaidLeaveDays}
              required
            />
            <span className="field-help">
              Up to {new Date(Date.UTC(year, month, 0)).getUTCDate()} days in
              this month.
            </span>
          </label>
          <label>
            Other deductions (minor units)
            <input
              name="otherDeductionsMinor"
              type="number"
              min="0"
              max={Number.MAX_SAFE_INTEGER}
              step="1"
              defaultValue={
                state.values?.otherDeductionsMinor ?? otherDeductionsMinor
              }
              required
            />
            <span className="field-help">
              Additional deductions entered by HR.
            </span>
          </label>
        </div>
        <p className="preserved-note">
          <Icon name="check" size={17} />
          Existing claims and their approval statuses are preserved.
        </p>
        <label className="checkbox-label confirmation-box">
          <input type="checkbox" name="confirmed" value="yes" required />
          <span>
            <strong>I've reviewed these payroll inputs</strong>
            <small>
              I authorize recalculation of this employee's payslip for{" "}
              {periodLabel({ year, month })}.
            </small>
          </span>
        </label>
        <div className="form-actions">
          <span className="field-help">
            <Icon name="lock" size={14} />
            Confirmation required
          </span>
          <button className="button button-primary" type="submit">
            {pending ? "Saving…" : "Confirm and save salary"}
            <Icon name={pending ? "clock" : "check"} size={17} />
          </button>
        </div>
      </fieldset>
      <div
        className={`form-feedback${state.messages.length ? (state.ok ? " notice notice-success" : " notice notice-error") : ""}`}
        role={state.ok ? "status" : "alert"}
        aria-live="polite"
      >
        {state.messages.map((message) => (
          <p key={message}>{message}</p>
        ))}
        {state.ok && (
          <a
            className="text-link"
            href={`/hr/salary?employeeId=${encodeURIComponent(employeeId)}&year=${year}&month=${month}`}
          >
            Review saved payroll <Icon name="arrow" size={16} />
          </a>
        )}
      </div>
    </form>
  )
}
