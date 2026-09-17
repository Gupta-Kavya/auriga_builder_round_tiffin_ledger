import { parseDate } from './billing.js';

export function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

export function normalizeDate(value) {
  const raw = String(value ?? '').trim();
  if (parseDate(raw)) return raw;
  const yearFirst = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/.exec(raw);
  if (yearFirst) {
    const date = `${yearFirst[1]}-${yearFirst[2].padStart(2, '0')}-${yearFirst[3].padStart(2, '0')}`;
    return parseDate(date) ? date : null;
  }
  const match = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(raw);
  if (match) {
    // Ambiguous dates follow DD/MM/YYYY; 09/17/2026 is unambiguously MM/DD/YYYY.
    let [, d, m, y] = match;
    if (Number(m) > 12 && Number(d) <= 12) [d, m] = [m, d];
    const date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    return parseDate(date) ? date : null;
  }
  return null;
}

export function parseCsv(csv) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') { if (quoted && csv[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && csv[i + 1] === '\n') i++;
      row.push(cell); if (row.some(v => v.trim())) rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  row.push(cell); if (row.some(v => v.trim())) rows.push(row);
  const [headers, ...data] = rows;
  if (!headers) return [];
  return data.map(cells => Object.fromEntries(headers.map((h, index) => [h.trim(), cells[index]?.trim() || ''])));
}

export function cleanImportRow(row) {
  const fields = Object.fromEntries(Object.entries(row).map(([key, val]) => [key.toLowerCase().replace(/[^a-z]/g, ''), val]));
  const value = (...keys) => keys.map(k => fields[k]).find(v => v !== undefined && v !== null && String(v).trim()) ?? '';
  const name = String(value('name', 'customer', 'customername')).trim();
  const phone = normalizePhone(value('phone', 'mobile', 'phonenumber'));
  const address = String(value('address', 'deliveryaddress')).trim();
  const monthlyPrice = Number(String(value('monthlyprice', 'price', 'planprice')).replace(/[₹,\s]/g, ''));
  const startDate = normalizeDate(value('startdate', 'start', 'subscriptiondate'));
  if (!name || !/^[0-9]{10}$/.test(phone) || !address || !Number.isFinite(monthlyPrice) || monthlyPrice <= 0 || !startDate)
    return null;
  return { name, phone, address, monthlyPrice, startDate, pauses: [], holders: [{ name, phone, address, startDate }] };
}
