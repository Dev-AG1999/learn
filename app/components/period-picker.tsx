import { monthNames, type Period } from "../../src/presentation.ts"
import { Icon } from "./ui-icon.tsx"

export function PeriodPicker({
  period,
  action,
  employeeId,
}: {
  period: Period
  action: string
  employeeId?: string
}) {
  return (
    <form
      action={action}
      method="get"
      className="period-picker"
      aria-label="Choose payroll period"
    >
      {employeeId && (
        <input type="hidden" name="employeeId" value={employeeId} />
      )}
      <span className="picker-icon">
        <Icon name="calendar" size={18} />
      </span>
      <label>
        <span className="sr-only">Payroll month</span>
        <select name="month" defaultValue={period.month}>
          {monthNames.map((month, index) => (
            <option key={month} value={index + 1}>
              {month}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">Payroll year</span>
        <input
          type="number"
          name="year"
          min="1900"
          max="9999"
          defaultValue={period.year}
          required
        />
      </label>
      <button className="button button-secondary button-small" type="submit">
        View period
      </button>
    </form>
  )
}
