-- Seed: org config, funds, checklists, leadership, demo rows.
-- NOTE: demo profile UUIDs below must match real auth.users rows.
-- Create matching users in Supabase Auth (or via the app's onboarding) and
-- update these ids, or insert profiles after sign-up.

-- ---------- org config ----------
insert into public.org_config (key, value) values
  ('org_name',            '"Umoja Welfare Association"'),
  ('currency_code',       '"KES"'),
  ('currency_symbol',     '"KSh"'),
  ('waiting_period_days', '180'),
  ('max_dependents',      '10'),
  ('benefit_amount',      '5000000'),
  ('penalty_amount',      '50000'),
  ('flat_case_fee',       '20000'),
  ('invoicing_strategy',  '"flat"'),
  ('annual_fee',          '120000')
on conflict (key) do update set value = excluded.value;

-- ---------- funds ----------
insert into public.funds (name, policy, balance) values
  ('Welfare Fund', '{"purpose":"case benefit payouts"}', 0),
  ('Reserve Fund', '{"purpose":"surplus accumulation from invoicing"}', 0)
on conflict (name) do nothing;

-- ---------- claim checklists ----------
insert into public.claim_checklists (case_type, required_docs) values
  ('death',   '["death_certificate","deceased_national_id","burial_permit","claimant_national_id"]'),
  ('medical', '["hospital_bill","doctor_report","claimant_national_id"]'),
  ('other',   '["supporting_document","claimant_national_id"]')
on conflict (case_type) do update set required_docs = excluded.required_docs;

-- ---------- leadership ----------
insert into public.leadership_contacts (name, role, phone, email) values
  ('Grace Wanjiru', 'Chairperson', '+254700000001', 'chair@example.org'),
  ('David Otieno',  'Treasurer',   '+254700000002', 'treasurer@example.org'),
  ('Mary Achieng',  'Secretary',   '+254700000003', 'secretary@example.org')
on conflict do nothing;

-- ---------- demo profiles (replace UUIDs with real auth user ids) ----------
-- Admin: 11111111-1111-1111-1111-111111111111
-- Member A (active): 22222222-2222-2222-2222-222222222222
-- Member B (active): 33333333-3333-3333-3333-333333333333
insert into public.profiles (id, role, full_name, email, phone, national_id, status, waiting_ends_at) values
  ('11111111-1111-1111-1111-111111111111','admin','Admin User','admin@example.org','+254700000010','10000001','active', now() - interval '1 day'),
  ('22222222-2222-2222-2222-222222222222','member','Peter Kamau','peter@example.org','+254711111111','20000001','active', now() - interval '1 day'),
  ('33333333-3333-3333-3333-333333333333','member','Susan Njeri','susan@example.org','+254722222222','20000002','active', now() - interval '1 day')
on conflict (id) do update set role = excluded.role, status = excluded.status;

-- demo dependents for member A
insert into public.dependents (member_id, full_name, kinship_type, national_id, verification_status) values
  ('22222222-2222-2222-2222-222222222222','Jane Kamau','spouse','20000011','verified'),
  ('22222222-2222-2222-2222-222222222222','Brian Kamau','child','20000012','pending')
on conflict do nothing;

-- demo beneficiaries for member A (sums to 100)
insert into public.beneficiaries (member_id, full_name, relationship, percentage, phone) values
  ('22222222-2222-2222-2222-222222222222','Jane Kamau','spouse',60.00,'+254711111112'),
  ('22222222-2222-2222-2222-222222222222','Brian Kamau','child',40.00,'+254711111113')
on conflict do nothing;

-- demo ballot
insert into public.ballots (title, description, status, options) values
  ('Annual General Meeting Venue','Choose the venue for the 2026 AGM','open',
   '[{"id":"opt1","label":"Nairobi Community Hall"},{"id":"opt2","label":"Mombasa Beach Resort"}]')
on conflict do nothing;

-- demo event
insert into public.events (title, description, event_date, location) values
  ('Monthly Welfare Meeting','Monthly member meeting and contribution review',
   now() + interval '7 days','Community Hall, Nairobi')
on conflict do nothing;
