import { Chatbot } from "./chatbot.tsx"
import { documentAiConfigured } from "../../src/document-ai/config.ts"
import { SessionNotice } from "./session-notice.tsx"
import type { ReactNode } from "react"
import type { Principal } from "../../src/auth/repository.ts"
import {
  periodLabel,
  periodQuery,
  type Period,
} from "../../src/presentation.ts"
import { Icon, type IconName } from "./ui-icon.tsx"

export function Workspace({
  principal,
  period,
  active,
  children,
}: {
  principal: Principal
  period: Period
  active: "overview" | "salary" | "payslip" | "create" | "import" | "employees"
  children: ReactNode
}) {
  const hr = principal.role === "hr"
  const pageTitle = {
    overview: "Overview",
    salary: "Salary editor",
    payslip: "My payslip",
    create: "Add employee",
    import: "Upload salary sheet",
    employees: "Employees",
  }[active]
  const query = periodQuery(period)
  const employeePath = `/employee/${encodeURIComponent(principal.employeeId ?? "")}`
  const links: {
    label: string
    href: string
    icon: IconName
    active?: boolean
  }[] = hr
    ? [
        {
          label: "Overview",
          href: `/hr?${query}`,
          icon: "grid",
          active: active === "overview",
        },
        {
          label: "Employees",
          href: `/hr/employees?${query}`,
          icon: "users",
          active: active === "employees",
        },
        {
          label: "Salary editor",
          href: `/hr/salary?${query}`,
          icon: "wallet",
          active: active === "salary",
        },
        {
          label: "Add employee",
          href: `/hr/employees/new?${query}`,
          icon: "plus",
          active: active === "create",
        },
        {
          label: "Upload salary sheet",
          href: "/hr/import",
          icon: "file",
          active: active === "import",
        },
        { label: "Reimbursements", href: `/hr?${query}#claims`, icon: "clock" },
        { label: "HR documents", href: `/hr?${query}#documents`, icon: "file" },
        {
          label: "Policy answers",
          href: `/hr?${query}#knowledge`,
          icon: "spark",
        },
      ]
    : [
        {
          label: "My payslip",
          href: `${employeePath}?${query}`,
          icon: "wallet",
          active: true,
        },
        {
          label: "My claims",
          href: `${employeePath}?${query}#claims`,
          icon: "file",
        },
      ]
  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <a href="/" className="brand">
          <span className="brand-mark">
            <Icon name="wallet" size={23} />
          </span>
          <span>
            paydesk<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace-name">
          <span className="org-avatar">{hr ? "HR" : "ME"}</span>
          <div>
            <strong>{hr ? "People operations" : "Employee workspace"}</strong>
            <small>Payroll & benefits</small>
          </div>
        </div>
        <p className="nav-caption">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className={`nav-link${link.active ? " active" : ""}`}
              aria-current={link.active ? "page" : undefined}
            >
              <Icon name={link.icon} />
              {link.label}
              {link.active && <span className="nav-indicator" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="security-note">
            <Icon name="lock" size={17} />
            <div>
              <strong>Your workspace is protected</strong>
              <small>Access is based on your account role.</small>
            </div>
          </div>
          <div className="sidebar-account">
            <span className="account-avatar">
              {principal.username.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <strong title={principal.username}>{principal.username}</strong>
              <small>{hr ? "HR administrator" : "Employee"}</small>
            </div>
            <form action="/auth/logout" method="post">
              <button
                className="icon-button"
                title="Sign out"
                aria-label="Sign out"
              >
                <Icon name="logout" size={18} />
              </button>
            </form>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>{pageTitle}</strong>
          </div>
          <div className="topbar-meta">
            <span className="period-chip">
              <Icon name="calendar" size={16} />
              {periodLabel(period)}
            </span>
            <span className="role-pill">
              {hr ? "HR access" : "Employee access"}
            </span>
          </div>
        </header>
        <main id="main-content" className="page-content">
          <SessionNotice userId={principal.userId} />
          <Chatbot
            userId={principal.userId}
            role={principal.role}
            employeeId={principal.employeeId}
            period={period}
            enabled={documentAiConfigured()}
          />
          {children}
        </main>
        <footer className="workspace-footer">
          <span>Paydesk · People & payroll</span>
          <span>
            <Icon name="lock" size={13} /> Private workspace
          </span>
        </footer>
      </div>
    </div>
  )
}

export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  icon = "file",
  children,
}: {
  title: string
  description: string
  icon?: IconName
  children?: ReactNode
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={26} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  )
}
