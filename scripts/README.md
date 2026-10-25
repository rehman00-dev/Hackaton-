# HCM Lite

AI-assisted human capital management for Admin, HR, and employees. This project uses React + Vite, Express, and Supabase PostgreSQL. Employee, HR, attendance, leave, payroll, and audit data are stored in the configured Supabase database.

## Requirements

- Node.js 20 or newer
- npm
- A modern browser
- A Supabase project
- Optional: a Groq API key for the AI assistant

## Supabase setup and local run

1. In Supabase, open **Project Settings > Database** and copy the PostgreSQL connection string. Use the session pooler connection string if the hosting provider cannot reach Supabase's direct database host.
2. Copy `.env.example` to `.env`. Set `DATABASE_URL` to that connection string and set a unique `JWT_SECRET` (at least 32 characters). Keep the database URL server-side; never use a `NEXT_PUBLIC_` or `VITE_` prefix for it.
3. The backend creates the required tables and indexes in Supabase at startup. Row Level Security is enabled on those tables; the Express backend uses the private server connection and enforces the app's JWT/role checks.
4. If you want to preserve the Admin account from this computer's old SQLite database, run `npm run db:migrate-admin` once after setting `DATABASE_URL`. It copies only that Admin login and the company settings. It does not copy the old HR account, employees, or other records, and it does not delete or modify the local database. The migration stops if Supabase already has an Admin account.
5. Install packages with `npm install`, then run `npm run dev`.
6. Open `http://localhost:5173`. If you did not migrate an Admin account, complete first-run setup to create one.

The API runs at `http://localhost:5000`. `npm run build` creates the production frontend in `dist`; run `npm start` with `NODE_ENV=production` to serve it from Express. In production, set `DATABASE_URL`, a strong `JWT_SECRET`, and `CLIENT_ORIGIN` to the frontend's exact origin (comma-separated if you use more than one).

This app uses its Express backend for login and database access. Supabase `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` values are not used by this frontend login flow. Do not put a PostgreSQL password, service-role key, or full `DATABASE_URL` in a frontend environment variable or share it in chat.

To create the first Admin from environment variables instead of the setup screen, set both `ADMIN_EMAIL` and `ADMIN_PASSWORD` before starting the server. This only applies to a fresh database.

If you forget an existing Admin password, run `npm run admin:reset-password` from an interactive terminal in the project folder. Select the Admin email and enter a new password of at least 12 characters; password input is masked and stored only as a bcrypt hash. Do not pass passwords as command-line arguments or share them in chat.

## AI provider and backend connection

The browser sends a signed-in request to `POST /api/ai/chat`. The Express server calls Groq's OpenAI-compatible chat-completions API using:

- `GROQ_API_KEY` — Groq API key kept only on the server; create one at [Groq Console](https://console.groq.com/keys)
- `AI_BASE_URL=https://api.groq.com/openai/v1`
- `AI_MODEL=openai/gpt-oss-20b`

The assistant uses Groq function calling for scoped backend tools covering headcount, daily attendance, leave, finalized payroll, and the signed-in employee's own records. The model never receives database credentials and never queries Supabase directly. If the key is unset, the API returns a clear configuration message; provider authentication, model, quota, and connection failures also return actionable errors. Restart the backend after changing `.env` so it reloads the configuration.

Never put an API key in React code, commit `.env`, or share a key in chat. If a key has been pasted into a chat or public location, revoke it with the provider and create a replacement.

If chat reports that Groq rejected the key, create a Groq API key in the Groq Console, set `GROQ_API_KEY` in the local `.env`, and restart `npm run dev`. Do not paste the key into chat or source files.

## Implemented workflows

- First-run company and Admin setup; login, JWT sessions, forced change of temporary passwords, and role-specific navigation.
- Admin company settings, leave types, HR account creation, payroll finalization, announcements, and audit log.
- HR employee registration, department management, employee directory search, CSV dry-run/import/export, daily attendance view, correction decisions, leave decisions, payroll drafts, and announcements.
- Employee attendance check-in/out, leave applications and balance history, corrections, profile editing, notifications, and payslips.
- Payroll drafts with attendance deductions and an illustrative salary/tax calculation; Admin finalization locks the run. Employees can print a finalized payslip and save it to PDF from the browser's print dialog. This calculation is a demo, not a jurisdiction-specific payroll implementation.
- AI chat through scoped backend tools and an AI-generated smart-leave draft that the employee reviews before submitting.
- Optional webcam face-presence detection and office-radius location check-in.

## Face detection and location privacy

The optional attendance camera uses MediaPipe Face Detector in the browser. It detects whether a face is visible; it does **not** identify an employee, compare identity, or store face images/templates. Camera processing stays on the device. The MediaPipe WebAssembly files and model are downloaded from their public hosting URLs the first time the feature is used.

Location is requested only during check-in. If an Admin configures both office coordinates, the backend checks the browser-provided coordinates against the configured radius. Browser location can be spoofed, and browser face detection is not identity verification; use this as a hackathon demo feature, not as a security boundary or payroll proof.

## Key routes

| Area | Route examples |
| --- | --- |
| Setup and login | `GET /api/auth/setup/status`, `POST /api/auth/setup`, `POST /api/auth/login`, `GET /api/auth/me` |
| Admin | `GET/PUT /api/admin/company`, `POST /api/admin/hr-users`, `POST /api/admin/payroll/:month/finalize` |
| HR | `GET/POST /api/hr/employees`, `GET/POST /api/hr/departments`, `POST /api/hr/payroll/run`, `POST /api/hr/leave/:id/review` |
| Employee | `POST /api/employee/checkin`, `POST /api/employee/checkout`, `POST /api/employee/leave`, `GET /api/employee/payroll` |
| Shared | `GET /api/dashboard/summary`, `POST /api/ai/chat` |

## Current limits

- PDF generation as a server-created file and email/push notification delivery are not implemented yet. Payslips use the browser's print-to-PDF flow; in-app notifications are supported. Employee directory search supports department and designation filters.
- Payroll needs your jurisdiction/currency, tax and contribution rules, salary structure, and approved attendance/leave deduction policy before it can be treated as real payroll.
- Face detection is only a local presence check; biometric identity matching is intentionally not performed.
- The backend requires a reachable Supabase PostgreSQL database. Use HTTPS, secure secret management, backups, request rate limiting, and a security review before handling real employee data.

## Useful commands

```text
npm run dev
npm run build
npm start
```
