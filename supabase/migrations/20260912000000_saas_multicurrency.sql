-- Mutual Aid Welfare App — SaaS multi-tenancy + multi-currency
-- Run after 20260911000000_schema.sql (and its data fixups).
-- Adds: organizations, plans, subscriptions, fx_rates; org_id on all 25 tables;
-- currency_code on monetary tables; org-scoped RLS.

-- ============ SaaS tables ============
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  currency_code text not null default 'KES',
  invite_code text not null unique default substr(md5(random()::text), 1, 8),
  plan_id uuid,
  status text not null default 'active'
    check (status in ('trial','active','suspended')),
  created_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  price_minor bigint not null default 0,
  currency_code text not null default 'USD',
  interval text not null default 'monthly' check (interval in ('monthly','annual')),
  max_members integer,
  features jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  status text not null default 'trial'
    check (status in ('trial','active','past_due','canceled')),
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

-- FX rates: 1 unit of base_currency = rate units of quote_currency.
create table public.fx_rates (
  base_currency text not null,
  quote_currency text not null,
  rate numeric(18,6) not null check (rate > 0),
  updated_at timestamptz not null default now(),
  primary key (base_currency, quote_currency)
);

alter table public.organizations enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.fx_rates enable row level security;

insert into public.plans (name, price_minor, currency_code, interval, max_members, features) values
  ('Starter', 0, 'USD', 'monthly', 50,
   '["member_onboarding","cases","invoicing","ballots","events"]'::jsonb),
  ('Growth', 1200, 'USD', 'monthly', 500,
   '["member_onboarding","cases","invoicing","ballots","events","funds","reports","sms"]'::jsonb),
  ('Enterprise', 4900, 'USD', 'monthly', null,
   '["member_onboarding","cases","invoicing","ballots","events","funds","reports","sms","api","priority_support"]'::jsonb)
on conflict (name) do nothing;

-- Approximate FX anchors (1 USD = rate quote). Editable in super-admin dashboard.
insert into public.fx_rates (base_currency, quote_currency, rate) values
  ('USD','USD',1), ('USD','KES',129), ('USD','UGX',3720), ('USD','TZS',2680),
  ('USD','RWF',1400), ('USD','NGN',1550), ('USD','GHS',15.5), ('USD','ZMW',27),
  ('USD','ZAR',18.5), ('USD','EUR',0.92), ('USD','GBP',0.79)
on conflict (base_currency, quote_currency) do nothing;

-- ============ tenant key on every table ============
alter table public.profiles
  add column org_id uuid references public.organizations(id) on delete cascade,
  add column is_super_admin boolean not null default false;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('member','admin','owner'));

alter table public.org_config
  add column org_id uuid references public.organizations(id) on delete cascade;

-- monetary tables get a currency snapshot too
alter table public.cases         add column currency_code text not null default 'KES';
alter table public.invoices      add column currency_code text not null default 'KES';
alter table public.payments      add column currency_code text not null default 'KES';
alter table public.disbursements add column currency_code text not null default 'KES';
alter table public.funds         add column currency_code text not null default 'KES';
alter table public.reserve_ledger add column currency_code text not null default 'KES';

alter table public.dependents      add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.beneficiaries   add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.kyc_docs        add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.consents        add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.signatures      add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.cases           add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.case_documents  add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.claim_checklists add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.vouchers        add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.invoices        add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.payments        add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.disbursements   add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.funds           add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.fund_triggers   add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.reserve_ledger  add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.ballots         add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.votes           add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.events          add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.attendance      add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.notifications   add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.leadership_contacts add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.audit_log       add column org_id uuid references public.organizations(id) on delete cascade;
alter table public.drip_runs       add column org_id uuid references public.organizations(id) on delete cascade;

-- ============ backfill: single default org owns all existing rows ============
insert into public.organizations (name, slug, currency_code, invite_code, plan_id, status)
select 'Umoja Welfare Association', 'umoja', 'KES',
       'UMOJA-' || substr(md5(random()::text), 1, 4),
       (select id from public.plans where name = 'Starter'),
       'active'
where not exists (select 1 from public.organizations where slug = 'umoja');

insert into public.subscriptions (org_id, plan_id, status)
select o.id, (select id from public.plans where name = 'Starter'), 'active'
from public.organizations o where o.slug = 'umoja'
on conflict (org_id) do nothing;

do $$
declare
  org uuid := (select id from public.organizations where slug = 'umoja');
  t text;
begin
  foreach t in array array[
    'org_config','profiles','dependents','beneficiaries','kyc_docs','consents',
    'signatures','cases','case_documents','claim_checklists','vouchers','invoices',
    'payments','disbursements','funds','fund_triggers','reserve_ledger','ballots',
    'votes','events','attendance','notifications','leadership_contacts','audit_log','drip_runs'
  ] loop
    execute format('update public.%I set org_id = $1 where org_id is null', t) using org;
    execute format('alter table public.%I alter column org_id set not null', t);
    execute format('create index if not exists idx_%I_org on public.%I(org_id)', t, t);
  end loop;
end $$;

-- org_config is now keyed per org
alter table public.org_config drop constraint if exists org_config_pkey;
alter table public.org_config add primary key (org_id, key);

-- ============ RLS helpers (org-aware) ============
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','owner'));
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_super_admin = true);
$$;

create or replace function public.my_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where id = auth.uid();
$$;

-- Guard rails on profiles: org_id immutable, super flag immutable,
-- role changes only by org admin/owner of the same org or super admin.
create or replace function public.validate_profile_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor_role text; actor_org uuid; actor_super boolean;
begin
  if auth.uid() is null then return new; end if; -- service role (signup API, admin tools)
  select role, org_id, is_super_admin into actor_role, actor_org, actor_super
  from public.profiles where id = auth.uid();
  if TG_OP = 'UPDATE' then
    if new.org_id is distinct from old.org_id and not coalesce(actor_super, false) then
      raise exception 'organization cannot be changed';
    end if;
    if new.is_super_admin is distinct from old.is_super_admin and not coalesce(actor_super, false) then
      raise exception 'super admin flag cannot be changed';
    end if;
    if new.role is distinct from old.role
       and not (coalesce(actor_super, false)
                or (coalesce(actor_role,'') in ('admin','owner') and actor_org = old.org_id)) then
      raise exception 'role change not permitted';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard before insert or update on public.profiles
  for each row execute function public.validate_profile_change();

-- ============ drop old policies ============
drop policy if exists org_config_read on public.org_config;
drop policy if exists org_config_write on public.org_config;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists dependents_all on public.dependents;
drop policy if exists beneficiaries_all on public.beneficiaries;
drop policy if exists kyc_all on public.kyc_docs;
drop policy if exists consents_all on public.consents;
drop policy if exists signatures_all on public.signatures;
drop policy if exists cases_select on public.cases;
drop policy if exists cases_insert on public.cases;
drop policy if exists cases_update on public.cases;
drop policy if exists case_docs_all on public.case_documents;
drop policy if exists invoices_select on public.invoices;
drop policy if exists payments_select on public.payments;
drop policy if exists disbursements_select on public.disbursements;
drop policy if exists vouchers_select on public.vouchers;
drop policy if exists funds_read on public.funds;
drop policy if exists funds_write on public.funds;
drop policy if exists fund_triggers_admin on public.fund_triggers;
drop policy if exists reserve_read on public.reserve_ledger;
drop policy if exists ballots_read on public.ballots;
drop policy if exists ballots_write on public.ballots;
drop policy if exists votes_insert on public.votes;
drop policy if exists votes_read on public.votes;
drop policy if exists events_read on public.events;
drop policy if exists events_write on public.events;
drop policy if exists attendance_read on public.attendance;
drop policy if exists attendance_write on public.attendance;
drop policy if exists notifications_own on public.notifications;
drop policy if exists leadership_read on public.leadership_contacts;
drop policy if exists leadership_write on public.leadership_contacts;
drop policy if exists checklists_read on public.claim_checklists;
drop policy if exists checklists_write on public.claim_checklists;
drop policy if exists audit_read on public.audit_log;
drop policy if exists drip_read on public.drip_runs;

-- ============ org-scoped policies ============
-- SaaS tables
create policy orgs_select on public.organizations for select to authenticated
  using (public.is_super_admin() or id = public.my_org_id());
create policy orgs_update on public.organizations for update to authenticated
  using (public.is_super_admin() or (id = public.my_org_id() and public.is_admin()))
  with check (public.is_super_admin() or (id = public.my_org_id() and public.is_admin()));
create policy plans_read on public.plans for select to authenticated using (true);
create policy subs_select on public.subscriptions for select to authenticated
  using (public.is_super_admin() or org_id = public.my_org_id());
create policy fx_read on public.fx_rates for select to authenticated using (true);
create policy fx_write on public.fx_rates for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- org_config: read own org; write org admin
create policy org_config_read on public.org_config for select to authenticated
  using (public.is_super_admin() or org_id = public.my_org_id());
create policy org_config_write on public.org_config for all to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()))
  with check (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()));

-- profiles: self + org admins + super; inserts via service role only (signup API)
create policy profiles_select on public.profiles for select to authenticated
  using (public.owns_profile(id) or public.is_super_admin()
         or (public.is_admin() and org_id = public.my_org_id()));
create policy profiles_insert on public.profiles for insert to authenticated with check (false);
create policy profiles_update on public.profiles for update to authenticated
  using (public.owns_profile(id) or public.is_super_admin())
  with check (public.owns_profile(id) or public.is_super_admin());

-- member-owned tables
create policy dependents_all on public.dependents for all to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.owns_profile(member_id)))
  with check (public.is_super_admin() or (org_id = public.my_org_id() and public.owns_profile(member_id)));
create policy beneficiaries_all on public.beneficiaries for all to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.owns_profile(member_id)))
  with check (public.is_super_admin() or (org_id = public.my_org_id() and public.owns_profile(member_id)));
create policy kyc_all on public.kyc_docs for all to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.owns_profile(member_id)))
  with check (public.is_super_admin() or (org_id = public.my_org_id() and public.owns_profile(member_id)));
create policy consents_all on public.consents for all to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.owns_profile(member_id)))
  with check (public.is_super_admin() or (org_id = public.my_org_id() and public.owns_profile(member_id)));
create policy signatures_all on public.signatures for all to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.owns_profile(member_id)))
  with check (public.is_super_admin() or (org_id = public.my_org_id() and public.owns_profile(member_id)));

-- cases
create policy cases_select on public.cases for select to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.owns_profile(member_id)));
create policy cases_insert on public.cases for insert to authenticated
  with check (public.is_super_admin() or (org_id = public.my_org_id() and public.owns_profile(member_id)));
create policy cases_update on public.cases for update to authenticated
  using (public.is_super_admin()
         or (org_id = public.my_org_id()
             and (public.is_admin()
                  or (public.owns_profile(member_id) and status in ('draft','pending_review')))));

create policy case_docs_all on public.case_documents for all to authenticated
  using (public.is_super_admin()
         or (org_id = public.my_org_id()
             and exists (select 1 from public.cases c
                         where c.id = case_documents.case_id
                           and c.org_id = case_documents.org_id
                           and public.owns_profile(c.member_id))))
  with check (public.is_super_admin()
              or (org_id = public.my_org_id()
                  and exists (select 1 from public.cases c
                              where c.id = case_documents.case_id
                                and c.org_id = case_documents.org_id
                                and public.owns_profile(c.member_id))));

-- invoices/payments: member reads own; writes via service role (API)
create policy invoices_select on public.invoices for select to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.owns_profile(member_id)));
create policy payments_select on public.payments for select to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.owns_profile(member_id)));
create policy disbursements_select on public.disbursements for select to authenticated
  using (public.is_super_admin()
         or (org_id = public.my_org_id()
             and exists (select 1 from public.cases c
                         where c.id = disbursements.case_id
                           and c.org_id = disbursements.org_id
                           and public.owns_profile(c.member_id))));
create policy vouchers_select on public.vouchers for select to authenticated
  using (public.is_super_admin()
         or (org_id = public.my_org_id()
             and exists (select 1 from public.cases c
                         where c.id = vouchers.case_id
                           and c.org_id = vouchers.org_id
                           and public.owns_profile(c.member_id))));

-- funds / triggers / reserve
create policy funds_read on public.funds for select to authenticated
  using (public.is_super_admin() or org_id = public.my_org_id());
create policy funds_write on public.funds for all to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()))
  with check (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()));
create policy fund_triggers_admin on public.fund_triggers for all to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()))
  with check (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()));
create policy reserve_read on public.reserve_ledger for select to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()));

-- ballots / votes
create policy ballots_read on public.ballots for select to authenticated
  using (public.is_super_admin() or org_id = public.my_org_id());
create policy ballots_write on public.ballots for all to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()))
  with check (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()));
create policy votes_insert on public.votes for insert to authenticated
  with check (public.is_super_admin() or org_id = public.my_org_id());
create policy votes_read on public.votes for select to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()));

-- events / attendance
create policy events_read on public.events for select to authenticated
  using (public.is_super_admin() or org_id = public.my_org_id());
create policy events_write on public.events for all to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()))
  with check (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()));
create policy attendance_read on public.attendance for select to authenticated
  using (public.is_super_admin() or org_id = public.my_org_id());
create policy attendance_write on public.attendance for all to authenticated
  using (public.is_super_admin()
         or (org_id = public.my_org_id()
             and (public.owns_profile(member_id) or public.is_admin())))
  with check (public.is_super_admin()
              or (org_id = public.my_org_id()
                  and (public.owns_profile(member_id) or public.is_admin())));

-- notifications
create policy notifications_own on public.notifications for all to authenticated
  using (public.is_super_admin()
         or (org_id = public.my_org_id()
             and (member_id = auth.uid() or public.is_admin())))
  with check (public.is_super_admin() or org_id = public.my_org_id());

-- leadership / checklists
create policy leadership_read on public.leadership_contacts for select to authenticated
  using (public.is_super_admin() or org_id = public.my_org_id());
create policy leadership_write on public.leadership_contacts for all to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()))
  with check (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()));
create policy checklists_read on public.claim_checklists for select to authenticated
  using (public.is_super_admin() or org_id = public.my_org_id());
create policy checklists_write on public.claim_checklists for all to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()))
  with check (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()));

-- audit / drip runs
create policy audit_read on public.audit_log for select to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()));
create policy drip_read on public.drip_runs for select to authenticated
  using (public.is_super_admin() or (org_id = public.my_org_id() and public.is_admin()));

-- ============ per-org uniqueness (was global) ============
alter table public.vouchers drop constraint if exists vouchers_voucher_no_key;
alter table public.vouchers add constraint vouchers_org_no_key unique (org_id, voucher_no);
alter table public.funds drop constraint if exists funds_name_key;
alter table public.funds add constraint funds_org_name_key unique (org_id, name);
alter table public.claim_checklists drop constraint if exists claim_checklists_case_type_key;
alter table public.claim_checklists add constraint checklists_org_case_type_key unique (org_id, case_type);
