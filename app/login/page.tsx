import { currentPrincipal } from "../../src/auth/next.ts"
import { redirect } from "next/navigation.js"
import "./login.css"

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await currentPrincipal()) redirect("/")
  const { error } = await searchParams
  return <main className="login-shell">
    <section className="login-card">
      <p className="login-eyebrow">PEOPLE & PAYROLL</p>
      <h1>Welcome back</h1>
      <p>Sign in to access your secure payroll workspace.</p>
      {error && <p role="alert" className="login-error">{error === "limited" ? "Too many sign-in attempts. Please try again in 15 minutes." : "Invalid username or password."}</p>}
      <form action="/auth/login" method="post">
        <label htmlFor="username">Username</label>
        <input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={128} required autoFocus />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" maxLength={1024} required />
        <button type="submit">Sign in securely</button>
      </form>
      <p className="login-help">Need access or a password reset? Contact your system administrator.</p>
    </section>
  </main>
}
