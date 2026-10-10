import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
// Entirely synthetic. No portal captures or personal records belong in this file.
export const REF = 'CL000101000001';
export const OTHER = 'CL000101000002';
// Model an explicit human decision for synthetic fixtures, never production imports.
export function approveAssessment(directory, filename) {
  const file = path.join(directory, 'document-reviews.json');
  const reviews = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : { schemaVersion: 1, supporting: {} };
  reviews.assessments ??= {};
  delete reviews.supporting[filename];
  reviews.assessments[filename] = {
    sha256: crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(directory, filename)))
      .digest('hex'),
    reviewedAt: '2000-01-02T00:00:00.000Z',
  };
  fs.writeFileSync(file, JSON.stringify(reviews));
}
export function statement({
  ref = REF,
  claimed = '100.00',
  paid = '80.00',
  extra = '',
  provider = 'Example Clinic',
  date = '02/01/2000',
} = {}) {
  return `Payment date: ${date}\nFor Claim ${ref}\nFor treatment at ${provider} (provider invoice DEMO-1)\n01/01/2000    Specialist consultation    £${claimed}    £${paid}\nTotal payment made to you    £${paid}\n${extra}`;
}
export function convertedStatement({
  ref = REF,
  from = 'EUR',
  to = 'GBP',
  nonPayable = true,
} = {}) {
  return `Payment date: 02/01/2000
We have converted your claim into the currency that your health plan is paid in.
For Claim ${ref}
For treatment at Example Clinic (provider invoice DEMO-1)
                                          Amount excl.
Treatment date    Benefit or deduction    tax/discount    Amount (${from})    Amount (${to})
                                          (${from})
01/01/2000    Specialist consultation    100.00    80.00    64.00
${nonPayable ? '01/01/2000    Non Payable Item    20.00    20.00    16.00\nWe are unable to pay this cost.    -20.00    -16.00\n' : ''}Total payment made to you    80.00    64.00
How we calculate the currency conversion
Payment amount    ${to} 64.00`;
}
export function syntheticPdf(text) {
  const escape = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream =
    'BT /F1 10 Tf 50 790 Td 14 TL\n' +
    text
      .split('\n')
      .map((line) => '(' + escape(line) + ') Tj T*')
      .join('\n') +
    '\nET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(content, 'latin1'));
    content += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(content, 'latin1');
  content += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => String(o).padStart(10, '0') + ' 00000 n ')
    .join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(content, 'latin1');
}
