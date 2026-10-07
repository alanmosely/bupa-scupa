export function parseCsv(text) {
  text = text.replace(/^\ufeff/, '');
  const rows = [];
  let field = '';
  let row = [];
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  if (inQ) throw new Error('Unterminated quoted CSV field.');
  const header = rows.shift();
  if (!header || new Set(header).size !== header.length)
    throw new Error('Missing or duplicate CSV headers.');
  return rows
    .filter((r) => r.length > 1 || (r[0] ?? '') !== '')
    .map((r) => {
      if (r.length !== header.length) throw new Error('CSV row has an unexpected field count.');
      return Object.fromEntries(header.map((h, i) => [h, r[i]]));
    });
}

export function toCsv(rows, headers) {
  const esc = (v) => {
    v = String(v ?? '');
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  return (
    [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n') +
    '\n'
  );
}
