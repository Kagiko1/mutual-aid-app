/**
 * GET /api/reports?type=members|cases|invoices|payments|dependents|attendance&format=csv|pdf
 *
 * Admin-only. Streams a CSV (text/csv) or a simple PDF (application/pdf) as a
 * download. PDF reports are intentionally simple: title + one line per row.
 */
import { NextRequest } from 'next/server';
import PDFDocument from 'pdfkit';
import { requireAdmin, handleGuardError } from '@/lib/guard';
import { getOrgConfig } from '@/lib/org';

export const dynamic = 'force-dynamic';

type ReportType = 'members' | 'cases' | 'invoices' | 'payments' | 'dependents' | 'attendance';

const REPORTS: Record<ReportType, { table: string; columns: string[]; label: string }> = {
  members: {
    table: 'profiles',
    columns: ['id', 'full_name', 'email', 'phone', 'national_id', 'role', 'status', 'joined_at'],
    label: 'Members',
  },
  cases: {
    table: 'cases',
    columns: ['id', 'member_id', 'case_type', 'deceased_name', 'death_date', 'status', 'benefit_amount', 'created_at'],
    label: 'Cases',
  },
  invoices: {
    table: 'invoices',
    columns: ['id', 'member_id', 'case_id', 'amount', 'status', 'strategy', 'due_date', 'paid_at', 'created_at'],
    label: 'Invoices',
  },
  payments: {
    table: 'payments',
    columns: ['id', 'member_id', 'invoice_id', 'amount', 'channel', 'mpesa_receipt', 'status', 'paid_at', 'created_at'],
    label: 'Payments',
  },
  dependents: {
    table: 'dependents',
    columns: ['id', 'member_id', 'full_name', 'kinship_type', 'national_id', 'verification_status', 'created_at'],
    label: 'Dependents',
  },
  attendance: {
    table: 'attendance',
    columns: ['id', 'event_id', 'member_id', 'attended_at'],
    label: 'Attendance',
  },
};

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map(csvEscape).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvEscape(row[c])).join(','));
  return lines.join('\n');
}

function toPdfBuffer(title: string, columns: string[], rows: Record<string, unknown>[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4', layout: 'landscape' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(16).text(title);
    doc.fontSize(9).text(`Generated ${new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })} — ${rows.length} rows`);
    doc.moveDown();
    doc.font('Courier').fontSize(8);
    doc.text(columns.join(' | '));
    doc.text('-'.repeat(120));
    for (const row of rows) {
      const line = columns.map((c) => String(row[c] ?? '')).join(' | ');
      if (doc.y > 520) doc.addPage();
      doc.text(line.slice(0, 220));
    }
    doc.end();
  });
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireAdmin();
    const type = request.nextUrl.searchParams.get('type') as ReportType | null;
    const format = request.nextUrl.searchParams.get('format') ?? 'csv';

    if (!type || !(type in REPORTS)) {
      return Response.json(
        { error: `type must be one of: ${Object.keys(REPORTS).join(', ')}` },
        { status: 400 },
      );
    }
    if (!['csv', 'pdf'].includes(format)) {
      return Response.json({ error: "format must be 'csv' or 'pdf'" }, { status: 400 });
    }

    const { table, columns, label } = REPORTS[type];
    const { data, error } = await admin.from(table).select(columns.join(',')).limit(1000);
    if (error) return Response.json({ error: 'failed to load report data', message: error.message }, { status: 500 });
    const rows = (data ?? []) as unknown as Record<string, unknown>[];

    const org = await getOrgConfig(admin);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${type}-report-${stamp}`;

    if (format === 'pdf') {
      const buffer = await toPdfBuffer(`${org.orgName} — ${label} report`, columns, rows);
      return new Response(new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}.pdf"`,
        },
      });
    }

    const csv = toCsv(columns, rows);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
      },
    });
  } catch (e) {
    return handleGuardError(e);
  }
}
