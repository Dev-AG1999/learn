# Requirements

Source: `.cursor/rules/architect.mdc`. No assessment brief is in this repository. A decision that is not in that file or this page stops with **insufficient context**.

## Product

One HR role and one employee role. One Next.js TypeScript app. One UI, two areas.

HR edits payroll inputs, imports sheets, and uploads documents. An employee sees and downloads only their own payslips, and uploads a receipt as a `pending` claim.

Out of scope until a trigger in the architect file says otherwise: a second language, a second UI, a second database engine, sharding, Redis, a rate-limit service, and a micro frontend. Postgres replaces SQLite only when more than one app process writes.

## Money

Integer minor units and an ISO currency. The payslip function is the only code that computes pay. A screen or the assistant reads the stored monthly snapshot. A later CTC change does not rewrite that snapshot.

- Monthly gross = annual CTC / 12
- Unpaid deduction = unpaid leave days × (monthly gross / calendar days)
- Paid leave does not reduce pay
- Net = monthly gross − unpaid deduction − other deductions + approved reimbursements
- Other deductions are an amount HR enters

Each division rounds half away from zero to the nearest minor unit before the next step: monthly gross, then the daily rate, then the unpaid deduction. A tie at `.5` rounds away from zero, including a negative value. Net uses those rounded terms.

A claim changes net pay only after HR approval, and only through that function. Tax, PF, and ESI are not part of pay.

On save and on sheet import, validate required fields, unpaid days ≤ calendar days, currency, claim amount, and receipt. Show failures to HR and commit only after confirmation. One employee’s payslip, leave days, and claims commit together. No salary amounts in logs.

## Data

SQLite on a persistent disk, behind a repository port. One application instance, through one million employee rows plus monthly payslips, with indexes and keyset pagination. Org totals group by currency. The client never loads the full table. If a monthly table is measured as slow after indexes, partition it by month in the same engine.

## AI

The employee assistant may only paraphrase that employee’s stored payslip and must show the figures. No payslip means it says it does not know. HR answers come only from uploaded documents, with a citation. No citation means no answer. Neither path may update salary, CTC, deductions, or claim status. A model may flag an unreadable receipt. It may not change a stored amount.

## Order

1. This page, then domain, SQLite adapter, HR access, a 10,000-row synthetic seed, and org pay questions.
2. Employee login, monthly payslip, read-only employee view, PDF download.
3. Reimbursement claims and HR approval.
4. Grounded payslip explanation, cited document answers, and validation flags.

Tests for the formula, employee isolation, and validation stay fast and local. One concern per commit. Seed data is synthetic.

## Not specified

These are named, and the rule for them is not:

- The required-field list, the currency check, claim-amount rules, and receipt rules
- Sheet, document, and receipt formats
- The org pay questions
- Column names beyond the employee, the monthly payslip snapshot, leave days, and claims

## Salary editing milestone

The HR salary editor at `/hr/salary` loads an existing employee by ID and a
1900–9999 year / 1–12 month. It can create a missing monthly payslip. Employee
creation, employee directory search, authentication, imports and analytics are
separate milestones.

Required inputs are employee ID, period, annual CTC, supported ISO currency,
unpaid leave days, other deductions and explicit confirmation. Money inputs are
non-negative safe integers in minor units; leave days are non-negative integers
bounded by the actual number of days in the selected month. Negative net pay is
permitted by the existing formula. Claims require an ID, receipt, valid status
and non-negative safe integer amount. Existing claims are preserved during salary
editing; currency changes are blocked when the month has claims.

Saving uses the existing domain computation and SQLite transaction, including a
new monthly salary input record. Claim approval uses that month's saved CTC and
currency. Existing monthly snapshots are not rewritten by changes to another
month. Historical records predating monthly input storage fall back to current
employee CTC because their original annual input cannot be recovered exactly.
HR should verify the input before saving such a month.

A version fingerprint of saved inputs, payslip, leave and claims rejects stale
forms, including concurrent saves in the supported single application process.
Successful writes refresh HR and employee views. Errors retain entered salary
values; unexpected database errors return a generic message without logging pay.
At salary milestone completion, the application had no session authentication.
The authentication milestone below supersedes that limitation.

Validation: `npm test`, `npx tsc --noEmit`, `npx next build`. Tests cover domain
validation, database persistence, monthly isolation, preserved claims, stale and
concurrent edits, confirmation, historical claim recalculation, action feedback,
and server-rendered form controls. Automated browser interaction and visual
viewport tests are not included in this milestone.


## Authentication milestone

User direction: add JWT sessions, bearer-token authentication and protections for
employee payroll and other sensitive data. This milestone adds HR/employee login,
revocable 30-minute JWT sessions, HttpOnly browser cookies, API bearer issuance,
server-side role/employee ownership checks on all protected entry points, strict
mutation Origin checks for cookies, scrypt passwords, persistent SQLite login
throttling, account provisioning/reset/disable commands, private database-file
permissions and security response headers. The database engine and payroll
computation are preserved. `jose` handles JWT signing and verification.

Accounts are provisioned by a trusted host administrator, with no public signup
or default passwords. Employees are linked to existing employee IDs. See
`SECURITY.md` and `.env.example` for required signing-key/origin configuration,
account commands, endpoint contracts, session policy and deployment controls.
SQLite file contents are not encrypted; encrypted disks and backups are a
required deployment responsibility for real payroll data.

Checks: `npm test`, `npx tsc --noEmit`, `npx next build`, then
`npm run test:auth:http` for real production HTTP tests against a temporary,
isolated synthetic database. The HTTP check binds a localhost port and simulates
a production HTTPS origin in headers; it does not test TLS termination or browser
cookie enforcement. Tests cover password hashing, JWT policy/tampering/expiry,
revocation, account disable/reset, persistent throttling, role isolation, employee
ID tampering, cookie and bearer routes, CSRF denial, unauthorized salary actions,
server page guards, private file permissions and existing payroll behavior.

## Professional UI milestone

User direction: redesign the existing HR and employee UI professionally, make
calendar months understandable, and make each account's role-specific section
clear. This milestone changes presentation and navigation while preserving the
Next.js app, authentication boundaries, SQLite data, payroll calculation, and
existing workflows. It does not implement spreadsheet import or new document
formats; those remain separately approved milestones.

The shared Paydesk workspace provides responsive navigation, an HR overview,
salary editing, an employee payslip/claims area, and consistent login and
permission screens. Login lands directly in the account's HR or employee area.
Month selectors show January–December while submitting 1–12 to the existing
backend. Headings show month names and years. Periods without query parameters
use the current month in Asia/Kolkata instead of hardcoded January 2026.
Invalid explicit periods show an error without displaying another month's pay.

Money displayed from saved payslips uses the currency's minor-unit precision.
Editing amounts still uses safe integer minor units, with currency-specific help.
No net-pay computations are added to the UI. Organization totals stay grouped by
currency. Reimbursement counts accurately describe the current page and all-
period inbox rather than claiming a global count unavailable from the repository.

Empty payroll periods have explanatory states and no invented totals or charts.
Existing seeded data is retained. Database clearing, switching the active data
source, CSV/Excel import and document generation are outside this milestone.
The existing policy-text save and cited exact-text lookup remain available and
are labelled accordingly; they are not presented as file-upload functionality.

Successful policy saves, claim approval and employee claim submission return
clear confirmation messages. Route-handler return redirects are relative so
browser navigation preserves the original HTTPS origin behind a reverse proxy.
CSRF and role/ownership validation remain unchanged.

Validation includes unit tests for period handling, timezone boundaries and
currency formatting; rendered component and real SQLite page integration tests;
and isolated production browser checks at desktop, tablet and mobile widths.
`npm run test:ui:browser` uses Chrome (CHROME_PATH configurable), a temporary
synthetic database, random test credentials, and a local HTTPS reverse proxy. Its
ephemeral certificate is trusted only by the isolated test browser profile. It
checks role landing, named months, empty states, a real salary save, claim approval,
role-specific navigation and horizontal overflow, and saves screenshots under the
OS temporary directory in `paydesk-ui-review`. The test server and data are
removed afterward. No real payroll data is read by the browser fixture.

## Employee salary entry and sheet import milestone

User authorization: add manual employee salary entry and a salary-sheet upload
alternative to editing an existing employee by ID. The UI milestone was committed
before implementation. HR now has separate Add employee, Upload salary sheet and
Salary editor workflows; HR policy text remains a separate document workflow.

Manual creation accepts currency-unit decimal amounts, converts exactly to safe
integer minor units, rejects existing employee IDs and stages a first monthly
payslip. CSV and single-worksheet XLSX uploads use the seven-column template
already supplied: employeeId, year, month, annualCtcMinor, currency,
unpaidLeaveDays, otherDeductionsMinor. The importer supports one payroll month and
10,000 employee rows per 2 MiB file. Detailed rules and examples: `IMPORT_GUIDE.md`.

The same validated, owner-bound SQLite review mechanism serves both paths. No
payroll is written before explicit confirmation. Reviews expire after 15 minutes,
are paginated at 25 rows, and have bounded retention. Confirmation revalidates
versions and saves the entire batch atomically using the existing save-month
routine and domain payslip computation. SQLite savepoints preserve single-row
transaction behavior inside a batch. Existing claims and other months' snapshots
are preserved. Confirmation replay is idempotent. New login accounts are not
created from salary records.

XLSX parsing uses read-excel-file. fflate bounds ZIP entries/expanded sizes and
canonicalizes ZIP metadata before parsing. Formula cells, external links, XML
entities, excessive worksheet ranges, invalid headers, duplicate employee IDs,
unsafe monetary integers and invalid leave/period/currency values are rejected.
Templates and previews/confirmation require HR authorization. Cookie mutations
retain exact-origin validation. Review access is restricted by account ID.

Checks: unit tests for CSV/XLSX parsing and exact decimal conversion; repository
integration tests for confirmation, ownership, expiry, stale claims, preservation,
10,000-row import and all-or-nothing rollback; real route/action tests; rendered
page tests; TypeScript and production build; isolated Chrome tests for manual
creation, Excel import, CSV update, review, confirmation and dashboard refresh.

Hydration follow-up: Node and browser ICU versions can expose different currency
lists (and formatting). Currency options and salary minor-unit help are now
created in Server Components and passed as serializable props to both client
forms. Initial client rendering does not recompute either from browser Intl.
Regression tests simulate different client metadata, and the browser workflow
reverses the browser currency list and fails on recoverable hydration errors.

## Employee directory milestone and architecture review

User direction: locate the employee list, reduce repeated login, and review an AI
assistant/import-review design, including whether LangChain, LangGraph and vector
storage are appropriate. The committed salary-import milestone precedes this work.
Only the employee directory is implemented here. `/hr/employees` is HR-only and
provides case-sensitive ID-prefix search, current-CTC currency filtering, selected
monthly snapshot pay, 25-row keyset pagination and salary-editor links. Employees
without the selected month's payslip remain visible. No profile names are invented.
Current annual CTC and historical snapshot currencies/amounts are kept distinct.

`ARCHITECTURE_REVIEW.md` records current limitations and the proposed next steps:
rotating refresh sessions, private/cited document retrieval, role-scoped read-only
chat, then advisory import analysis. Session/AI settings in that review are proposals,
not behavior added in this milestone. The current 30-minute login policy is unchanged.


## Rotating refresh-session milestone

The employee-directory milestone was committed before this work. User direction:
reduce repeated login with refresh tokens while retaining role-based data isolation
and security controls. Access JWTs now last 10 minutes; rotating opaque refresh
credentials allow an active eight-hour work session with a 30-minute inactivity
limit. Status polling does not count as activity. Login/logout/reset/disable and
signing-key changes invalidate the appropriate refresh families as documented in
`SECURITY.md`. No AI integration is added by this milestone.

Browser cookies remain HttpOnly, Secure in production, host-only and same-site.
Refresh is origin-checked; only token hashes are stored. Rotation is atomic,
consumed-token replay revokes the family, and browser tabs coordinate with Web
Locks. API clients have an explicit JSON refresh endpoint. Renewal preserves
safe return URLs, reviews and form values, with warnings and new-tab password
reauthentication for actual timeout. The 15-minute salary-review lifetime is
independent and unchanged. Legacy JWT-only sessions require signing in once.

Validation includes rotation/replay/concurrency, idle/absolute expiry, family
isolation, database migration, logout after access expiry, reset/disable/key
rotation, CSRF, safe redirects, HTTP cookie/API contracts and browser recovery.
The isolated browser test expires access sessions in its synthetic database,
restores the exact URL, renews simultaneously in two tabs and submits a salary
form without losing entered values, in addition to the existing payroll/import
and role-isolation checks. No production credentials or payroll values are logged.
