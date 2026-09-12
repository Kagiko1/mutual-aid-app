import Link from "next/link";

const features = [
  {
    title: "Member onboarding",
    body: "Six-step wizard: profile, dependents, fractional beneficiary allocation, KYC documents, consent clauses and e-signature — with admin review.",
  },
  {
    title: "Welfare cases",
    body: "Raise a claim, track review → approval → voucher → disbursement, with double-payout detection and claim checklists.",
  },
  {
    title: "Contributions via M-Pesa",
    body: "Per-case invoicing, STK push self-service payments, automated T+4 / T+6 / T+7 collection drip and a full welfare ledger.",
  },
  {
    title: "Governance",
    body: "Anonymous SHA-256-hashed ballots, certified results, events with attendance tracking and leadership contacts.",
  },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <div className="max-w-2xl">
        <h1 className="text-4xl font-bold text-gray-900">
          Mutual aid, run by the members it protects.
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          Umoja Welfare pools member contributions to pay out fast, transparent welfare
          benefits — with audited ledgers, fractional beneficiary payouts and
          democratic governance built in.
        </p>
        <div className="mt-8 flex gap-3">
          <Link
            href="/login"
            className="rounded bg-emerald-700 px-5 py-2.5 text-white hover:bg-emerald-800"
          >
            Sign in
          </Link>
          <Link
            href="/member"
            className="rounded border border-emerald-700 px-5 py-2.5 text-emerald-800 hover:bg-emerald-50"
          >
            Member portal
          </Link>
        </div>
      </div>
      <div className="mt-16 grid gap-6 sm:grid-cols-2">
        {features.map((f) => (
          <div key={f.title} className="rounded-lg border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">{f.title}</h2>
            <p className="mt-2 text-sm text-gray-600">{f.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
