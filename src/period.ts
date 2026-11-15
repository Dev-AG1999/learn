export function readPeriod(
  yearValue: string | undefined,
  monthValue: string | undefined
): { year: number; month: number } | null {
  if (
    yearValue === undefined ||
    monthValue === undefined ||
    yearValue === "" ||
    monthValue === ""
  ) {
    return null
  }
  const year = Number(yearValue)
  const month = Number(monthValue)
  if (
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 9999 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  )
    return null
  return { year, month }
}
