# Add employees and upload salary sheets

Sign in with an HR account. The HR dashboard and sidebar now provide two ways to
enter payroll data. Neither writes payroll until you confirm a review.

## Add one employee manually

1. Open **Add employee** (`/hr/employees/new`).
2. Choose an unused employee ID, such as `EMP-001`.
3. Select the currency and enter annual CTC in normal currency units. For INR,
   enter `1200000` for annual CTC of ₹12,00,000. Do not enter commas or symbols.
4. Enter monthly deductions in the same currency units, select the payroll month
   by name and year, and enter whole unpaid leave days.
5. Click **Review employee salary**. Check the formatted amounts and period.
6. Tick the confirmation box and click **Confirm and save employee**.
7. Open **View updated dashboard** or **Open saved salary**.

This creates the employee record and first monthly payslip together. An existing
employee ID is rejected by the manual creation form; use **Salary editor** to edit
that employee or add another month's payslip. Employee names and other profile
fields are not part of the current payroll schema.

Manual amounts are converted from decimal strings to integer minor units without
floating-point rounding. Currency precision is respected: INR supports two decimal
places, JPY has no fractional minor units, and KWD supports three decimal places.
Annual CTC is not the monthly salary; the existing payslip calculation derives pay.

## Upload a CSV or Excel sheet

1. Open **Upload salary sheet** (`/hr/import`).
2. Download a blank CSV/Excel template, or a sample with three synthetic employees.
3. Fill in one employee per row, using one payroll month for the whole file.
4. Choose the `.csv` or `.xlsx` file and click **Validate and review sheet**.
5. Fix any row-specific validation issues and upload again. No payroll is written
   when validation fails.
6. Review the rows. Existing employee IDs are labelled **Existing employee**;
   missing IDs are labelled **New employee**. Reviews are paginated at 25 rows.
7. Confirm to save the entire sheet in one transaction, then open the dashboard.

The existing example CSV in `artifacts/employee-salary-sample.csv` works with this
importer. An Excel sample is in `artifacts/employee-salary-sample.xlsx`. The UI
sample downloads use the current month automatically. Samples are synthetic;
uploading them creates DEMO employee records in the configured database.

### Required columns

```csv
employeeId,year,month,annualCtcMinor,currency,unpaidLeaveDays,otherDeductionsMinor
EMP-001,2026,11,120000000,INR,0,0
```

- `employeeId`: 1–64 ASCII letters, numbers, hyphens or underscores; the first
  character must be a letter or number. IDs are case-sensitive.
- `year`: 1900–9999.
- `month`: 1=January, 2=February, ..., 11=November, 12=December.
- `annualCtcMinor`: annual CTC in non-negative integer currency minor units.
  For INR, ₹12,00,000 = `120000000` paise.
- `currency`: supported ISO currency code; e.g. `INR`. Lowercase is normalized.
- `unpaidLeaveDays`: a non-negative whole number, no greater than the actual days
  in the selected month. Calendar days are derived by the application.
- `otherDeductionsMinor`: monthly deductions in non-negative integer minor units.
  For INR, ₹1,500 = `150000` paise.

The manual form accepts currency units, while the sheet and existing salary editor
accept minor units. The UI explains this difference. The column headings must be
exactly those above, with no duplicates or extra columns; their order may vary.
Do not add net pay, formula results, claims, passwords or employee login columns.
A repeated employee ID within a file is an error.

## Import behavior and limits

- File size: 2 MiB; at most 10,000 employee rows. CSV must be UTF-8 (a BOM is allowed).
- Excel: one worksheet, at most seven columns and 10,001 rows including the header.
  Password-encrypted, macro-enabled, external-link, formula, oversized ZIP and
  oversized worksheet-range files are rejected. Paste formula values first.
- Legacy `.xls`, PDF and policy documents are not salary-sheet formats.
- Existing records are updated only for the selected month. Other monthly
  snapshots are retained. Employee-level current CTC/currency follow the existing
  salary-save behavior.
- Existing pending and approved claims, amounts and receipts are preserved.
  Currency cannot change for a month containing claims. Reimbursements never
  come from a sheet and only approved claims affect pay.
- Reviews are stored privately in SQLite for 15 minutes and belong to the HR
  account that prepared them. Payroll data is not passed in hidden client inputs.
- Up to three recent reviews are retained per account, with a global cap of 50.
  Preparing more reviews retires older reviews. Expired reviews are cleaned when
  a new one is prepared.
- Any changed payroll or claims after preview invalidates the review. Upload or
  enter the details again to review the latest state.
- Confirmation is all-or-nothing. A stale row, validation failure or database
  failure rolls back all payroll writes in that batch. Successful confirmation is
  idempotent: repeating it cannot apply the salary changes twice.
- Reviews display the proposed annual CTC, period, leave days and deductions.
  Calculated monthly amounts are read from saved payslips after confirmation.
- File contents are parsed in memory; only normalized review data is temporarily
  stored. Files are not copied into a public directory. Do not log payroll values.

An employee payroll record does **not** create a login account. Account provisioning
remains a trusted administrator operation documented in `SECURITY.md`.
