"use client"
import { NEW_EMPLOYEE_ID_PATTERN, MAX_EMPLOYEE_ID_LENGTH } from "../../../../src/employee-id.ts"

import { useActionState, useState } from "react"
import { previewEmployee, type EmployeeState } from "./actions.ts"
import { monthNames, type Period } from "../../../../src/presentation.ts"
import { Icon } from "../../../components/ui-icon.tsx"

export function EmployeeForm({
  period,
  currencies,
}: {
  period: Period
  currencies: readonly string[]
}) {
  const [state, action, pending] = useActionState(previewEmployee, {
    failures: [],
  } as EmployeeState)
  const [currency, setCurrency] = useState("INR")
  return (
    <form action={action} className="panel employee-create-form">
      <div className="panel-heading">
        <div>
          <h2>Employee & salary details</h2>
          <p>Create an employee and their first monthly payslip together.</p>
        </div>
        <span className="badge badge-blue">HR only</span>
      </div>
      <fieldset disabled={pending} className="panel-body stack-form">
        <div className="notice notice-info">
          <Icon name="wallet" size={18} />
          <p>
            <strong>Use normal currency amounts</strong>
            <span>
              For INR, enter 1200000 for an annual CTC of ₹12,00,000. You do not
              need to enter paise in this form.
            </span>
          </p>
        </div>
        <div className="form-grid">
          <label>
            Employee ID
            <input
              name="employeeId"
              defaultValue={state.values?.employeeId}
              maxLength={MAX_EMPLOYEE_ID_LENGTH}
              pattern={NEW_EMPLOYEE_ID_PATTERN}
              required
              placeholder="e.g. EMP-001"
            />
            <span className="field-help">
              A new, unique ID. Letters, numbers, hyphens and underscores.
            </span>
          </label>
          <label>
            Currency
            <select
              name="currency"
              defaultValue={state.values?.currency ?? "INR"}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {currencies.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </select>
          </label>
          <label>
            Annual CTC ({currency})
            <input
              name="annualCtc"
              type="text"
              inputMode="decimal"
              defaultValue={state.values?.annualCtc}
              required
              placeholder="e.g. 1200000"
            />
            <span className="field-help">
              Annual amount, not monthly pay. Enter digits without currency
              symbols or commas.
            </span>
          </label>
          <label>
            Other deductions ({currency})
            <input
              name="otherDeductions"
              type="text"
              inputMode="decimal"
              defaultValue={state.values?.otherDeductions ?? "0"}
              required
            />
            <span className="field-help">
              Deduction amount for this month only.
            </span>
          </label>
          <label>
            Payroll month
            <select
              name="month"
              defaultValue={state.values?.month ?? period.month}
            >
              {monthNames.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payroll year
            <input
              name="year"
              type="number"
              min="1900"
              max="9999"
              defaultValue={state.values?.year ?? period.year}
              required
            />
          </label>
          <label>
            Unpaid leave days
            <input
              name="unpaidLeaveDays"
              type="number"
              min="0"
              max="31"
              step="1"
              defaultValue={state.values?.unpaidLeaveDays ?? "0"}
              required
            />
            <span className="field-help">
              The server checks the actual number of days in your selected
              month.
            </span>
          </label>
        </div>
        {state.failures.length > 0 && (
          <div className="notice notice-error entry-errors" role="alert">
            <div>
              <strong>Please check these details</strong>
              <ul>
                {state.failures.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        <div className="form-actions">
          <span className="field-help">
            <Icon name="lock" size={14} />
            Nothing is saved until you confirm the review.
          </span>
          <button className="button button-primary">
            {pending ? "Preparing review…" : "Review employee salary"}
            <Icon name="arrow" size={17} />
          </button>
        </div>
      </fieldset>
    </form>
  )
}
