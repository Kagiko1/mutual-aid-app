/** Consent clause definitions used during member onboarding. */
export interface ConsentClause {
  key: string;
  title: string;
  text: string;
}

export const ONBOARDING_CLAUSES: ConsentClause[] = [
  {
    key: 'constitution',
    title: 'Association Constitution',
    text: 'I have read and accept the Umoja Welfare Association constitution, including membership duties, meeting attendance expectations, and the disciplinary process.',
  },
  {
    key: 'data_processing',
    title: 'Data Processing Consent',
    text: 'I consent to the association collecting and processing my personal data (identity details, dependents, beneficiaries, and uploaded documents) for membership administration, claims processing, and regulatory compliance.',
  },
  {
    key: 'contribution_terms',
    title: 'Contribution Terms',
    text: 'I agree to pay all levied contributions and case invoices by their due dates, and I understand that unpaid invoices may lead to suspension or ineligibility for benefits until arrears are cleared.',
  },
];
