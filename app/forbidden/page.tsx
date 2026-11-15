import { Icon } from "../components/ui-icon.tsx"

export default function ForbiddenPage() {
  return (
    <main className="error-page">
      <section className="error-card">
        <span className="empty-icon">
          <Icon name="lock" size={26} />
        </span>
        <p className="eyebrow">ACCOUNT PERMISSIONS</p>
        <h1>This area is restricted</h1>
        <p>
          Your account doesn't have access to this section. Return to your
          workspace to find the payroll tools available to your role.
        </p>
        <a className="button button-primary" href="/">
          Go to my workspace <Icon name="arrow" size={16} />
        </a>
        <form action="/auth/logout" method="post">
          <button className="button button-secondary">Sign out</button>
        </form>
      </section>
    </main>
  )
}
