# Log in and test the employee workspace

An employee **payroll record** and an employee **login account** are separate. Importing a salary sheet or adding an employee does not create a password. There is no universal employee password, self-registration page or HR account-provisioning UI.

## 1. Choose a saved employee

Log in as HR and open **Employees** (`/hr/employees`). Copy an existing employee ID exactly, including capitalization. Pick the payroll month/year containing a saved payslip. If there are no employees, add one manually or import/confirm a salary sheet first. Do not run the synthetic seed against your real database just to create a login.

## 2. Create an account linked to that ID

In the repository terminal, use the same `.env.local` and database as the running application. The following is for your current **zsh** shell. Replace `EMP-001` with the copied employee ID and `employee.demo` with your preferred username.

```zsh
read -s "AUTH_USER_PASSWORD?Choose an employee password (at least 12 characters): "
export AUTH_USER_PASSWORD
npm run auth:user -- create employee.demo employee EMP-001
unset AUTH_USER_PASSWORD
```

The password is hidden while typing and does not appear literally in shell history. The provisioning process receives it through its environment; use a trusted local terminal and unset it afterwards. The script hashes it with scrypt; it does not save the plaintext password. It loads `.env.local` automatically. Do not change database or encryption keys to create an account.

If the username already exists, reset its password instead:

```zsh
read -s "AUTH_USER_PASSWORD?Choose the replacement password: "
export AUTH_USER_PASSWORD
npm run auth:user -- reset-password employee.demo
unset AUTH_USER_PASSWORD
```

A reset revokes existing sessions. It does not change the account's role or linked employee ID. Choose a distinct username for another employee.

## 3. Open the employee side

Keep HR logged in in your normal browser, then use an incognito/private window at `http://localhost:3000/login`. Log in with `employee.demo` and the password you just entered. On deployment, use the deployed application's `/login` URL instead.

The application sends the account to its own employee workspace. Select the saved payroll month/year; a blank month means no snapshot exists for that month, not that the login failed. Month values 1–12 internally mean January–December; the UI displays names.

Try this checklist:

1. Read gross pay, deductions, reimbursements and net pay.
2. Download the saved payslip PDF.
3. Submit a pending reimbursement with a supported receipt attachment. HR must have configured Drive and scanning for binary uploads.
4. Open **Ask Paydesk**; ask “Why was my salary deducted?” for that month. Missing deduction reasons should stay unknown. Try a PDF/image attachment and `calculate 20% of 5000`.
5. In the HR window, approve the pending claim and reload the employee view to inspect the saved recalculation. Approval changes real payroll: use an agreed test employee/period.
6. Try another employee's URL and an HR URL in the employee window; access must be denied. Changing a URL or prompt never changes the authenticated employee identity.

AI requires the configured local Ollama/models; OCR requires Tesseract/Poppler. An AI outage does not prevent ordinary payroll viewing or otherwise valid uploads. It displays unavailable review status. A chatbot attachment is not a submitted reimbursement.

## Troubleshooting and deployed accounts

- **Access denied / invalid credentials:** verify account creation succeeded, the username and employee ID, and that the command and server use the same database. Employee IDs and directory prefix searches are case-sensitive; usernames are normalized.
- **No payslip:** save/confirm a payroll month as HR, then select the same month as the employee.
- **No known password:** reset it; stored hashes cannot be decrypted.
- **Expired session:** log in again after idle/absolute expiry. Refresh tokens do not eliminate the security limits.
- **Deployed accounts:** provision a dedicated employee and HR account against the deployed database through an administrator terminal. Distribute account credentials privately, never `.env.local`, database/Drive secrets or your Google password. Local account creation does not automatically create a hosted account.
- **Account cleanup:** disable an unused test login with `npm run auth:user -- disable employee.demo`.

No account or password is created automatically by these documentation instructions.
