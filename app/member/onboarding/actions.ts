'use server';

import { createAdminClient } from '@/lib/supabase/server';
import { resolveOrgContext } from '@/lib/org-context';
import { validatePercentages } from '@/lib/engines/beneficiarySplit';
import { ONBOARDING_CLAUSES } from './clauses';

async function requireUser() {
  const admin = createAdminClient();
  const { orgId, profile } = await resolveOrgContext(admin);
  return { admin, orgId, user: { id: profile.id } };
}

export async function saveProfile(input: { fullName: string; phone: string; nationalId: string }) {
  const { admin, orgId, user } = await requireUser();
  if (!input.fullName.trim()) throw new Error('Full name is required.');
  if (!input.nationalId.trim()) throw new Error('National ID is required.');
  const { error } = await admin
    .from('profiles')
    .update({
      full_name: input.fullName.trim(),
      phone: input.phone.trim() || null,
      national_id: input.nationalId.trim(),
    })
    .eq('id', user.id)
    .eq('org_id', orgId);
  if (error) throw new Error(error.message);
}

export interface DependentInput {
  fullName: string;
  kinship: string;
  dob: string;
  nationalId: string;
}

export async function saveDependents(dependents: DependentInput[]) {
  const { admin, orgId, user } = await requireUser();
  const { error: delError } = await admin
    .from('dependents')
    .delete()
    .eq('member_id', user.id)
    .eq('org_id', orgId);
  if (delError) throw new Error(delError.message);
  const rows = dependents
    .filter((d) => d.fullName.trim())
    .map((d) => ({
      org_id: orgId,
      member_id: user.id,
      full_name: d.fullName.trim(),
      kinship_type: d.kinship,
      date_of_birth: d.dob || null,
      national_id: d.nationalId.trim() || null,
    }));
  if (rows.length === 0) return;
  const { error } = await admin.from('dependents').insert(rows);
  if (error) throw new Error(error.message);
}

export interface BeneficiaryInput {
  fullName: string;
  relationship: string;
  percentage: number;
  phone: string;
}

export async function saveBeneficiaries(beneficiaries: BeneficiaryInput[]) {
  const { admin, orgId, user } = await requireUser();
  const filled = beneficiaries.filter((b) => b.fullName.trim());
  validatePercentages(
    filled.map((b, i) => ({ id: String(i), percentage: Number(b.percentage) })),
  );
  const { error: delError } = await admin
    .from('beneficiaries')
    .delete()
    .eq('member_id', user.id)
    .eq('org_id', orgId);
  if (delError) throw new Error(delError.message);
  const rows = filled.map((b) => ({
    org_id: orgId,
    member_id: user.id,
    full_name: b.fullName.trim(),
    relationship: b.relationship.trim() || null,
    percentage: Number(b.percentage),
    phone: b.phone.trim() || null,
  }));
  const { error } = await admin.from('beneficiaries').insert(rows);
  if (error) throw new Error(error.message);
}

export async function saveConsents(acceptedKeys: string[]) {
  const { admin, orgId, user } = await requireUser();
  const required = ONBOARDING_CLAUSES.map((c) => c.key);
  for (const key of required) {
    if (!acceptedKeys.includes(key)) {
      throw new Error('All consent clauses must be accepted to continue.');
    }
  }
  for (const clause of ONBOARDING_CLAUSES) {
    const { error } = await admin.from('consents').upsert(
      {
        org_id: orgId,
        member_id: user.id,
        clause_key: clause.key,
        clause_text: clause.text,
      },
      { onConflict: 'member_id,clause_key' },
    );
    if (error) throw new Error(error.message);
  }
}

export async function saveSignature(input: { type: 'typed' | 'canvas'; data: string }) {
  const { admin, orgId, user } = await requireUser();
  if (!input.data.trim()) throw new Error('A signature is required.');
  const { error } = await admin.from('signatures').insert({
    org_id: orgId,
    member_id: user.id,
    signature_type: input.type,
    signature_data: input.data,
  });
  if (error) throw new Error(error.message);
}

/** Final step: activate the member when KYC docs are present, otherwise keep pending. */
export async function finalizeOnboarding(): Promise<'active' | 'pending'> {
  const { admin, orgId, user } = await requireUser();
  const { count } = await admin
    .from('kyc_docs')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', user.id)
    .eq('org_id', orgId);
  const status = (count ?? 0) > 0 ? 'active' : 'pending';
  const { error } = await admin
    .from('profiles')
    .update({ status })
    .eq('id', user.id)
    .eq('org_id', orgId);
  if (error) throw new Error(error.message);
  return status;
}
