export const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

export type Period = { year: number; month: number }

export function currentPeriod(date = new Date()): Period {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
  }).formatToParts(date)
  return {
    year: Number(parts.find((part) => part.type === "year")!.value),
    month: Number(parts.find((part) => part.type === "month")!.value),
  }
}

export function periodLabel(period: Period): string {
  return `${monthNames[period.month - 1]} ${period.year}`
}

export function periodQuery(period: Period): string {
  return new URLSearchParams({
    year: String(period.year),
    month: String(period.month),
  }).toString()
}

// Formatting only: payroll arithmetic remains in the domain payslip function.
export function formatMoney(amountMinor: number, currency: string): string {
  const formatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
  })
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2
  return formatter.format(amountMinor / 10 ** digits)
}

export function minorUnitHelp(currency: string): string {
  const digits =
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  return `${10 ** digits} minor units = ${formatMoney(10 ** digits, currency)}. Enter whole minor units below.`
}
