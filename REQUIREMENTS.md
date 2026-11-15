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
- How HR access and employee login authenticate
- The org pay questions
- Column names beyond the employee, the monthly payslip snapshot, leave days, and claims
