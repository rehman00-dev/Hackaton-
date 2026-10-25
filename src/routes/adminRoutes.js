const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles, requireUserScope } = require('../middleware/auth');
const { apiDocument, collection, currentTimestamp, objectId, withTransaction } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const { localDate } = require('../utils/dateUtils');
const { createUser } = require('../services/authService');
const { audit } = require('../services/auditService');

router.use(authenticateToken, requireUserScope, authorizeRoles('admin'));

router.get('/dashboard', asyncHandler(async (req, res) => {
  const today = localDate();
  const [headcount, departmentRows, payroll, todayAttendance, pendingApprovals, lateToday] = await Promise.all([
    collection('users').countDocuments({ role: 'employee', is_active: 1 }),
    collection('departments').find().sort({ name_folded: 1 }).toArray(),
    collection('payrollRuns').aggregate([
      { $match: { status: 'finalized' } },
      { $group: { _id: null, total: { $sum: '$net_salary' } } }
    ]).toArray(),
    collection('attendance').find({ date: today }, { projection: { status: 1 } }).toArray(),
    collection('leaveRequests').countDocuments({ status: 'pending' }),
    collection('attendance').countDocuments({ date: today, status: 'late' })
  ]);
  const departmentIds = departmentRows.map((department) => String(department._id));
  const employeeCounts = departmentIds.length
    ? await collection('users').aggregate([
      { $match: { role: 'employee', is_active: 1, department_id: { $in: departmentIds } } },
      { $group: { _id: '$department_id', count: { $sum: 1 } } }
    ]).toArray()
    : [];
  const countByDepartment = new Map(employeeCounts.map((row) => [row._id, row.count]));
  res.json({
    headcount,
    payrollCost: payroll[0]?.total || 0,
    pendingApprovals,
    presentToday: todayAttendance.filter((row) => ['present', 'late', 'missing_checkout', 'half_day'].includes(row.status)).length,
    lateToday,
    departments: departmentRows.map((department) => ({ name: department.name, count: countByDepartment.get(String(department._id)) || 0 }))
  });
}));

router.get('/company', asyncHandler(async (req, res) => {
  const company = await collection('companies').findOne({}, { sort: { _id: -1 } });
  res.json({ company: apiDocument(company) || null });
}));

router.put('/company', asyncHandler(async (req, res) => {
  const { name, officeHours, graceMinutes, weekend, officeLocation, officeRadiusMeters, officeLatitude, officeLongitude } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ message: 'Company name is required' });
  if (officeHours && !/^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/.test(officeHours)) {
    return res.status(400).json({ message: 'Office hours must use HH:MM-HH:MM format' });
  }
  if (weekend && !['SAT-SUN', 'FRI-SAT', 'SUN'].includes(weekend)) {
    return res.status(400).json({ message: 'Choose a supported weekend schedule' });
  }
  const grace = Number(graceMinutes ?? 15);
  const radius = Number(officeRadiusMeters ?? 150);
  if (!Number.isInteger(grace) || grace < 0 || grace > 240 || !Number.isFinite(radius) || radius < 1 || radius > 10000) {
    return res.status(400).json({ message: 'Grace minutes or office radius is invalid' });
  }
  const latitude = officeLatitude === '' || officeLatitude == null ? null : Number(officeLatitude);
  const longitude = officeLongitude === '' || officeLongitude == null ? null : Number(officeLongitude);
  if (latitude !== null && (!Number.isFinite(latitude) || Math.abs(latitude) > 90)) {
    return res.status(400).json({ message: 'Office latitude is invalid' });
  }
  if (longitude !== null && (!Number.isFinite(longitude) || Math.abs(longitude) > 180)) {
    return res.status(400).json({ message: 'Office longitude is invalid' });
  }
  const values = {
    name: String(name).trim(),
    office_hours: officeHours || '09:00-17:00',
    grace_minutes: grace,
    weekend: weekend || 'SAT-SUN',
    office_location: officeLocation || '',
    office_radius_meters: radius,
    office_latitude: latitude,
    office_longitude: longitude
  };
  const companies = collection('companies');
  const company = await companies.findOne({}, { sort: { _id: -1 } });
  if (company) {
    await companies.updateOne({ _id: company._id }, { $set: values });
  } else {
    await companies.insertOne({ ...values, singleton_key: 'primary', created_at: currentTimestamp() });
  }
  await audit(req.user.id, 'company.updated', 'company', { name: values.name });
  res.json({ message: 'Company settings saved' });
}));

router.get('/leave-types', asyncHandler(async (req, res) => {
  const rows = await collection('leaveTypes').find().sort({ name_folded: 1 }).toArray();
  res.json(rows.map(apiDocument));
}));

router.post('/leave-types', asyncHandler(async (req, res) => {
  const { name, annualQuota, paid = true } = req.body;
  const normalizedName = String(name || '').trim();
  if (!normalizedName || (annualQuota !== null && annualQuota !== '' && (!Number.isInteger(Number(annualQuota)) || Number(annualQuota) < 0))) {
    return res.status(400).json({ message: 'A valid leave type name and quota are required' });
  }
  const leaveTypes = collection('leaveTypes');
  if (await leaveTypes.findOne({ name_folded: normalizedName.toLowerCase() })) {
    return res.status(409).json({ message: 'That leave type already exists' });
  }
  try {
    const result = await leaveTypes.insertOne({
      name: normalizedName,
      name_folded: normalizedName.toLowerCase(),
      annual_quota: annualQuota === null || annualQuota === '' ? null : Number(annualQuota),
      paid: paid ? 1 : 0,
      created_at: currentTimestamp()
    });
    await audit(req.user.id, 'leave_type.created', 'leave_type', { id: String(result.insertedId), name: normalizedName });
    res.status(201).json({ id: String(result.insertedId), name: normalizedName });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'That leave type already exists' });
    throw error;
  }
}));

router.get('/holidays', asyncHandler(async (req, res) => {
  const rows = await collection('holidays').find().sort({ date: 1 }).toArray();
  res.json(rows.map(apiDocument));
}));

router.post('/holidays', asyncHandler(async (req, res) => {
  const { name, date } = req.body;
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? new Date(`${date}T00:00:00Z`) : null;
  if (!name || !parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    return res.status(400).json({ message: 'Provide a holiday name and valid YYYY-MM-DD date' });
  }
  try {
    const normalizedName = String(name).trim();
    const result = await collection('holidays').insertOne({ name: normalizedName, date, created_at: currentTimestamp() });
    await audit(req.user.id, 'holiday.created', 'holiday', { id: String(result.insertedId), date });
    res.status(201).json({ id: String(result.insertedId), name: normalizedName, date });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'A holiday already exists on this date' });
    throw error;
  }
}));

router.delete('/holidays/:id', asyncHandler(async (req, res) => {
  const holidays = collection('holidays');
  const holiday = await holidays.findOne({ _id: objectId(req.params.id) });
  if (!holiday) return res.status(404).json({ message: 'Holiday not found' });
  await holidays.deleteOne({ _id: holiday._id });
  await audit(req.user.id, 'holiday.deleted', 'holiday', apiDocument(holiday));
  res.json({ message: 'Holiday removed' });
}));

router.post('/hr-users', asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ message: 'Name, email and a password of at least 8 characters are required' });
  }
  try {
    const created = await createUser({ name, email: String(email).trim().toLowerCase(), password, role: 'hr' });
    await audit(req.user.id, 'hr_user.created', 'user', { id: created.id, email });
    res.status(201).json({ id: created.id, message: 'HR login created' });
  } catch (error) {
    if (error.code === 11000 || error.message.includes('already exists')) return res.status(409).json({ message: 'User with this email already exists' });
    throw error;
  }
}));

router.get('/audit', asyncHandler(async (req, res) => {
  const rows = await collection('auditLogs').find().sort({ created_at: -1 }).limit(100).toArray();
  const actorIds = [...new Set(rows.map((row) => row.actor_id).filter(Boolean))];
  const actors = actorIds.length
    ? await collection('users').find({ _id: { $in: actorIds.map(objectId) } }, { projection: { name: 1 } }).toArray()
    : [];
  const actorNames = new Map(actors.map((actor) => [String(actor._id), actor.name]));
  res.json(rows.map((row) => ({ ...apiDocument(row), actor_name: actorNames.get(row.actor_id) || null })));
}));

router.post('/payroll/:month/finalize', asyncHandler(async (req, res) => {
  const { month } = req.params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ message: 'Month must use YYYY-MM format' });
  const payroll = collection('payrollRuns');
  const drafts = await payroll.find({ month, status: 'draft' }).toArray();
  if (!drafts.length) return res.status(404).json({ message: 'No draft payroll exists for this month' });
  const now = currentTimestamp();
  await withTransaction(async (session) => {
    const result = await payroll.updateMany(
      { month, status: 'draft' },
      { $set: { status: 'finalized', finalized_by: req.user.id, finalized_at: now } },
      { session }
    );
    if (!result.modifiedCount) throw new Error('No draft payroll exists for this month');
    await collection('notifications').insertMany(drafts.map((row) => ({
      user_id: row.user_id,
      title: 'Payslip available',
      message: `Your ${month} payslip is ready to view.`,
      read_at: null,
      created_at: now
    })), { session });
    await collection('auditLogs').insertOne({
      actor_id: req.user.id,
      action: 'payroll.finalized',
      entity: 'payroll',
      details: JSON.stringify({ month }),
      created_at: now
    }, { session });
  });
  res.json({ message: `Payroll for ${month} finalized` });
}));

router.post('/announcements', asyncHandler(async (req, res) => {
  const { title, message } = req.body;
  if (!title || !message) return res.status(400).json({ message: 'Title and message are required' });
  const result = await collection('announcements').insertOne({
    title: title.trim(),
    message: message.trim(),
    created_by: req.user.id,
    created_at: currentTimestamp()
  });
  await audit(req.user.id, 'announcement.created', 'announcement', { id: String(result.insertedId) });
  res.status(201).json({ id: String(result.insertedId) });
}));

module.exports = router;
