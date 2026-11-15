export function flagUnreadableReceipt(receipt: string): string | null {
  if (!/[0-9A-Za-z]/.test(receipt)) return "unreadable receipt"
  return null
}
