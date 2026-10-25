function parseCsv(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('CSV content is empty');
  }
  if (text.length > 1024 * 1024) {
    throw new Error('CSV file must be 1 MB or smaller');
  }

  const matrix = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) matrix.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field');
  row.push(field);
  if (row.some((cell) => cell.trim())) matrix.push(row);
  if (matrix.length < 2) throw new Error('CSV must include a header and at least one employee row');

  const headers = matrix[0].map((header) => header.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  if (new Set(headers).size !== headers.length) throw new Error('CSV contains duplicate column names');
  const required = ['name', 'email', 'employee_code', 'department', 'join_date', 'base_salary'];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`CSV is missing required columns: ${missing.join(', ')}`);

  return matrix.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, (cells[index] || '').trim()])));
}

module.exports = { parseCsv };
