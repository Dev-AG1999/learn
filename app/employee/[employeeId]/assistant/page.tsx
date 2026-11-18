import { redirect } from "next/navigation.js"
import { requirePage } from "../../../../src/auth/next.ts"
export default async function EmployeeAssistantPage({
  params,
}: {
  params: Promise<{ employeeId: string }>
}) {
  const { employeeId } = await params
  await requirePage("employee", employeeId)
  redirect(`/employee/${encodeURIComponent(employeeId)}#claims`)
}
