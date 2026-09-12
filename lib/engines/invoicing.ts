/**
 * invoicing — per-member invoicing when a welfare case is approved.
 * Strategies:
 *   flat         -> every active member is invoiced a fixed fee; any amount
 *                   collected above the benefit becomes surplus -> reserve fund.
 *   proportional -> the benefit amount is split evenly across active members
 *                   (largest-remainder for rounding); surplus is always 0.
 * Money in minor units (integer).
 */

export type InvoicingStrategy = 'flat' | 'proportional';

export interface CaseInvoiceInput {
  strategy: InvoicingStrategy;
  flatFeeMinor: number;
  benefitAmountMinor: number;
  /** Active members to invoice (deceased excluded by caller). */
  memberIds: string[];
}

export interface MemberInvoice {
  memberId: string;
  amountMinor: number;
}

export interface CaseInvoiceResult {
  invoices: MemberInvoice[];
  totalInvoicedMinor: number;
  surplusToReserveMinor: number;
}

export function computeCaseInvoices(input: CaseInvoiceInput): CaseInvoiceResult {
  const { strategy, flatFeeMinor, benefitAmountMinor, memberIds } = input;
  if (memberIds.length === 0) throw new Error('No active members to invoice');
  if (flatFeeMinor < 0 || benefitAmountMinor <= 0) {
    throw new Error('Invalid fee/benefit amounts');
  }

  let invoices: MemberInvoice[];
  if (strategy === 'flat') {
    invoices = memberIds.map((memberId) => ({ memberId, amountMinor: flatFeeMinor }));
  } else {
    // proportional: split benefit evenly, largest-remainder on rounding
    const per = Math.floor(benefitAmountMinor / memberIds.length);
    let leftover = benefitAmountMinor - per * memberIds.length;
    invoices = memberIds.map((memberId, i) => ({
      memberId,
      amountMinor: per + (i < leftover ? 1 : 0),
    }));
  }

  const totalInvoicedMinor = invoices.reduce((a, i) => a + i.amountMinor, 0);
  const surplusToReserveMinor = Math.max(0, totalInvoicedMinor - benefitAmountMinor);

  return { invoices, totalInvoicedMinor, surplusToReserveMinor };
}
