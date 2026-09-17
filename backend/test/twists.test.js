import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBill, dueToday, holderOn } from '../src/billing.js';
import { cleanImportRow, normalizeDate, normalizePhone, parseCsv } from '../src/import.js';

test('only active, unpaused weekday subscriptions are due', () => {
  const c = { name: 'A', phone: '9876543210', startDate: '2026-09-01', pauses: [{ startDate: '2026-09-17', endDate: '2026-09-18' }] };
  assert.equal(dueToday(c, '2026-09-16'), true);
  assert.equal(dueToday(c, '2026-09-17'), false);
  assert.equal(dueToday(c, '2026-09-19'), false);
  assert.equal(dueToday(c, '2026-08-31'), false);
});

test('transfer assigns effective date to new holder and splits bill', () => {
  const c = { name: 'New', phone: '9999999999', startDate: '2026-09-01', monthlyPrice: 2200, pauses: [], holders: [
    { name: 'Old', phone: '9876543210', startDate: '2026-09-01', endDate: '2026-09-14' },
    { name: 'New', phone: '9999999999', startDate: '2026-09-15', endDate: null }
  ] };
  const bill = calculateBill(c, '2026-09', '2026-10-01');
  assert.equal(holderOn(c, '2026-09-14').name, 'Old');
  assert.equal(holderOn(c, '2026-09-15').name, 'New');
  assert.deepEqual(bill.splits.map(s => [s.name, s.deliveredDays, s.amount]), [['Old', 10, 1000], ['New', 12, 1200]]);
  assert.equal(bill.amount, 2200);
});

test('messy CSV normalizes phones and dates but rejects blanks', () => {
  const rows = parseCsv('name,phone,address,monthlyPrice,startDate\n"A, B",+91 98765 43210,"Flat 1, Road",₹2,200,17/09/2026\n');
  // Prices with commas must be quoted in CSV.
  assert.equal(cleanImportRow(rows[0]), null);
  const parsed = parseCsv('name,phone,address,monthlyPrice,startDate\n"A, B",+91 98765 43210,"Flat 1, Road","₹2,200",17/09/2026\n');
  assert.deepEqual(cleanImportRow(parsed[0]).phone, '9876543210');
  assert.equal(cleanImportRow(parsed[0]).startDate, '2026-09-17');
  assert.equal(normalizePhone('(987) 654-3210'), '9876543210');
  assert.equal(normalizeDate('31/02/2026'), null);
  assert.equal(normalizeDate('09/17/2026'), '2026-09-17');
  assert.equal(normalizeDate('2026/9/17'), '2026-09-17');
  assert.equal(cleanImportRow({ name: 'A', phone: '9876543210' }), null);
});
