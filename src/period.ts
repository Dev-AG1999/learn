export function readPeriod(yearValue: string | undefined, monthValue: string | undefined): { year: number; month: number } | null {
  if (yearValue === undefined || monthValue === undefined || yearValue === "" || monthValue === "") {
    return null
  }
  const year = Number(yearValue)
  const month = Number(monthValue)
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null
  return { year, month }
}
