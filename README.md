# Umoja Welfare — Mutual Aid App

A **multi-tenant SaaS** mutual aid welfare platform: organizations sign up,
invite members, and run their own welfare program — onboarding with KYC,
welfare case lifecycle (review → approve → voucher → fractional disbursement),
per-case contribution invoicing with M-Pesa STK collections and an automated
T+4 / T+6 / T+7 collection drip, anonymous governance ballots, events, fund
wallets, audit logging, and CSV/PDF reports. **Multi-currency** throughout
(KES, UGX, TZS, RWF, NGN, GHS, ZMW, ZAR, USD, EUR, GBP), one currency per
organization.

**Stack:** Next.js 14 (App Router) + TypeScript + Tailwind CSS · Supabase
(Postgres + Auth + Storage) · M-Pesa Daraja API · pdfkit · otplib (TOTP) ·
Vitest.

## SaaS model

- **Organizations** (`/start`): "Create an organization" (name + currency +
  owner account) or "Join with invite code" (members). Each org gets isolated
  data (org-scoped RLS), its own config, invite code, and Starter-plan trial.
- **Plans & billing** (`/admin/billing`): Starter (free, 50 members), Growth
  ($12/mo, 500 members), Enterprise ($49/mo, unlimited). Plan assignment is
  currently done by the SaaS operator; Stripe checkout is the planned
  follow-up.
- **Super-admin dashboard** (`/admin/super`, SaaS operator only): org KPIs,
  MRR in USD (converted via editable FX rates), plan changes,
  suspend/activate, FX rate management. Grant via SQL:
  `update profiles set is_super_admin = true where email = 'you@example.org';`
- **Currencies:** set per org at signup (`currency_code` in `organizations`
  and `org_config`); every monetary row snapshots its `currency_code`.
  M-Pesa STK/B2C is KES-only (Daraja) — non-KES orgs use manual payments
  (stub mode allows all currencies for testing).

## Features

**Member portal** (`/member`)
- 6-step onboarding wizard: profile → dependents → beneficiaries (fractional %
  allocation, must sum to 100) → KYC document upload → consent clauses →
  e-signature (typed or canvas)
- Raise a welfare case (death date, deceased name, claim documents); waiting
  period (default 180 days, configurable) enforced
- Post-submission document upload on pending/reviewed cases
- "Pay my invoice" via M-Pesa STK push + full payment history
- In-app notification center with bell badge, ballots (anonymous voting),
  events with RSVP, read-only leadership contacts

**Admin console** (`/admin`, TOTP-gated sensitive actions)
- Case review queue: request corrections / mark reviewed / approve with
  e-signature (auto-generates voucher + per-member invoices) / disburse
  (fractional beneficiary split via shared engine + B2C payouts)
- Double-payout detection (deceased is both member and dependent → paired
  cases), claim checklists with missing-doc highlighting
- Member management + dependent verification workflow, onboard-on-behalf
- Welfare ledger (invoices + payments, status/channel filters), fund wallets
  + triggers, reserve-fund dashboard card (reserve balance, total disbursed,
  collection rate, outstanding)
- Ballots (create → open → vote → close → certify with TOTP; results hidden
  until certified), events + attendance + member notifications, org config
  editor (currency code/symbol live-refresh, benefit/penalty/fees, waiting
  period, invoicing strategy), claim checklists, leadership CRUD
- Reports (CSV/PDF export: members, cases, invoices, payments, dependents,
  attendance), full audit log

**Automation**
- `GET /api/cron/drip` (Vercel Cron, daily 6am Africa/Nairobi): T+4 reminder
  → T+6 final notice → T+7 penalty invoice + member marked ineligible.
  Duplicate-safe via audit-log guards. Payment after ineligibility
  **auto-reactivates** the member on reconciliation.
- M-Pesa callbacks reconcile STK payments and B2C payouts; SMS via
  Africa's Talking (stubbed by default).

## Getting started (local)

```bash
cd mutual-aid-app
cp .env.example .env        # fill in Supabase keys (see below)
npm install
npm test                    # 84 unit tests (Vitest)
npm run dev                 # http://localhost:3000
```

## Supabase setup

1. Create a project at https://supabase.com (sign in with GitHub).
2. In **Project Settings → API**, copy the project URL, `anon` key and
   `service_role` key into `.env`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Apply the schema (Supabase CLI or SQL editor):
   ```bash
   supabase db push        # applies supabase/migrations/20260911000000_schema.sql
   # or paste the migration file into the SQL editor and run it
   ```
   This creates all 25 tables, RLS policies (member vs admin), the
   `is_admin()` / `owns_profile()` helpers, and the private storage buckets
   `kyc-docs`, `claim-docs`, `vouchers`.
4. Run `supabase/seed.sql` in the SQL editor for org config (KES/KSh,
   180-day waiting period, benefit/penalty/fee defaults), fund wallets,
   claim checklists, leadership contacts and demo rows.
5. Create the demo users in **Authentication → Users** (or via app sign-up);
   the seed's demo profile UUIDs (`1111…` admin, `2222…`/`3333…` members)
   must match real `auth.users` ids — update `profiles` rows accordingly,
   or sign up fresh members through `/login` and promote one to admin:
   ```sql
   update public.profiles set role='admin' where email='you@example.com';
   ```

Money is stored in **minor units** (integer cents) everywhere; display uses
`formatMoney()` with the org's currency code/symbol from `org_config`.

## Deploying to Vercel

1. Push this repo to GitHub.
2. In Vercel, **Add New → Project → Import** the repo.
3. Add **all** variables from `.env.example` as Environment Variables
   (Production + Preview). Required at minimum: the three Supabase keys,
   `CRON_SECRET` (long random string), `BALLOT_SALT` (long random string,
   set once — changing it invalidates vote-hash uniqueness).
4. Deploy. The cron in `vercel.json` runs `/api/cron/drip` at 3am UTC
   (6am Africa/Nairobi) with `?secret=<CRON_SECRET>` already in the path
   (the endpoint also accepts `Authorization: Bearer <CRON_SECRET>`).
   To rotate the secret, change it in both the `CRON_SECRET` env var and
   the `vercel.json` cron path, then redeploy.
5. Point M-Pesa callback URLs at your production domain (see `.env.example`).

## M-Pesa & SMS

- `MPESA_MODE=stub` (default): no network calls; STK/B2C return fake ids and
  log to console + audit log. B2C completes immediately in stub mode.
- `MPESA_MODE=sandbox`: real Daraja sandbox calls — fill `MPESA_CONSUMER_KEY`,
  `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`. Get sandbox
  credentials at https://developer.safaricom.co.ke.
- `MPESA_MODE=live`: additionally set `MPESA_INITIATOR_NAME` and
  `MPESA_SECURITY_CREDENTIAL` (encrypted initiator password from Daraja).
- `SMS_PROVIDER=stub` (default, logs only) or `africastalking` with
  `AFRICASTALKING_API_KEY` / `AFRICASTALKING_USERNAME` /
  `AFRICASTALKING_SENDER_ID` (https://africastalking.com).

## Admin MFA (TOTP)

Admins enable TOTP at **Admin → Config → TOTP setup** (open the otpauth URL
with any authenticator app, then verify). These mutations require the
`x-totp-code` header: case approval, disbursement, manual payment recording,
ballot certification. Unconfigured admins get a `428 totp_required` response.

## Scripts

| Command        | What it does                              |
|----------------|-------------------------------------------|
| `npm test`     | Vitest unit tests (engines + money)       |
| `npm run build`| Production Next.js build                  |
| `npm run dev`  | Local dev server                          |
| `npm run lint` | ESLint                                    |

## Project structure

```
app/
  member/            member portal pages (onboarding wizard, cases, invoices…)
  admin/             admin console pages (cases, members, ledger, funds…)
  api/               route handlers (mpesa, cron/drip, cases, vouchers, ballots…)
  login/             Supabase email/password auth
components/member|admin   UI components (incl. TotpField, CaseActions)
lib/
  engines/           pure unit-tested engines: beneficiarySplit, doublePayout,
                     drip, invoicing, waitingPeriod, ballot
  mpesa.ts sms.ts totp.ts audit.ts notify.ts org.ts guard.ts
  supabase/          browser + server (RLS) + service-role clients
supabase/migrations/ full schema + RLS + buckets
supabase/seed.sql     org config, funds, checklists, leadership, demo rows
tests/               84 Vitest tests
vercel.json          daily 6am (Nairobi) drip cron
```

## Known limitations / follow-ups

- In stub M-Pesa mode, STK payments stay `pending` (Daraja never calls back);
  use sandbox or the admin manual-payment route to complete them.
- Member "raise case" files under the reporter's own membership; for a
  deceased member reported by family, use admin **create case on behalf**
  (a "report a member's death" selector on the member form is a future
  enhancement).
- Email notifications are console-stubbed (`lib/notify.ts`); plug in Resend /
  SES for production email.
- Ballot results render from `ballots.results` jsonb (object or array shape).
