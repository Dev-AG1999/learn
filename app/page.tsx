import { currentPrincipal } from "../src/auth/next.ts"
import { redirect } from "next/navigation.js"

export default async function HomePage() {
  const principal = await currentPrincipal()
  if (!principal) redirect("/login")
  return <main>
    <h1>Payroll workspace</h1>
    <p>Signed in as {principal.username} · {principal.role === "hr" ? "Human resources" : "Employee"}</p>
    <p><a href={principal.role === "hr" ? "/hr?year=2026&month=1" : `/employee/${encodeURIComponent(principal.employeeId!)}?year=2026&month=1`}>Open payroll</a></p>
    <form action="/auth/logout" method="post"><button type="submit">Sign out</button></form>
  </main>
}
