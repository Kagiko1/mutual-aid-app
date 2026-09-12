'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { validatePercentages } from '@/lib/engines/beneficiarySplit';
import { ONBOARDING_CLAUSES } from './clauses';
import {
  saveProfile,
  saveDependents,
  saveBeneficiaries,
  saveConsents,
  saveSignature,
  finalizeOnboarding,
} from './actions';

const STEP_TITLES = [
  'Profile details',
  'Dependents',
  'Beneficiaries',
  'KYC documents',
  'Consent clauses',
  'E-signature',
];

const KINSHIP_TYPES = ['spouse', 'child', 'parent', 'sibling', 'other'];

const KYC_DOCS = [
  { type: 'national_id_front', label: 'National ID — front' },
  { type: 'national_id_back', label: 'National ID — back' },
  { type: 'passport_photo', label: 'Passport photo' },
];

interface DependentRow {
  fullName: string;
  kinship: string;
  dob: string;
  nationalId: string;
}

interface BeneficiaryRow {
  fullName: string;
  relationship: string;
  percentage: string;
  phone: string;
}

const emptyDependent = (): DependentRow => ({ fullName: '', kinship: 'child', dob: '', nationalId: '' });
const emptyBeneficiary = (): BeneficiaryRow => ({ fullName: '', relationship: '', percentage: '', phone: '' });

const inputCls =
  'mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none';
const labelCls = 'block text-sm font-medium text-gray-700';

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalStatus, setFinalStatus] = useState<'active' | 'pending' | null>(null);
  // Resolved once: the member's own org (RLS allows reading own profile's org_id).
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        const { data: prof } = await supabase
          .from('profiles')
          .select('org_id')
          .eq('id', user.id)
          .single();
        if ((prof as any)?.org_id) setOrgId((prof as any).org_id as string);
      } catch {
        /* resolved server-side in actions; insert will fail loudly if missing */
      }
    };
    load();
  }, []);

  // Step 1
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [nationalId, setNationalId] = useState('');
  // Step 2
  const [dependents, setDependents] = useState<DependentRow[]>([emptyDependent()]);
  // Step 3
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryRow[]>([emptyBeneficiary()]);
  // Step 4
  const [kycFiles, setKycFiles] = useState<Record<string, File | null>>({});
  const [kycUploaded, setKycUploaded] = useState<Record<string, boolean>>({});
  const [kycUploading, setKycUploading] = useState(false);
  // Step 5
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  // Step 6
  const [sigMode, setSigMode] = useState<'typed' | 'canvas'>('typed');
  const [typedName, setTypedName] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [canvasHasInk, setCanvasHasInk] = useState(false);

  const run = async (fn: () => Promise<void>, nextStep: number) => {
    setSaving(true);
    setError(null);
    try {
      await fn();
      setStep(nextStep);
      window.scrollTo(0, 0);
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  const beneficiarySum = beneficiaries.reduce((s, b) => s + (Number(b.percentage) || 0), 0);
  let beneficiaryError: string | null = null;
  try {
    const filled = beneficiaries.filter((b) => b.fullName.trim());
    validatePercentages(filled.map((b, i) => ({ id: String(i), percentage: Number(b.percentage) })));
  } catch (err: any) {
    beneficiaryError = err.message;
  }

  const handleKycUpload = async (docType: string) => {
    const file = kycFiles[docType];
    if (!file) return;
    setKycUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('You must be signed in.');
      const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
      const path = `${user.id}/${docType}${ext}`;
      const { error: upErr } = await supabase.storage
        .from('kyc-docs')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw new Error(upErr.message);
      if (!orgId) throw new Error('Organization context not loaded yet. Please wait and try again.');
      const { error: insErr } = await supabase.from('kyc_docs').insert({
        org_id: orgId,
        member_id: user.id,
        doc_type: docType,
        storage_path: path,
        status: 'pending',
      });
      if (insErr) throw new Error(insErr.message);
      setKycUploaded((prev) => ({ ...prev, [docType]: true }));
    } catch (err: any) {
      setError(err.message ?? 'Upload failed.');
    } finally {
      setKycUploading(false);
    }
  };

  // Canvas drawing
  const canvasPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };
  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setDrawing(true);
    const { x, y } = canvasPos(e);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111827';
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { x, y } = canvasPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setCanvasHasInk(true);
  };
  const endDraw = () => setDrawing(false);
  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setCanvasHasInk(false);
  };
  useEffect(() => {
    // Keep canvas bitmap aligned with its displayed size.
    const canvas = canvasRef.current;
    if (canvas && sigMode === 'canvas') {
      canvas.width = canvas.offsetWidth;
      canvas.height = 160;
    }
  }, [sigMode, step]);

  const handleSignatureSubmit = () =>
    run(async () => {
      if (sigMode === 'typed') {
        if (!typedName.trim()) throw new Error('Please type your full name to sign.');
        await saveSignature({ type: 'typed', data: typedName.trim() });
      } else {
        if (!canvasHasInk) throw new Error('Please draw your signature first.');
        const dataUrl = canvasRef.current!.toDataURL('image/png');
        await saveSignature({ type: 'canvas', data: dataUrl });
      }
      const status = await finalizeOnboarding();
      setFinalStatus(status);
    }, 6);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">Member onboarding</h1>
      <p className="mt-1 text-sm text-gray-600">
        Complete all steps to activate your membership.
      </p>

      {/* Progress */}
      <ol className="mt-6 flex flex-wrap gap-2">
        {STEP_TITLES.map((title, i) => (
          <li
            key={title}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              i === step
                ? 'bg-emerald-700 text-white'
                : i < step
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-gray-100 text-gray-500'
            }`}
          >
            {i + 1}. {title}
          </li>
        ))}
      </ol>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <div className="mt-6 rounded-xl border bg-white p-6 shadow-sm">
        {step === 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">1. Profile details</h2>
            <div>
              <label className={labelCls} htmlFor="ob-name">Full name</label>
              <input id="ob-name" className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div>
              <label className={labelCls} htmlFor="ob-phone">Phone (M-Pesa number)</label>
              <input id="ob-phone" className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2547..." />
            </div>
            <div>
              <label className={labelCls} htmlFor="ob-nid">National ID number</label>
              <input id="ob-nid" className={inputCls} value={nationalId} onChange={(e) => setNationalId(e.target.value)} />
            </div>
            <button
              disabled={saving}
              onClick={() => run(() => saveProfile({ fullName, phone, nationalId }), 1)}
              className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save and continue'}
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">2. Dependents</h2>
            <p className="text-sm text-gray-600">Add the family members covered under your membership.</p>
            {dependents.map((d, i) => (
              <div key={i} className="rounded-lg border p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Full name</label>
                    <input
                      className={inputCls}
                      value={d.fullName}
                      onChange={(e) =>
                        setDependents((prev) => prev.map((r, j) => (j === i ? { ...r, fullName: e.target.value } : r)))
                      }
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Kinship</label>
                    <select
                      className={inputCls}
                      value={d.kinship}
                      onChange={(e) =>
                        setDependents((prev) => prev.map((r, j) => (j === i ? { ...r, kinship: e.target.value } : r)))
                      }
                    >
                      {KINSHIP_TYPES.map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Date of birth</label>
                    <input
                      type="date"
                      className={inputCls}
                      value={d.dob}
                      onChange={(e) =>
                        setDependents((prev) => prev.map((r, j) => (j === i ? { ...r, dob: e.target.value } : r)))
                      }
                    />
                  </div>
                  <div>
                    <label className={labelCls}>National ID (if any)</label>
                    <input
                      className={inputCls}
                      value={d.nationalId}
                      onChange={(e) =>
                        setDependents((prev) => prev.map((r, j) => (j === i ? { ...r, nationalId: e.target.value } : r)))
                      }
                    />
                  </div>
                </div>
                {dependents.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setDependents((prev) => prev.filter((_, j) => j !== i))}
                    className="mt-2 text-sm text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDependents((prev) => [...prev, emptyDependent()])}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Add dependent
              </button>
              <button
                disabled={saving}
                onClick={() => run(() => saveDependents(dependents), 2)}
                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save and continue'}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">3. Beneficiaries</h2>
            <p className="text-sm text-gray-600">
              Name who should receive your benefit payout. Percentages must add up to exactly 100%.
            </p>
            {beneficiaries.map((b, i) => (
              <div key={i} className="rounded-lg border p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Full name</label>
                    <input
                      className={inputCls}
                      value={b.fullName}
                      onChange={(e) =>
                        setBeneficiaries((prev) => prev.map((r, j) => (j === i ? { ...r, fullName: e.target.value } : r)))
                      }
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Relationship</label>
                    <input
                      className={inputCls}
                      value={b.relationship}
                      onChange={(e) =>
                        setBeneficiaries((prev) => prev.map((r, j) => (j === i ? { ...r, relationship: e.target.value } : r)))
                      }
                      placeholder="e.g. spouse"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Share (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      className={inputCls}
                      value={b.percentage}
                      onChange={(e) =>
                        setBeneficiaries((prev) => prev.map((r, j) => (j === i ? { ...r, percentage: e.target.value } : r)))
                      }
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Phone</label>
                    <input
                      className={inputCls}
                      value={b.phone}
                      onChange={(e) =>
                        setBeneficiaries((prev) => prev.map((r, j) => (j === i ? { ...r, phone: e.target.value } : r)))
                      }
                    />
                  </div>
                </div>
                {beneficiaries.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setBeneficiaries((prev) => prev.filter((_, j) => j !== i))}
                    className="mt-2 text-sm text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <div className={`rounded-md px-3 py-2 text-sm font-semibold ${beneficiaryError ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
              Total share: {beneficiarySum.toFixed(2)}% {beneficiaryError ? `— ${beneficiaryError}` : '— valid'}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setBeneficiaries((prev) => [...prev, emptyBeneficiary()])}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Add beneficiary
              </button>
              <button
                disabled={saving || !!beneficiaryError}
                onClick={() =>
                  run(
                    () =>
                      saveBeneficiaries(
                        beneficiaries.map((b) => ({
                          fullName: b.fullName,
                          relationship: b.relationship,
                          percentage: Number(b.percentage),
                          phone: b.phone,
                        })),
                      ),
                    3,
                  )
                }
                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save and continue'}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">4. KYC documents</h2>
            <p className="text-sm text-gray-600">Upload each document, then continue.</p>
            {KYC_DOCS.map((doc) => (
              <div key={doc.type} className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">{doc.label}</p>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="mt-1 text-sm"
                    onChange={(e) =>
                      setKycFiles((prev) => ({ ...prev, [doc.type]: e.target.files?.[0] ?? null }))
                    }
                  />
                </div>
                {kycUploaded[doc.type] ? (
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                    Uploaded
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={!kycFiles[doc.type] || kycUploading}
                    onClick={() => handleKycUpload(doc.type)}
                    className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    {kycUploading ? 'Uploading...' : 'Upload'}
                  </button>
                )}
              </div>
            ))}
            <button
              disabled={saving || !KYC_DOCS.every((d) => kycUploaded[d.type])}
              onClick={() => run(async () => {}, 4)}
              className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">5. Consent clauses</h2>
            <p className="text-sm text-gray-600">Please read and accept all clauses.</p>
            {ONBOARDING_CLAUSES.map((clause) => (
              <label key={clause.key} className="flex gap-3 rounded-lg border p-4">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={!!accepted[clause.key]}
                  onChange={(e) => setAccepted((prev) => ({ ...prev, [clause.key]: e.target.checked }))}
                />
                <span>
                  <span className="block text-sm font-semibold text-gray-800">{clause.title}</span>
                  <span className="mt-1 block text-sm text-gray-600">{clause.text}</span>
                </span>
              </label>
            ))}
            <button
              disabled={saving || !ONBOARDING_CLAUSES.every((c) => accepted[c.key])}
              onClick={() => run(() => saveConsents(ONBOARDING_CLAUSES.map((c) => c.key)), 5)}
              className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Accept and continue'}
            </button>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">6. E-signature</h2>
            <div className="flex gap-2">
              {(['typed', 'canvas'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSigMode(m)}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                    sigMode === m ? 'bg-emerald-700 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {m === 'typed' ? 'Type name' : 'Draw signature'}
                </button>
              ))}
            </div>
            {sigMode === 'typed' ? (
              <div>
                <label className={labelCls} htmlFor="ob-sign">Type your full name as your signature</label>
                <input
                  id="ob-sign"
                  className={`${inputCls} font-serif text-xl italic`}
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder="Jane Kamau"
                />
              </div>
            ) : (
              <div>
                <canvas
                  ref={canvasRef}
                  className="w-full cursor-crosshair rounded-md border border-gray-300 bg-white touch-none"
                  style={{ height: 160 }}
                  onMouseDown={startDraw}
                  onMouseMove={draw}
                  onMouseUp={endDraw}
                  onMouseLeave={endDraw}
                  onTouchStart={startDraw}
                  onTouchMove={draw}
                  onTouchEnd={endDraw}
                />
                <button type="button" onClick={clearCanvas} className="mt-2 text-sm text-gray-600 hover:underline">
                  Clear
                </button>
              </div>
            )}
            <button
              disabled={saving}
              onClick={handleSignatureSubmit}
              className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {saving ? 'Finishing...' : 'Sign and finish'}
            </button>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-4 text-center">
            <h2 className="text-lg font-semibold">Onboarding complete</h2>
            {finalStatus === 'active' ? (
              <p className="text-sm text-gray-600">
                Your membership is now <strong className="text-emerald-700">active</strong>. You can
                raise cases once your waiting period ends.
              </p>
            ) : (
              <p className="text-sm text-gray-600">
                Your documents were received and your membership is <strong>pending</strong> review.
                You will be activated once an administrator approves your KYC documents.
              </p>
            )}
            <Link
              href="/member"
              className="inline-block rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              Go to dashboard
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
