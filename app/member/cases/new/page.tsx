'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/money';
import { waitingPeriodSatisfied, waitingDaysRemaining } from '@/lib/engines/waitingPeriod';

const CASE_TYPES = [
  { value: 'death', label: 'Death of a member / dependent' },
  { value: 'medical', label: 'Medical assistance' },
  { value: 'other', label: 'Other welfare case' },
];

interface GateState {
  loaded: boolean;
  status: string | null;
  joinedAt: string | null;
  waitingDays: number;
  benefitAmount: number;
  currencyCode: string;
  currencySymbol: string;
  requiredDocs: string[];
  orgId: string | null;
}

export default function RaiseCasePage() {
  const router = useRouter();
  const [gate, setGate] = useState<GateState>({
    loaded: false,
    status: null,
    joinedAt: null,
    waitingDays: 180,
    benefitAmount: 0,
    currencyCode: 'KES',
    currencySymbol: 'KSh',
    requiredDocs: [],
    orgId: null,
  });
  const [caseType, setCaseType] = useState('death');
  const [deceasedName, setDeceasedName] = useState('');
  const [deathDate, setDeathDate] = useState('');
  const [files, setFiles] = useState<FileList | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('status, joined_at, org_id')
        .eq('id', user.id)
        .maybeSingle();
      // Resolve the member's org + its currency (RLS allows reading these).
      const profileOrgId = (profile as any)?.org_id as string | undefined;
      let currencyCode = 'KES';
      if (profileOrgId) {
        const { data: orgRow } = await supabase
          .from('organizations')
          .select('currency_code')
          .eq('id', profileOrgId)
          .maybeSingle();
        if (typeof (orgRow as any)?.currency_code === 'string') {
          currencyCode = (orgRow as any).currency_code as string;
        }
      }
      const { data: cfg } = await supabase.from('org_config').select('key, value');
      const map = new Map((cfg ?? []).map((r: any) => [r.key, r.value]));
      const num = (k: string, d: number) => {
        const n = Number(map.get(k));
        return Number.isFinite(n) ? n : d;
      };
      const { data: checklist } = await supabase
        .from('claim_checklists')
        .select('required_docs')
        .eq('case_type', caseType)
        .maybeSingle();
      setGate({
        loaded: true,
        status: profile?.status ?? null,
        joinedAt: profile?.joined_at ?? null,
        waitingDays: num('waiting_period_days', 180),
        benefitAmount: num('benefit_amount', 0),
        currencyCode,
        currencySymbol: typeof map.get('currency_symbol') === 'string' ? (map.get('currency_symbol') as string) : 'KSh',
        requiredDocs: Array.isArray((checklist as any)?.required_docs)
          ? (checklist as any).required_docs
          : [],
        orgId: profileOrgId ?? null,
      });
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseType]);

  if (!gate.loaded) {
    return <p className="text-sm text-gray-500">Loading eligibility...</p>;
  }

  if (gate.status !== 'active') {
    return (
      <div className="mx-auto max-w-xl rounded-xl border bg-white p-6 text-center shadow-sm">
        <h1 className="text-xl font-bold text-gray-900">Raise a case</h1>
        <p className="mt-3 text-sm text-gray-600">
          Only active members can raise cases. Your membership status is{' '}
          <strong>{gate.status ?? 'unknown'}</strong>. Please complete onboarding or contact
          leadership for assistance.
        </p>
        <Link
          href="/member/onboarding"
          className="mt-4 inline-block rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          Go to onboarding
        </Link>
      </div>
    );
  }

  if (gate.joinedAt && !waitingPeriodSatisfied(gate.joinedAt, gate.waitingDays)) {
    const remaining = waitingDaysRemaining(gate.joinedAt, gate.waitingDays);
    return (
      <div className="mx-auto max-w-xl rounded-xl border bg-white p-6 text-center shadow-sm">
        <h1 className="text-xl font-bold text-gray-900">Raise a case</h1>
        <p className="mt-3 text-sm text-gray-600">
          New members must complete the {gate.waitingDays}-day waiting period before raising a
          case. You have <strong>{remaining} day{remaining === 1 ? '' : 's'}</strong> remaining.
        </p>
        <Link
          href="/member"
          className="mt-4 inline-block rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('You must be signed in.');

      // 1. Create the case first.
      if (!gate.orgId) throw new Error('Organization context not loaded yet. Please reload the page.');
      const { data: newCase, error: caseError } = await supabase
        .from('cases')
        .insert({
          org_id: gate.orgId,
          currency_code: gate.currencyCode,
          member_id: user.id,
          case_type: caseType,
          deceased_name: deceasedName.trim(),
          death_date: deathDate,
          status: 'pending_review',
          benefit_amount: gate.benefitAmount,
        })
        .select('id')
        .single();
      if (caseError) throw new Error(caseError.message);
      const caseId = newCase.id as string;

      // 2. Upload claim documents to claim-docs/{caseId}/ and register them.
      if (files && files.length > 0) {
        for (const file of Array.from(files)) {
          const path = `${caseId}/${Date.now()}-${file.name}`;
          const { error: upErr } = await supabase.storage
            .from('claim-docs')
            .upload(path, file, { contentType: file.type });
          if (upErr) throw new Error(`Upload failed for ${file.name}: ${upErr.message}`);
          const { error: docErr } = await supabase.from('case_documents').insert({
            org_id: gate.orgId,
            case_id: caseId,
            doc_type: 'supporting_document',
            storage_path: path,
            uploaded_by: user.id,
          });
          if (docErr) throw new Error(docErr.message);
        }
      }

      router.push(`/member/cases/${caseId}`);
    } catch (err: any) {
      setError(err.message ?? 'Failed to submit the case.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none';
  const labelCls = 'block text-sm font-medium text-gray-700';

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">Raise a case</h1>
      <p className="mt-1 text-sm text-gray-600">
        Standard benefit:{' '}
        <strong>{formatMoney(gate.benefitAmount, gate.currencyCode)}</strong>
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4 rounded-xl border bg-white p-6 shadow-sm">
        <div>
          <label className={labelCls} htmlFor="case-type">Case type</label>
          <select
            id="case-type"
            className={inputCls}
            value={caseType}
            onChange={(e) => setCaseType(e.target.value)}
          >
            {CASE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="deceased-name">Name of deceased / patient</label>
          <input
            id="deceased-name"
            required
            className={inputCls}
            value={deceasedName}
            onChange={(e) => setDeceasedName(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="death-date">Date of death / incident</label>
          <input
            id="death-date"
            type="date"
            required
            max={new Date().toISOString().slice(0, 10)}
            className={inputCls}
            value={deathDate}
            onChange={(e) => setDeathDate(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="claim-docs">Claim documents</label>
          <input
            id="claim-docs"
            type="file"
            multiple
            accept="image/*,.pdf"
            className="mt-1 text-sm"
            onChange={(e) => setFiles(e.target.files)}
          />
          {gate.requiredDocs.length > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              Typically required for {caseType}: {gate.requiredDocs.join(', ')}
            </p>
          )}
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {submitting ? 'Submitting...' : 'Submit case'}
        </button>
      </form>
    </div>
  );
}
