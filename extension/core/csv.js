const CSV_HEADERS = [
  'contributor_login',
  'email',
  'source_type',
  'source_url',
  'extracted_at'
];

function escapeCsvValue(value) {
  const text = value == null ? '' : String(value);
  const safeText = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  if (!/[",\n\r]/.test(safeText)) {
    return safeText;
  }
  return `"${safeText.replace(/"/g, '""')}"`;
}

export function serializeRows(rows = []) {
  const header = CSV_HEADERS.join(',');
  const body = rows.map((row) => CSV_HEADERS.map((key) => escapeCsvValue(row?.[key])).join(',')).join('\n');
  return body ? `${header}\n${body}` : header;
}

export { CSV_HEADERS };
