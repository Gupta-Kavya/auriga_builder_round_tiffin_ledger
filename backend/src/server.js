import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Owner, Customer, Notification } from './models.js';
import { calculateBill, currentStatus, dueToday, holderOn, parseDate, today } from './billing.js';
import { cleanImportRow, normalizePhone, parseCsv } from './import.js';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());
const fail = (res, code, message) => res.status(code).json({ error: message });
const clean = value => typeof value === 'string' ? value.trim() : '';
const publicCustomer = c => ({ ...c.toObject(), status: currentStatus(c) });

function auth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.ownerId = payload.id;
    next();
  } catch { fail(res, 401, 'Please log in again'); }
}
const sign = owner => jwt.sign({ id: owner.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
const ownCustomer = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) { fail(res, 400, 'Invalid customer ID'); return null; }
  const customer = await Customer.findOne({ _id: req.params.id, owner: req.ownerId });
  if (!customer) fail(res, 404, 'Customer not found');
  return customer;
};

app.get('/api/health', (_req, res) => res.json({ ok: true }));
// Assessment clock and local Notification Service outbox. One notification per subscription per date.
async function clock(req, res, next) {
  try {
    const date = clean(req.body?.date) || today();
    if (!parseDate(date)) return fail(res, 400, 'Date must be YYYY-MM-DD');
    const customers = await Customer.find({ startDate: { $lte: date } });
    let notified = 0;
    for (const customer of customers) {
      if (!dueToday(customer, date)) continue;
      const holder = holderOn(customer, date);
      const message = `Hi ${holder.name}, your tiffin lunch is due for delivery today (${date}).`;
      const result = await Notification.updateOne({ customer: customer._id, date },
        { $setOnInsert: { owner: customer.owner, phone: holder.phone, message } }, { upsert: true });
      if (result.upsertedCount) notified++;
    }
    res.json({ date, notified });
  } catch (error) { next(error); }
}
async function outbox(req, res, next) {
  try {
    const date = clean(req.query.date);
    if (date && !parseDate(date)) return fail(res, 400, 'Date must be YYYY-MM-DD');
    const notifications = await Notification.find(date ? { date } : {}).sort({ date: 1, phone: 1 }).lean();
    res.json(notifications.map(n => ({ date: n.date, phone: n.phone, message: n.message, customerId: String(n.customer) })));
  } catch (error) { next(error); }
}
app.post(['/clock', '/api/clock'], clock);
app.get(['/outbox', '/api/outbox'], outbox);
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const name = clean(req.body.name), email = clean(req.body.email).toLowerCase(), password = req.body.password;
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || typeof password !== 'string' || password.length < 8)
      return fail(res, 400, 'Enter a name, valid email and password of at least 8 characters');
    const owner = await Owner.create({ name, email, passwordHash: await bcrypt.hash(password, 10) });
    res.status(201).json({ token: sign(owner), owner: { name: owner.name, email: owner.email } });
  } catch (error) { if (error.code === 11000) return fail(res, 409, 'Email already registered'); next(error); }
});
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const owner = await Owner.findOne({ email: clean(req.body.email).toLowerCase() });
    if (!owner || !await bcrypt.compare(req.body.password || '', owner.passwordHash)) return fail(res, 401, 'Incorrect email or password');
    res.json({ token: sign(owner), owner: { name: owner.name, email: owner.email } });
  } catch (error) { next(error); }
});

app.get('/api/customers', auth, async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const sortField = ['name', 'phone', 'startDate', 'monthlyPrice', 'createdAt'].includes(req.query.sort) ? req.query.sort : 'name';
    const order = req.query.order === 'desc' ? -1 : 1;
    const q = clean(req.query.q);
    const filter = { owner: req.ownerId };
    if (q) filter.$or = [{ name: { $regex: escapeRegExp(q), $options: 'i' } }, { phone: { $regex: escapeRegExp(q), $options: 'i' } }];
    const [items, total] = await Promise.all([Customer.find(filter).sort({ [sortField]: order, _id: 1 }).skip((page - 1) * limit).limit(limit), Customer.countDocuments(filter)]);
    res.json({ items: items.map(publicCustomer), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) { next(error); }
});
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
app.post('/api/customers', auth, async (req, res, next) => {
  try {
    const name = clean(req.body.name), phone = clean(req.body.phone), address = clean(req.body.address);
    const monthlyPrice = Number(req.body.monthlyPrice), startDate = clean(req.body.startDate);
    if (!name || !/^[+\d][\d\s()-]{6,19}$/.test(phone) || !address || !Number.isFinite(monthlyPrice) || monthlyPrice <= 0 || !parseDate(startDate))
      return fail(res, 400, 'Enter a name, phone, address, positive monthly price and valid start date');
    const customer = await Customer.create({ owner: req.ownerId, name, phone, address, monthlyPrice, startDate, pauses: [], holders: [{ name, phone, address, startDate }] });
    res.status(201).json(publicCustomer(customer));
  } catch (error) { if (error.code === 11000) return fail(res, 409, 'Phone already belongs to a customer'); next(error); }
});
app.get('/api/customers/:id', auth, async (req, res, next) => {
  try { const c = await ownCustomer(req, res); if (c) res.json(publicCustomer(c)); } catch (error) { next(error); }
});
app.post('/api/customers/:id/transfer', auth, async (req, res, next) => {
  try {
    const c = await ownCustomer(req, res); if (!c) return;
    const name = clean(req.body.name), phone = normalizePhone(req.body.phone), address = clean(req.body.address);
    const effectiveDate = clean(req.body.effectiveDate);
    const holders = c.holders.length ? c.holders : [{ name: c.name, phone: c.phone, address: c.address, startDate: c.startDate }];
    const last = holders[holders.length - 1];
    if (!name || !/^[0-9]{10}$/.test(phone) || !address || !parseDate(effectiveDate) || effectiveDate <= last.startDate || effectiveDate > today())
      return fail(res, 400, 'Enter new customer details and a transfer date after the current holder started, no later than today');
    if (phone === normalizePhone(c.phone)) return fail(res, 409, 'New customer must have a different phone');
    const duplicate = await Customer.findOne({ owner: req.ownerId, phone, _id: { $ne: c._id } });
    if (duplicate) return fail(res, 409, 'Phone already belongs to another subscription');
    if (!c.holders.length) c.holders.push(last);
    c.holders[c.holders.length - 1].endDate = new Date(parseDate(effectiveDate).getTime() - 86400000).toISOString().slice(0, 10);
    c.holders.push({ name, phone, address, startDate: effectiveDate });
    c.name = name; c.phone = phone; c.address = address;
    await c.save(); res.json(publicCustomer(c));
  } catch (error) { if (error.code === 11000) return fail(res, 409, 'Phone already belongs to another subscription'); next(error); }
});
app.post('/api/customers/import', auth, async (req, res, next) => {
  try {
    let rows;
    if (typeof req.body.csv === 'string') rows = parseCsv(req.body.csv);
    else if (Array.isArray(req.body.rows)) rows = req.body.rows;
    else return fail(res, 400, 'Provide csv text or a rows array');
    if (rows.length > 500) return fail(res, 400, 'Import at most 500 rows at a time');
    const existing = await Customer.find({ owner: req.ownerId }).select('phone').lean();
    const seen = new Set(existing.map(c => normalizePhone(c.phone)));
    const report = { imported: 0, deduped: 0, rejected: 0, errors: [] };
    for (const [index, row] of rows.entries()) {
      const cleanRow = row && typeof row === 'object' ? cleanImportRow(row) : null;
      if (!cleanRow) { report.rejected++; report.errors.push({ row: index + 1, reason: 'Missing or invalid name, phone, address, price, or start date' }); continue; }
      if (seen.has(cleanRow.phone)) { report.deduped++; continue; }
      try { await Customer.create({ ...cleanRow, owner: req.ownerId }); seen.add(cleanRow.phone); report.imported++; }
      catch (error) { if (error.code === 11000) { seen.add(cleanRow.phone); report.deduped++; } else throw error; }
    }
    res.json(report);
  } catch (error) { if (error.message === 'Unclosed CSV quote') return fail(res, 400, error.message); next(error); }
});
app.post('/api/customers/:id/pause', auth, async (req, res, next) => {
  try {
    const c = await ownCustomer(req, res); if (!c) return;
    const startDate = clean(req.body.startDate), endDate = req.body.endDate ? clean(req.body.endDate) : null;
    if (!parseDate(startDate) || (endDate && (!parseDate(endDate) || endDate < startDate)) || startDate < c.startDate)
      return fail(res, 400, 'Choose valid pause dates on or after subscription start');
    if (c.pauses.some(p => startDate <= (p.endDate || '9999-12-31') && p.startDate <= (endDate || '9999-12-31')))
      return fail(res, 409, 'Pause overlaps an existing pause');
    c.pauses.push({ startDate, endDate }); await c.save(); res.json(publicCustomer(c));
  } catch (error) { next(error); }
});
app.post('/api/customers/:id/resume', auth, async (req, res, next) => {
  try {
    const c = await ownCustomer(req, res); if (!c) return;
    const resumeDate = clean(req.body.resumeDate) || today();
    if (!parseDate(resumeDate)) return fail(res, 400, 'Invalid resume date');
    const pause = c.pauses.find(p => !p.endDate && p.startDate <= resumeDate);
    if (!pause) return fail(res, 409, 'No open pause to resume');
    const prior = new Date(parseDate(resumeDate).getTime() - 86400000).toISOString().slice(0, 10);
    if (prior < pause.startDate) c.pauses.pull(pause._id);
    else pause.endDate = prior;
    await c.save(); res.json(publicCustomer(c));
  } catch (error) { next(error); }
});
app.get('/api/customers/:id/bill', auth, async (req, res, next) => {
  try {
    const c = await ownCustomer(req, res); if (!c) return;
    const month = clean(req.query.month) || today().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail(res, 400, 'Month must be YYYY-MM');
    res.json({ customer: { name: c.name, phone: c.phone }, ...calculateBill(c, month) });
  } catch (error) { next(error); }
});
app.use((error, _req, res, _next) => { console.error(error); fail(res, 500, 'Something went wrong'); });

const port = Number(process.env.PORT) || 4000;
if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
  console.error('Set MONGODB_URI and JWT_SECRET in backend/.env'); process.exit(1);
}
mongoose.connect(process.env.MONGODB_URI).then(() => app.listen(port, () => console.log(`API listening on ${port}`))).catch(error => { console.error(error); process.exit(1); });
