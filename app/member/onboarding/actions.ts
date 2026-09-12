'use server';

import { createClient } from '@/lib/supabase/server';
import { validatePercentages } from '@/lib/engines/beneficiarySplit';
import { ONBOARDING_CLAUSES } from './clauses';

async function requireUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in.');
  return { supabase, user };
}

export async function saveProfile(input: { fullName: string; phone: string; nationalId: string }) {
  const { supabase, user } = await requireUser();
  if (!input.fullName.trim()) throw new Error('Full name is required.');
  if (!input.nationalId.trim()) throw new Error('National ID is required.');
  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: input.fullName.trim(),
      phone: input.phone.trim() || null,
      national_id: input.nationalId.trim(),
    })
    .eq('id', user.id);
  if (error) throw new Error(error.message);
}

export interface DependentInput {
  fullName: string;
  kinship: string;
  dob: string;
  nationalId: string;
}

export async function saveDependents(dependents: DependentInput[]) {
  const { supabase, user } = await requireUser();
  const { error: delError } = await supabase.from('dependents').delete().eq('member_id', user.id);
  if (delError) throw new Error(delError.message);
  const rows = dependents
    .filter((d) => d.fullName.trim())
    .map((d) => ({
      member_id: user.id,
      full_name: d.fullName.trim(),
      kinship_type: d.kinship,
      date_of_birth: d.dob || null,
      national_id: d.nationalId.trim() || null,
    }));
  if (rows.length === 0) return;
  const { error } = await supabase.from('dependents').insert(rows);
  if (error) throw new Error(error.message);
}

export interface BeneficiaryInput {
  fullName: string;
  relationship: string;
  percentage: number;
  phone: string;
}

export async function saveBeneficiaries(beneficiaries: BeneficiaryInput[]) {
  const { supabase, user } = await requireUser();
  const filled = beneficiaries.filter((b) => b.fullName.trim());
  validatePercentages(
    filled.map((b, i) => ({ id: String(i), percentage: Number(b.percentage) })),
  );
  const { error: delError } = await supabase
    .from('beneficiaries')
    .delete()
    .eq('member_id', user.id);
  if (delError) throw new Error(delError.message);
  const rows = filled.map((b) => ({
    member_id: user.id,
    full_name: b.fullName.trim(),
    relationship: b.relationship.trim() || null,
    percentage: Number(b.percentage),
    phone: b.phone.trim() || null,
  }));
  const { error } = await supabase.from('beneficiaries').insert(rows);
  if (error) throw new Error(error.message);
}

export async function saveConsents(acceptedKeys: string[]) {
  const { supabase, user } = await requireUser();
  const required = ONBOARDING_CLAUSES.map((c) => c.key);
  for (const key of required) {
    if (!acceptedKeys.includes(key)) {
      throw new Error('All consent clauses must be accepted to continue.');
    }
  }
  for (const clause of ONBOARDING_CLAUSES) {
    const { error } = await supabase.from('consents').upsert(
      {
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
  const { supabase, user } = await requireUser();
  if (!input.data.trim()) throw new Error('A signature is required.');
  const { error } = await supabase.from('signatures').insert({
    member_id: user.id,
    signature_type: input.type,
    signature_data: input.data,
  });
  if (error) throw new Error(error.message);
}

/** Final step: activate the member when KYC docs are present, otherwise keep pending. */
export async function finalizeOnboarding(): Promise<'active' | 'pending'> {
  const { supabase, user } = await requireUser();
  const { count } = await supabase
    .from('kyc_docs')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', user.id);
  const status = (count ?? 0) > 0 ? 'active' : 'pending';
  const { error } = await supabase
    .from('profiles')
    .update({ status })
    .eq('id', user.id);
  if (error) throw new Error(error.message);
  return status;
}
