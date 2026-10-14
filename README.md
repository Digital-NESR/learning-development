# NESR Learning & Development Portal

Employees browse the training calendar and request sessions. Line managers approve requests. The L&D team enrolls participants, manages sessions and tracks attendance.

- **Stack:** Next.js 15 (App Router) · React 19 · Auth.js v5 · Prisma 6 · PostgreSQL
- **Sign-in:** Microsoft Entra ID single sign-on (OIDC)
- **Hosting:** Vercel

## How it fits together

| Path | What it is |
|---|---|
| `design/LD Portal.dc.html` | The Claude Design source. It is the source of truth for the UI. |
| `scripts/convert-design.mjs` | Turns the design template into `components/PortalView.jsx`, `app/hover.css` and `app/design.css` |
| `components/Portal.jsx` | Portal state and screen logic, ported from the design's script block |
| `app/actions.ts` | Server actions for every change (submit, approve, enroll, edit trainings, attendance…). Permissions are checked here. |
| `lib/data.ts` | Loads what the signed-in person is allowed to see |
| `auth.ts` | Entra ID sign-in. Syncs the person's profile and line manager from Microsoft Graph |
| `prisma/schema.prisma` | Database schema. `prisma/migrations/` holds the SQL |
| `docs/SSO-Integration-Response.md` | Answers to NESR IT's SSO integration requirements |

### Updating the UI from Claude Design

1. Replace `design/LD Portal.dc.html` with the new export.
2. Run `npm run convert-design`.
3. If the design adds new `{{ values }}`, provide them in `renderVals()` in `components/Portal.jsx`.

Don't edit `components/PortalView.jsx` by hand. It is regenerated each time.

## Who sees what

| Workspace | Who gets it |
|---|---|
| Employee | Everyone who signs in |
| Manager | People with direct reports in Entra ID, or who are the approver on a request |
| L&D Team | Users with the Entra App Role `LD.Admin` (or listed in `ADMIN_EMAILS`) |

**Approval chain:** employee → line manager (from Entra ID) → L&D team. If Entra ID has no manager for a person, they can enter an approver email on the form. To require more levels, change `APPROVAL_LEVELS` in `lib/constants.js`.

## Database

### Tables

| Table | Purpose |
|---|---|
| `employees` | People. Created and refreshed on SSO sign-in, including the `manager_id` reporting line |
| `trainings` | Training calendar sessions (soft-deleted with `is_active`) |
| `training_requests` | One per employee per session: state, justification, registration form |
| `approval_steps` | Ordered approval chain per request, with each approver's decision |
| `attendance` | Attended / no-show per session and person |
| `notification_templates` | Email templates and whether each one is active |
| `audit_log` | Who submitted, approved, enrolled or edited what, and when |

### Creating the tables

**This happens automatically on deploy.** Vercel's build runs `npm run vercel-build`, which runs `prisma migrate deploy` before building. That applies any migrations in [`prisma/migrations/`](prisma/migrations) that haven't run yet:

| Migration | What it does |
|---|---|
| `0001_init` | Creates the 7 tables, enum types, indexes and foreign keys |
| `0002_seed_data` | Loads the 4 notification templates and the 14-session starting calendar (trainings only if the table is empty) |

Each migration runs once. Prisma records applied migrations in a `_prisma_migrations` table, so later deploys skip them. If a migration fails, the deploy fails and the live site keeps running the previous version.

The database user in `DIRECT_URL` needs permission to create tables in the target schema. If the migration should run under a separate admin user, put that user in `DIRECT_URL` and a read/write-only user in `DATABASE_URL`.

**Changing the schema later:** edit `prisma/schema.prisma`, then create a new migration against a dev database with `npm run prisma -- migrate dev --name <change>`. Commit it, and the next deploy applies it.

> **Network access:** Vercel's servers run on the public internet. If the PostgreSQL server is inside the NESR network, IT must allow inbound connections from Vercel (or use Vercel Secure Compute / a static-IP egress add-on and allowlist those IPs). Use `sslmode=require`.

## Environment variables

Copy `.env.example` to `.env` for local work. On Vercel, add the same variables under **Project → Settings → Environment Variables**.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (add `sslmode=require`) |
| `DIRECT_URL` | Yes | Same as `DATABASE_URL` unless you use a connection pooler |
| `AUTH_SECRET` | Yes | Random 32+ bytes. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `AUTH_MICROSOFT_ENTRA_ID_ID` | Yes | Application (client) ID from IT |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | Yes | Client secret from IT |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | Yes | `https://login.microsoftonline.com/<TENANT_ID>/v2.0` |
| `AUTH_ADMIN_ROLE` | No | App Role value for the L&D team (default `LD.Admin`) |
| `ADMIN_EMAILS` | No | Comma-separated emails that always get L&D admin. Useful before IT creates the App Role |
| `DEMO_LOGIN` | No | `true` shows a demo login with sample people. **Testing only — remove before go-live.** |

## Single Sign-On

See [`docs/SSO-Integration-Response.md`](docs/SSO-Integration-Response.md) for the full configuration to hand to NESR IT. In short, IT creates an Entra app registration with:

- Redirect URI `https://<domain>/api/auth/callback/microsoft-entra-id` (and `http://localhost:3000/...` for development)
- Microsoft Graph `User.Read` (delegated)
- App Role `LD.Admin`

IT then sends back the tenant ID, client ID and client secret.

**Testing before SSO is ready:** set `DEMO_LOGIN=true` and run `npm run db:seed -- --demo`. The login page then shows a picker with the sample people from the design (an employee, a manager and an L&D admin).

## Local development

Requires Node.js 20+.

```bash
npm install
npm run db:migrate
npm run db:seed -- --demo
npm run dev
```

Open http://localhost:3000.

> On Windows, the npm scripts call Node directly (`node node_modules/...`) because a folder name containing `&` (like `L&D`) breaks npm's `.cmd` shims.

## Deploying to Vercel

1. Push this repo to GitHub (`digital-nesr` org).
2. In Vercel: **Add New → Project → Import** the repo. The framework preset is detected as Next.js.
3. The build command comes from `vercel.json` (`npm run vercel-build`). It runs the migrations, then builds.
4. Add the environment variables above (Production and Preview).
5. Deploy. Send the production URL to IT so they can register the redirect URI.

## Not built yet

- **Email notifications:** templates are stored and can be switched on and off, but sending is not wired up. The next step is Microsoft Graph `Mail.Send` from a shared mailbox, or SMTP.
- **Excel exports:** the "Export" buttons show a placeholder message.
- **Resources:** the four resource cards don't link to documents yet.
- **Images:** the three background photos in `public/assets/` came over truncated from Claude Design and should be replaced with the full images.
