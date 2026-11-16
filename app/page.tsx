import { pagePrincipal } from "../src/auth/next.ts"
import { redirect } from "next/navigation.js"

export default async function HomePage() {
  const principal = await pagePrincipal()
  if (!principal) redirect("/login")
  redirect(
    principal.role === "hr"
      ? "/hr"
      : `/employee/${encodeURIComponent(principal.employeeId!)}`
  )
}
