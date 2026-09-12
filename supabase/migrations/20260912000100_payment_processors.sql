-- Per-tenant payment processor configuration.
-- Each organization can connect its own payment processor (M-Pesa Daraja,
-- Flutterwave, Paystack, Stripe). Credentials are AES-256-GCM encrypted by
-- the app (lib/payments/crypto.ts) before insert; the raw cipher column is
-- additionally hidden from the authenticated role at the SQL privilege level.

create table if not exists public.org_payment_processors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  processor text not null check (processor in ('daraja','flutterwave','paystack','stripe')),
  environment text not null default 'test' check (environment in ('test','live')),
  purpose text not null default 'both' check (purpose in ('collections','payouts','both')),
  is_active boolean not null default false,
  credentials_cipher text not null,
  credentials_hint jsonb,
  last_tested_at timestamptz,
  last_test_ok boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, processor, environment)
);
create index if not exists idx_opp_org on public.org_payment_processors(org_id);
create index if not exists idx_opp_org_active on public.org_payment_processors(org_id, is_active) where is_active;

-- updated_at maintenance
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists trg_opp_touch on public.org_payment_processors;
create trigger trg_opp_touch before update on public.org_payment_processors
  for each row execute function public.touch_updated_at();

alter table public.org_payment_processors enable row level security;

-- Org admins/owners manage their org's processors; super admins manage all.
drop policy if exists opp_admin_all on public.org_payment_processors;
create policy opp_admin_all on public.org_payment_processors for all to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()))
  with check (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()));

-- Members may see which processor is active (masked hints only, no cipher).
drop policy if exists opp_member_read on public.org_payment_processors;
create policy opp_member_read on public.org_payment_processors for select to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and is_active = true));

-- Defense in depth: the encrypted credential blob is never selectable by
-- client roles, even if a policy were misconfigured. Service role is unaffected.
revoke select (credentials_cipher) on public.org_payment_processors from authenticated;
revoke select (credentials_cipher) on public.org_payment_processors from anon;
revoke all on public.org_payment_processors from anon;
