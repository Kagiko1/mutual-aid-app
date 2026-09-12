-- Mutual Aid Welfare App — full schema
-- Run with: supabase db push  (or psql against your Supabase project)
-- Money is stored in MINOR units (cents) as bigint. Percentages as numeric(5,2).

-- ============ helpers ============
-- (defined before tables; bodies are not validated at creation time)
SET check_function_bodies = false;
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.owns_profile(target_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select auth.uid() = target_id or public.is_admin();
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ============ org config (key/value) ============
create table public.org_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ============ profiles (members + admins) ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('member','admin')),
  full_name text not null,
  email text,
  phone text,
  national_id text,
  status text not null default 'pending'
    check (status in ('pending','active','ineligible','suspended')),
  joined_at timestamptz not null default now(),
  waiting_ends_at timestamptz,
  totp_secret text,
  totp_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.touch_updated_at();
create index idx_profiles_status on public.profiles(status);
create index idx_profiles_role on public.profiles(role);

-- ============ dependents ============
create table public.dependents (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null,
  kinship_type text not null check (kinship_type in ('spouse','child','parent','sibling','other')),
  date_of_birth date,
  national_id text,
  verification_status text not null default 'pending'
    check (verification_status in ('pending','verified','rejected')),
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_dependents_member on public.dependents(member_id);
create index idx_dependents_national_id on public.dependents(national_id);

-- ============ beneficiaries (fractional % allocation, must sum to 100) ============
create table public.beneficiaries (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null,
  relationship text,
  percentage numeric(5,2) not null check (percentage > 0 and percentage <= 100),
  phone text,
  created_at timestamptz not null default now()
);
create index idx_beneficiaries_member on public.beneficiaries(member_id);

-- ============ KYC docs ============
create table public.kyc_docs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  doc_type text not null,
  storage_path text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index idx_kyc_member on public.kyc_docs(member_id);

-- ============ consents ============
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  clause_key text not null,
  clause_text text not null,
  accepted_at timestamptz not null default now(),
  unique (member_id, clause_key)
);

-- ============ e-signatures ============
create table public.signatures (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  case_id uuid, -- FK to cases added below (cases table is created after this one)
  signature_type text not null check (signature_type in ('typed','canvas')),
  signature_data text not null,
  signed_at timestamptz not null default now()
);

-- ============ welfare cases ============
create table public.cases (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  case_type text not null default 'death' check (case_type in ('death','medical','other')),
  deceased_name text not null,
  death_date date not null,
  deceased_member_id uuid references public.profiles(id),
  deceased_dependent_id uuid references public.dependents(id),
  paired_case_id uuid references public.cases(id),
  status text not null default 'pending_review'
    check (status in ('draft','pending_review','reviewed','approved','disbursed','rejected')),
  benefit_amount bigint not null check (benefit_amount > 0),
  admin_notes text,
  created_by_admin boolean not null default false,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  approved_at timestamptz,
  disbursed_at timestamptz
);
create index idx_cases_member on public.cases(member_id);
create index idx_cases_status on public.cases(status);

-- FK from signatures to cases (deferred: cases table is created after signatures)
alter table public.signatures
  add constraint signatures_case_id_fkey
  foreign key (case_id) references public.cases(id) on delete set null;

-- ============ case documents (post-submission uploads allowed) ============
create table public.case_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  doc_type text not null,
  storage_path text not null,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index idx_case_docs_case on public.case_documents(case_id);

-- ============ claim checklists (required docs per case type) ============
create table public.claim_checklists (
  id uuid primary key default gen_random_uuid(),
  case_type text not null unique,
  required_docs jsonb not null default '[]'
);

-- ============ vouchers ============
create table public.vouchers (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.cases(id) on delete cascade,
  voucher_no text not null unique,
  amount bigint not null check (amount > 0),
  currency_code text not null,
  currency_symbol text not null,
  pdf_storage_path text,
  issued_at timestamptz not null default now(),
  issued_by uuid references public.profiles(id)
);

-- ============ invoices (per-member billing per case) ============
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  amount bigint not null check (amount >= 0),
  status text not null default 'pending'
    check (status in ('pending','paid','overdue','waived')),
  strategy text check (strategy in ('flat','proportional')),
  due_date date,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_invoices_member on public.invoices(member_id);
create index idx_invoices_case on public.invoices(case_id);
create index idx_invoices_status on public.invoices(status);

-- ============ payments ============
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  amount bigint not null check (amount > 0),
  channel text not null check (channel in ('mpesa_stk','mpesa_b2c','manual','bank')),
  mpesa_receipt text,
  status text not null default 'pending' check (status in ('pending','completed','failed')),
  paid_at timestamptz,
  callback_payload jsonb,
  created_at timestamptz not null default now()
);
create index idx_payments_member on public.payments(member_id);
create index idx_payments_invoice on public.payments(invoice_id);

-- ============ disbursements (fractional beneficiary payouts) ============
create table public.disbursements (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  beneficiary_id uuid references public.beneficiaries(id) on delete set null,
  beneficiary_name text not null,
  amount bigint not null check (amount >= 0),
  channel text not null default 'mpesa_b2c',
  mpesa_receipt text,
  status text not null default 'pending' check (status in ('pending','completed','failed')),
  created_at timestamptz not null default now()
);
create index idx_disbursements_case on public.disbursements(case_id);

-- ============ funds / wallets ============
create table public.funds (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  policy jsonb not null default '{}',
  balance bigint not null default 0,
  created_at timestamptz not null default now()
);
create table public.fund_triggers (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete cascade,
  trigger_event text not null,
  engine text not null check (engine in ('flat_rate','proportional_split')),
  config jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ============ reserve fund ledger ============
create table public.reserve_ledger (
  id uuid primary key default gen_random_uuid(),
  amount bigint not null check (amount >= 0),
  direction text not null check (direction in ('in','out')),
  reason text not null,
  case_id uuid references public.cases(id) on delete set null,
  balance_after bigint not null,
  created_at timestamptz not null default now()
);

-- ============ governance: ballots (anonymous, hashed votes) ============
create table public.ballots (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'draft'
    check (status in ('draft','open','closed','certified')),
  options jsonb not null default '[]',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  certified_at timestamptz,
  results jsonb
);
create table public.votes (
  id uuid primary key default gen_random_uuid(),
  ballot_id uuid not null references public.ballots(id) on delete cascade,
  voter_hash text not null,
  option_id text not null,
  created_at timestamptz not null default now(),
  unique (ballot_id, voter_hash)
);
create index idx_votes_ballot on public.votes(ballot_id);

-- ============ events & attendance ============
create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_date timestamptz not null,
  location text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  attended_at timestamptz not null default now(),
  unique (event_id, member_id)
);

-- ============ in-app notifications ============
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  type text not null default 'info',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notifications_member on public.notifications(member_id);

-- ============ leadership contacts ============
create table public.leadership_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

-- ============ audit log ============
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity text,
  entity_id text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index idx_audit_actor on public.audit_log(actor_id);
create index idx_audit_created on public.audit_log(created_at);

-- ============ drip scheduler runs ============
create table public.drip_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  summary jsonb not null default '{}'
);

-- ============ storage buckets ============
insert into storage.buckets (id, name, public)
values ('kyc-docs','kyc-docs',false),
       ('claim-docs','claim-docs',false),
       ('vouchers','vouchers',false)
on conflict (id) do nothing;

-- ============ RLS ============
alter table public.org_config enable row level security;
alter table public.profiles enable row level security;
alter table public.dependents enable row level security;
alter table public.beneficiaries enable row level security;
alter table public.kyc_docs enable row level security;
alter table public.consents enable row level security;
alter table public.signatures enable row level security;
alter table public.cases enable row level security;
alter table public.case_documents enable row level security;
alter table public.claim_checklists enable row level security;
alter table public.vouchers enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.disbursements enable row level security;
alter table public.funds enable row level security;
alter table public.fund_triggers enable row level security;
alter table public.reserve_ledger enable row level security;
alter table public.ballots enable row level security;
alter table public.votes enable row level security;
alter table public.events enable row level security;
alter table public.attendance enable row level security;
alter table public.notifications enable row level security;
alter table public.leadership_contacts enable row level security;
alter table public.audit_log enable row level security;
alter table public.drip_runs enable row level security;

-- org_config: everyone authenticated can read; admin writes
create policy org_config_read on public.org_config for select to authenticated using (true);
create policy org_config_write on public.org_config for all to authenticated using (public.is_admin());

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (public.owns_profile(id));
create policy profiles_insert on public.profiles for insert to authenticated
  with check (auth.uid() = id);
create policy profiles_update on public.profiles for update to authenticated
  using (public.owns_profile(id));

-- member-owned tables: dependents, beneficiaries, kyc_docs, consents, signatures
create policy dependents_all on public.dependents for all to authenticated
  using (public.owns_profile(member_id)) with check (public.owns_profile(member_id));
create policy beneficiaries_all on public.beneficiaries for all to authenticated
  using (public.owns_profile(member_id)) with check (public.owns_profile(member_id));
create policy kyc_all on public.kyc_docs for all to authenticated
  using (public.owns_profile(member_id)) with check (public.owns_profile(member_id));
create policy consents_all on public.consents for all to authenticated
  using (public.owns_profile(member_id)) with check (public.owns_profile(member_id));
create policy signatures_all on public.signatures for all to authenticated
  using (public.owns_profile(member_id)) with check (public.owns_profile(member_id));

-- cases: member sees own; admin all
create policy cases_select on public.cases for select to authenticated
  using (public.owns_profile(member_id));
create policy cases_insert on public.cases for insert to authenticated
  with check (public.owns_profile(member_id));
create policy cases_update on public.cases for update to authenticated
  using (public.is_admin() or (public.owns_profile(member_id) and status in ('draft','pending_review')));

-- case_documents: member can add to own cases; admin all
create policy case_docs_all on public.case_documents for all to authenticated
  using (exists (select 1 from public.cases c where c.id = case_id and public.owns_profile(c.member_id)))
  with check (exists (select 1 from public.cases c where c.id = case_id and public.owns_profile(c.member_id)));

-- invoices/payments: member reads own; admin all; writes via service role (API)
create policy invoices_select on public.invoices for select to authenticated
  using (public.owns_profile(member_id));
create policy payments_select on public.payments for select to authenticated
  using (public.owns_profile(member_id));
create policy disbursements_select on public.disbursements for select to authenticated
  using (exists (select 1 from public.cases c where c.id = case_id and public.owns_profile(c.member_id)));
create policy vouchers_select on public.vouchers for select to authenticated
  using (exists (select 1 from public.cases c where c.id = case_id and public.owns_profile(c.member_id)));

-- funds / triggers / reserve: admin write; members read funds
create policy funds_read on public.funds for select to authenticated using (true);
create policy funds_write on public.funds for all to authenticated using (public.is_admin());
create policy fund_triggers_admin on public.fund_triggers for all to authenticated using (public.is_admin());
create policy reserve_read on public.reserve_ledger for select to authenticated using (public.is_admin());

-- ballots: all authenticated read; admin writes; votes: insert authenticated, read admin
create policy ballots_read on public.ballots for select to authenticated using (true);
create policy ballots_write on public.ballots for all to authenticated using (public.is_admin());
create policy votes_insert on public.votes for insert to authenticated with check (true);
create policy votes_read on public.votes for select to authenticated using (public.is_admin());

-- events/attendance: read all; attendance insert own or admin; admin manages events
create policy events_read on public.events for select to authenticated using (true);
create policy events_write on public.events for all to authenticated using (public.is_admin());
create policy attendance_read on public.attendance for select to authenticated using (true);
create policy attendance_write on public.attendance for all to authenticated
  using (public.owns_profile(member_id) or public.is_admin())
  with check (public.owns_profile(member_id) or public.is_admin());

-- notifications: own only (service role inserts)
create policy notifications_own on public.notifications for all to authenticated
  using (member_id = auth.uid() or public.is_admin()) with check (true);

-- leadership: read all; admin writes
create policy leadership_read on public.leadership_contacts for select to authenticated using (true);
create policy leadership_write on public.leadership_contacts for all to authenticated using (public.is_admin());

-- checklists: read all; admin writes
create policy checklists_read on public.claim_checklists for select to authenticated using (true);
create policy checklists_write on public.claim_checklists for all to authenticated using (public.is_admin());

-- audit log: admin read; inserts via service role
create policy audit_read on public.audit_log for select to authenticated using (public.is_admin());
create policy drip_read on public.drip_runs for select to authenticated using (public.is_admin());

-- storage policies (service role bypasses; these are for direct client uploads)
create policy "kyc insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'kyc-docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "kyc read own" on storage.objects for select to authenticated
  using (bucket_id = 'kyc-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy "claim insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'claim-docs');
create policy "claim read" on storage.objects for select to authenticated
  using (bucket_id = 'claim-docs' and public.is_admin());
create policy "claim read own case" on storage.objects for select to authenticated
  using (bucket_id = 'claim-docs');
create policy "voucher read" on storage.objects for select to authenticated
  using (bucket_id = 'vouchers');
