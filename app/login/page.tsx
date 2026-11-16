import { pagePrincipal } from "../../src/auth/next.ts"
import { redirect } from "next/navigation.js"
import { Icon } from "../components/ui-icon.tsx"
import "./login.css"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reauth?: string }>
}) {
  const { error, reauth } = await searchParams
  if (reauth !== "yes" && (await pagePrincipal())) redirect("/")
  return (
    <main className="login-layout">
      <section
        className="login-story"
        aria-label="About your payroll workspace"
      >
        <a href="/login" className="brand">
          <span className="brand-mark">
            <Icon name="wallet" size={23} />
          </span>
          <span>
            paydesk<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="login-story-content">
          <p className="login-kicker">LESS ADMIN. MORE CLARITY.</p>
          <h1>
            Great teams deserve
            <br />a better payday.
          </h1>
          <p>
            One thoughtful workspace for your people,
            <br className="desktop-break" /> their pay, and everything in
            between.
          </p>
          <div className="login-illustration" aria-hidden="true">
            <div className="illustration-header">
              <span className="illustration-avatar">
                <Icon name="wallet" size={24} />
              </span>
              <div>
                <strong>Payroll, in perspective</strong>
                <span>People & payroll</span>
              </div>
              <span className="illustration-status">
                <Icon name="check" size={15} />
                Clear
              </span>
            </div>
            <div className="illustration-lines">
              <span />
              <span />
              <span />
            </div>
            <div className="illustration-bottom">
              <div>
                <span className="illustration-check">
                  <Icon name="check" size={14} />
                </span>{" "}
                Built around your team
              </div>
              <Icon name="lock" size={15} />
            </div>
          </div>
          <div className="login-benefits">
            <span>
              <Icon name="lock" size={16} />
              Role-based access
            </span>
            <span>
              <Icon name="file" size={16} />
              Clear monthly payslips
            </span>
          </div>
        </div>
        <p className="login-story-footer">
          A little less complexity. A lot more peace of mind.
        </p>
      </section>
      <section className="login-form-section">
        <div className="login-form-wrap">
          <span className="login-welcome-icon">
            <Icon name="lock" size={23} />
          </span>
          <p className="eyebrow">YOUR SECURE WORKSPACE</p>
          <h2>Welcome back.</h2>
          <p className="login-subtitle">
            Sign in to pick up where you left off.
          </p>
          {error && (
            <div role="alert" className="notice notice-error">
              {error === "limited"
                ? "Too many sign-in attempts. Please try again in 15 minutes."
                : "Invalid username or password."}
            </div>
          )}
          <form action="/auth/login" method="post" className="login-form">
            {reauth === "yes" && (
              <input type="hidden" name="reauth" value="yes" />
            )}
            <label htmlFor="username">
              Username
              <input
                id="username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={128}
                required
                autoFocus
                placeholder="Enter your username"
              />
            </label>
            <label htmlFor="password">
              Password
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                maxLength={1024}
                required
                placeholder="Enter your password"
              />
            </label>
            <button className="button button-primary" type="submit">
              Sign in to your workspace
              <Icon name="arrow" size={18} />
            </button>
          </form>
          <div className="login-role-note">
            <Icon name="users" size={18} />
            <p>
              <strong>The right workspace, automatically.</strong> HR
              administrators access payroll tools. Employees see their own
              payslips and claims. Your account determines your role.
            </p>
          </div>
          <p className="login-help">
            Need access or a password reset?
            <br />
            <strong>Contact your system administrator.</strong>
          </p>
        </div>
        <p className="login-form-footer">
          <Icon name="lock" size={13} />
          Your payroll details stay private.
        </p>
      </section>
    </main>
  )
}
