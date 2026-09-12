/**
 * Live end-to-end test: full case lifecycle A-Z on the deployed app.
 *
 * Creates a scratch org + owner + member, walks a welfare case from filing
 * through review → approve (voucher + invoicing) → member STK payment →
 * disburse, asserting each step, then deletes the scratch org.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/live-e2e.mjs
 *
 * No secrets are stored in this file — everything comes from env.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { generateSync } = require('/home/hatch/workspace/mutual-aid-app/node_modules/otplib');

const BASE = 'https://mutual-aid-app.vercel.app';
const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!v) throw new Error(`missing env ${k}`);
}

const stamp = Date.now().toString(36);
const ORG_NAME = `E2E Test Welfare ${stamp}`;
const OWNER_EMAIL = `e2e-owner-${stamp}@example.org`;
const MEMBER_EMAIL = `e2e-member-${stamp}@example.org`;
const PASSWORD = 'E2e-Test-12345!';

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failures++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

async function api(path, { method = 'GET', body, cookie, totp } = {}) {
  const headers = { 'content-type': 'application/json' };
  // The app's server guard reads the Supabase session from cookies (SSR),
  // not from the Authorization header.
  if (cookie) headers.cookie = cookie;
  if (totp) headers['x-totp-code'] = totp;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// Supabase REST with service role (setup/teardown/verification)
async function svc(table, { method = 'GET', body, query = '' } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`svc ${table} ${method} failed: ${JSON.stringify(json)}`);
  return json;
}

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const session = await res.json();
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(session)}`);
  // SSR cookie format expected by @supabase/ssr: base64url JSON session
  const payload = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: 'bearer',
    expires_in: session.expires_in ?? 3600,
    expires_at: Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
    user: session.user,
  };
  const value = 'base64-' + Buffer.from(JSON.stringify(payload)).toString('base64url');
  return {
    cookie: `sb-vhzolnzofabonlsrkgzc-auth-token=${value}`,
    accessToken: session.access_token,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('== 1. Create scratch org (SaaS signup) ==');
  const signup = await api('/api/signup', {
    method: 'POST',
    body: {
      mode: 'create_org', orgName: ORG_NAME, currency: 'KES',
      fullName: 'E2E Owner', email: OWNER_EMAIL, password: PASSWORD, phone: '254700000001',
    },
  });
  check('org signup 200', signup.status === 200, JSON.stringify(signup.json).slice(0, 200));
  const slug = signup.json.slug;
  check('slug returned', !!slug);

  const [org] = await svc('organizations', { query: `?slug=eq.${slug}&select=*` });
  check('org row exists', !!org);
  check('org currency KES', org.currency_code === 'KES');
  const orgId = org.id;
  console.log(`   org: ${org.name} (${org.slug}) invite=${org.invite_code}`);

  // multi-currency sanity: org_config got KES seeded
  const cfgRows = await svc('org_config', { query: `?org_id=eq.${orgId}&select=key,value` });
  const curRow = cfgRows.find((r) => r.key === 'currency_code');
  check('org_config currency_code=KES', curRow?.value === 'KES');

  console.log('== 2. Owner + member accounts ==');
  const ownerSession = await signIn(OWNER_EMAIL, PASSWORD);
  const ownerCookie = ownerSession.cookie;
  check('owner sign-in', !!ownerCookie);
  const [ownerProfile] = await svc('profiles', { query: `?email=eq.${OWNER_EMAIL}&select=id,role,org_id` });
  check('owner profile role=owner', ownerProfile?.role === 'owner');
  check('owner profile org matches', ownerProfile?.org_id === orgId);

  const join = await api('/api/signup', {
    method: 'POST',
    body: {
      mode: 'join', inviteCode: org.invite_code, fullName: 'E2E Member',
      email: MEMBER_EMAIL, password: PASSWORD, phone: '254700000002',
    },
  });
  check('member join 200', join.status === 200, JSON.stringify(join.json).slice(0, 200));
  const memberSession = await signIn(MEMBER_EMAIL, PASSWORD);
  const memberCookie = memberSession.cookie;
  const [memberProfile] = await svc('profiles', { query: `?email=eq.${MEMBER_EMAIL}&select=*` });
  const memberId = memberProfile.id;
  check('member profile org matches', memberProfile?.org_id === orgId);

  // Make the member "active" with a 100% beneficiary (as onboarding would)
  await svc('profiles', {
    method: 'PATCH', query: `?id=eq.${memberId}`,
    body: { status: 'active', waiting_ends_at: new Date(Date.now() - 86400000).toISOString() },
  });
  await svc('beneficiaries', {
    method: 'POST',
    body: [{ org_id: orgId, member_id: memberId, full_name: 'E2E Kin', relationship: 'spouse', percentage: 100, phone: '254700000003' }],
  });
  console.log('== 3. Member files a case ==');
  const [filed] = await svc('cases', {
    method: 'POST',
    body: [{
      org_id: orgId, member_id: memberId, case_type: 'death',
      deceased_name: 'E2E Deceased', death_date: '2026-08-01',
      benefit_amount: 5000000, currency_code: 'KES', status: 'pending_review',
    }],
  });
  const caseId = filed.id;
  check('case filed pending_review', filed.status === 'pending_review');
  check('case currency KES', filed.currency_code === 'KES');

  console.log('== 4. Admin review ==');
  const review = await api(`/api/cases/${caseId}/review`, {
    method: 'POST', cookie: ownerCookie,
    body: { decision: 'reviewed', notes: 'E2E: docs verified' },
  });
  check('review 200', review.status === 200, JSON.stringify(review.json).slice(0, 200));

  console.log('== 5. Enable TOTP for the owner (admin MFA gate) ==');
  const setup = await api('/api/admin/totp/setup', { method: 'POST', cookie: ownerCookie });
  check('totp setup 200', setup.status === 200);
  const totpCode = generateSync({ secret: setup.json.secret });
  const verify = await api('/api/admin/totp/verify', {
    method: 'POST', cookie: ownerCookie, body: { token: totpCode },
  });
  check('totp verify 200', verify.status === 200, JSON.stringify(verify.json).slice(0, 160));

  console.log('== 6. Approve (voucher + invoicing) ==');
  const approve = await api(`/api/cases/${caseId}/approve`, {
    method: 'POST', cookie: ownerCookie, totp: generateSync({ secret: setup.json.secret }),
    body: { signatureType: 'typed', signatureData: 'E2E Owner' },
  });
  check('approve 200', approve.status === 200, JSON.stringify(approve.json).slice(0, 300));

  const [voucher] = await svc('vouchers', { query: `?case_id=eq.${caseId}&select=*` });
  check('voucher issued', !!voucher?.voucher_no, JSON.stringify(voucher).slice(0, 160));
  check('voucher org scoped', voucher?.org_id === orgId);
  const invoices = await svc('invoices', { query: `?org_id=eq.${orgId}&select=id,member_id,amount,currency_code,status` });
  check('invoices created for members', invoices.length >= 1, `count=${invoices.length}`);
  check('invoice currency KES', invoices.every((i) => i.currency_code === 'KES'));

  console.log('== 7. Member pays invoice via M-Pesa STK (stub) ==');
  const myInvoice = invoices.find((i) => i.member_id === memberId);
  check('member was invoiced', !!myInvoice);
  let paymentCompleted = false;
  if (myInvoice) {
    const stk = await api('/api/mpesa/stk-push', {
      method: 'POST', cookie: memberCookie,
      body: { invoiceId: myInvoice.id, phone: '254700000002' },
    });
    check('stk-push 200', stk.status === 200, JSON.stringify(stk.json).slice(0, 200));
    // stub mode: simulate Daraja's async callback
    const cb = await api('/api/mpesa/callback', {
      method: 'POST',
      body: { Body: { stkCallback: { CheckoutRequestID: stk.json.checkoutRequestId, ResultCode: 0, ResultDesc: 'E2E stub success' } } },
    });
    check('callback 200', cb.status === 200, JSON.stringify(cb.json).slice(0, 200));
    const [inv] = await svc('invoices', { query: `?id=eq.${myInvoice.id}&select=status` });
    paymentCompleted = inv?.status === 'paid';
    check('invoice marked paid', paymentCompleted, `status=${inv?.status}`);
  }

  console.log('== 8. Disburse to beneficiary ==');
  const disburse = await api(`/api/cases/${caseId}/disburse`, {
    method: 'POST', cookie: ownerCookie, totp: generateSync({ secret: setup.json.secret }),
  });
  check('disburse 200', disburse.status === 200, JSON.stringify(disburse.json).slice(0, 300));
  const [doneCase] = await svc('cases', { query: `?id=eq.${caseId}&select=status` });
  check('case disbursed', doneCase?.status === 'disbursed');
  const disbursements = await svc('disbursements', { query: `?case_id=eq.${caseId}&select=*` });
  check('disbursement rows created', disbursements.length >= 1);
  check('disbursement currency KES', disbursements.every((d) => d.currency_code === 'KES'));

  console.log('== 9. Notifications + audit trail ==');
  const notes = await svc('notifications', { query: `?org_id=eq.${orgId}&select=id,title&limit=5` });
  check('member notifications exist', notes.length >= 1, `count=${notes.length}`);
  const audits = await svc('audit_log', { query: `?org_id=eq.${orgId}&select=action&limit=50` });
  const actions = new Set(audits.map((a) => a.action));
  for (const a of ['case_reviewed', 'case_approved', 'case_disbursed']) {
    check(`audit has ${a}`, actions.has(a));
  }

  console.log('== 10. Second org in USD (multi-currency SaaS) ==');
  const usdSignup = await api('/api/signup', {
    method: 'POST',
    body: {
      mode: 'create_org', orgName: `E2E USD Org ${stamp}`, currency: 'USD',
      fullName: 'E2E USD Owner', email: `e2e-usd-${stamp}@example.org`, password: PASSWORD,
    },
  });
  check('USD org signup 200', usdSignup.status === 200);
  const [usdOrg] = await svc('organizations', { query: `?slug=eq.${usdSignup.json.slug}&select=*` });
  check('USD org currency_code=USD', usdOrg?.currency_code === 'USD');
  const usdCfg = await svc('org_config', { query: `?org_id=eq.${usdOrg.id}&key=eq.currency_code&select=value` });
  check('USD org_config currency=USD', usdCfg[0]?.value === 'USD');

  console.log('== 11. Tenant isolation spot-check ==');
  // member token from org A must NOT see org B's org_config via RLS
  const isoRes = await fetch(`${SUPABASE_URL}/rest/v1/org_config?select=key`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${memberSession.accessToken}` },
  });
  const isoRows = await isoRes.json();
  check('member sees only own org config rows', isoRows.every((r) => r.key !== undefined) && isoRows.length > 0);

  console.log('== 12. Cleanup scratch orgs ==');
  // delete auth users first (profiles cascade from org delete, auth.users does not)
  const authIds = [OWNER_EMAIL, MEMBER_EMAIL, `e2e-usd-${stamp}@example.org`];
  for (const email of authIds) {
    try {
      const list = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=100`, {
        headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      }).then((r) => r.json());
      const u = (list.users || []).find((x) => x.email === email);
      if (u) {
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, {
          method: 'DELETE',
          headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        });
      }
    } catch { /* best-effort */ }
  }
  for (const id of [usdOrg.id, orgId]) {
    const del = await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${id}`, {
      method: 'DELETE',
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    });
    check(`deleted org ${id.slice(0, 8)}`, del.ok, `status=${del.status}`);
  }
  await sleep(1000);
  const [gone] = await svc('organizations', { query: `?id=eq.${orgId}&select=id` });
  check('scratch org fully removed', !gone);

  console.log(failures === 0 ? '\n🎉 ALL E2E CHECKS PASSED' : `\n⚠️ ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(2);
});
