/**
 * GET /api/vouchers/[id]/pdf
 *
 * Generates the voucher PDF (pdfkit), stores it in the private `vouchers`
 * bucket at vouchers/{voucher_no}.pdf, updates vouchers.pdf_storage_path,
 * and streams the PDF back with Content-Type application/pdf.
 *
 * Access: admins, or the member who owns the voucher's case.
 */
import { NextRequest } from 'next/server';
import PDFDocument from 'pdfkit';
import { requireMember, handleGuardError } from '@/lib/guard';
import { getOrgConfig } from '@/lib/org';
import { formatMoney } from '@/lib/money';
import { splitBeneficiaries } from '@/lib/engines/beneficiarySplit';

function renderVoucherPdf(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireMember(request);
    const { userId, profile, admin } = ctx;

    const { data: voucher } = await admin.from('vouchers').select('*').eq('id', params.id).eq('org_id', ctx.orgId).single();
    if (!voucher) return Response.json({ error: 'voucher not found' }, { status: 404 });

    const { data: theCase } = await admin.from('cases').select('*').eq('id', voucher.case_id).eq('org_id', ctx.orgId).single();
    if (!theCase) return Response.json({ error: 'case not found' }, { status: 404 });
    if (profile.role !== 'admin' && theCase.member_id !== userId) {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }

    const { data: beneficiaries } = await admin
      .from('beneficiaries')
      .select('*')
      .eq('member_id', theCase.member_id);
    const bens = (beneficiaries ?? []) as { id: string; full_name: string; percentage: number | string }[];

    const org = await getOrgConfig(admin, ctx.orgId);
    let rows: { name: string; pct: number; amount: number }[] = [];
    if (bens.length > 0) {
      const allocs = splitBeneficiaries(
        voucher.amount,
        bens.map((b) => ({ id: b.id, percentage: Number(b.percentage) })),
      );
      const byId = Object.fromEntries(allocs.map((a) => [a.beneficiaryId, a.amountMinor]));
      rows = bens.map((b) => ({
        name: b.full_name,
        pct: Number(b.percentage),
        amount: byId[b.id] ?? 0,
      }));
    }

    const issuedAt = new Date(voucher.issued_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });

    const buffer = await renderVoucherPdf((doc) => {
      doc.fontSize(20).text(org.orgName, { align: 'center' });
      doc.fontSize(12).text('Benefit Voucher', { align: 'center' });
      doc.moveDown();

      doc.fontSize(11);
      doc.text(`Voucher No: ${voucher.voucher_no}`);
      doc.text(`Issued: ${issuedAt}`);
      doc.text(`Case: ${theCase.case_type} — ${theCase.deceased_name}`);
      doc.text(`Benefit amount: ${formatMoney(voucher.amount, voucher.currency_code)}`);
      doc.moveDown();

      doc.fontSize(13).text('Beneficiary split', { underline: true });
      doc.fontSize(11);
      const top = doc.y + 6;
      const colName = 56, colPct = 340, colAmt = 430;
      doc.text('Beneficiary', colName, top, { continued: false });
      doc.text('%', colPct, top);
      doc.text('Amount', colAmt, top);
      let y = top + 18;
      for (const r of rows) {
        if (y > 740) { doc.addPage(); y = 80; }
        doc.text(r.name, colName, y);
        doc.text(r.pct.toFixed(2), colPct, y);
        doc.text(formatMoney(r.amount, voucher.currency_code), colAmt, y);
        y += 18;
      }
      doc.moveDown(2);
      doc.fontSize(11).text(`Total: ${formatMoney(voucher.amount, voucher.currency_code)}`);
      doc.moveDown(3);
      doc.text('Authorised signature: ______________________________');
      doc.text(`Voucher ${voucher.voucher_no} — generated ${issuedAt}`);
    });

    const storagePath = `vouchers/${voucher.voucher_no}.pdf`;
    const { error: uploadErr } = await admin.storage
      .from('vouchers')
      .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: true });
    if (uploadErr) {
      return Response.json({ error: 'failed to store voucher pdf', message: uploadErr.message }, { status: 500 });
    }
    await admin.from('vouchers').update({ pdf_storage_path: storagePath }).eq('id', voucher.id);

    return new Response(new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${voucher.voucher_no}.pdf"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (e) {
    return handleGuardError(e);
  }
}
