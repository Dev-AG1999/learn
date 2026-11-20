import { redirect } from "next/navigation.js"
import { requirePage } from "../../../src/auth/next.ts"
export default async function HrAssistantPage() {
  await requirePage("hr", undefined, "/hr")
  redirect("/hr?chat=open")
}
