const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeRoles, requireUserScope } = require('../middleware/auth');
const { apiDocument, collection, currentTimestamp, objectId, withTransaction } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const { audit } = require('../services/auditService');
const { localDate, localTimeMinutes } = require('../utils/dateUtils');

router.use(authenticateToken, requireUserScope, authorizeRoles('employee'));

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function weekendIndices(value = 'SAT-SUN') {
  return String(value).split('-').map((day) => ({ SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 }[day])).filter(Number.isInteger);
}

function workingDays(start, end, holidays, weekend = [0, 6]) {
  let count = 0;
  const date = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  while (date <= last) {
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (!weekend.includes(date.getDay()) && !holidays.has(iso)) count += 1;
    date.setDate(date.getDate() + 1);
  }
  return count;
}

router.get('/profile', asyncHandler(async (req, res) => {
  const [user, profile] = await Promise.all([
    collection('users').findOne({ _id: objectId(req.user.id) }),
    collection('employeeProfiles').findOne({ user_id: req.user.id })
  ]);
  const department = user?.department_id
    ? await collection('departments').findOne({ _id: objectId(user.department_id) })
    : null;
  res.json({
    id: req.user.id,
    name: user?.name,
    email: user?.email,
    role: user?.role,
    phone: user?.phone || '',
    address: user?.address || '',
    department_id: user?.department_id || null,
    department_name: department?.name || null,
    employee_code: profile?.employee_code || null,
    designation: profile?.designation || null,
    base_salary: profile?.base_salary || 0,
    join_date: profile?.join_date || null
  });
}));

router.patch('/profile', asyncHandler(async (req, res) => {
  const { phone = '', address = '' } = req.body;
  if (String(phone).length > 40 || String(address).length > 250) return res.status(400).json({ message: 'Phone or address is too long' });
  await collection('users').updateOne(
    { _id: objectId(req.user.id) },
    { $set: { phone: String(phone), address: String(address) } }
  );
  await audit(req.user.id, 'profile.updated', 'user', { fields: ['phone', 'address'] });
  res.json({ message: 'Profile updated' });
}));

router.get('/attendance', asyncHandler(async (req, res) => {
  const start = req.query.start || `${localDate().slice(0, 7)}-01`;
  const end = req.query.end || localDate();
  if (!isValidIsoDate(start) || !isValidIsoDate(end) || start > end) {
    return res.status(400).json({ message: 'Invalid attendance date range' });
  }
  const rows = await collection('attendance').find({
    user_id: req.user.id,
    date: { $gte: start, $lte: end }
  }).sort({ date: -1 }).toArray();
  res.json(rows.map(apiDocument));
}));

router.post('/checkin', asyncHandler(async (req, res) => {
  const date = localDate();
  const attendances = collection('attendance');
  if (await attendances.findOne({ user_id: req.user.id, date })) return res.status(409).json({ message: 'You already checked in today' });
  const company = await collection('companies').findOne({}, { sort: { _id: -1 } });
  if (company?.office_latitude !== null && company?.office_latitude !== undefined &&
      company?.office_longitude !== null && company?.office_longitude !== undefined) {
    const latitude = Number(req.body.latitude);
    const longitude = Number(req.body.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return res.status(400).json({ message: 'Office check-in requires your location permission' });
    }
    const toRadians = (degrees) => degrees * Math.PI / 180;
    const deltaLatitude = toRadians(latitude - company.office_latitude);
    const deltaLongitude = toRadians(longitude - company.office_longitude);
    const value = Math.sin(deltaLatitude / 2) ** 2 +
      Math.cos(toRadians(company.office_latitude)) * Math.cos(toRadians(latitude)) *
      Math.sin(deltaLongitude / 2) ** 2;
    const distance = 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
    if (distance > Number(company.office_radius_meters || 150)) {
      return res.status(403).json({ message: `You are outside the office check-in area (${Math.round(distance)} m away)` });
    }
  }
  const now = new Date();
  const startTime = (company?.office_hours || '09:00-17:00').split('-')[0] || '09:00';
  const [hour, minute] = startTime.split(':').map(Number);
  const lateMinutes = Math.max(0, localTimeMinutes(now) - (hour * 60 + minute) - Number(company?.grace_minutes ?? 15));
  const status = lateMinutes > 0 ? 'late' : 'present';
  try {
    const result = await attendances.insertOne({
      user_id: req.user.id,
      date,
      check_in: now.toISOString(),
      check_out: null,
      status,
      late_minutes: lateMinutes,
      created_at: currentTimestamp()
    });
    await audit(req.user.id, 'attendance.check_in', 'attendance', { id: String(result.insertedId), date, status });
    res.status(201).json({ message: `Checked in${status === 'late' ? ` ${lateMinutes} minutes late` : ''}`, status });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'You already checked in today' });
    throw error;
  }
}));

router.post('/checkout', asyncHandler(async (req, res) => {
  const attendances = collection('attendance');
  const record = await attendances.findOne({ user_id: req.user.id, date: localDate() });
  if (!record) return res.status(400).json({ message: 'Check in before checking out' });
  if (record.check_out) return res.status(409).json({ message: 'You already checked out today' });
  const checkOut = new Date().toISOString();
  const durationHours = (Date.now() - new Date(record.check_in).getTime()) / 3600000;
  const status = durationHours < 5 ? 'half_day' : record.status;
  await attendances.updateOne({ _id: record._id, check_out: null }, { $set: { check_out: checkOut, status } });
  await audit(req.user.id, 'attendance.check_out', 'attendance', { id: String(record._id), date: record.date, status });
  res.json({ message: 'Checked out successfully', status });
}));

router.post('/leave', asyncHandler(async (req, res) => {
  const { leaveType, startDate, endDate, reason = '' } = req.body;
  if (!leaveType || !isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate) {
    return res.status(400).json({ message: 'Choose a leave type and valid date range' });
  }
  const type = await collection('leaveTypes').findOne({ name_folded: String(leaveType).toLowerCase() });
  if (!type) return res.status(400).json({ message: 'Choose a configured leave type' });
  const leaveRequests = collection('leaveRequests');
  const overlapping = await leaveRequests.findOne({
    user_id: req.user.id,
    status: { $in: ['pending', 'approved'] },
    start_date: { $lte: endDate },
    end_date: { $gte: startDate }
  });
  if (overlapping) return res.status(422).json({ message: 'This date range overlaps another leave request' });
  const holidays = new Set((await collection('holidays').find({ date: { $gte: startDate, $lte: endDate } }).toArray()).map((row) => row.date));
  const company = await collection('companies').findOne({}, { sort: { _id: 1 } });
  const weekends = weekendIndices(company?.weekend);
  const requestedDays = workingDays(startDate, endDate, holidays, weekends);
  if (!requestedDays) return res.status(422).json({ message: 'The selected range contains no working days' });
  if (type.annual_quota !== null) {
    const year = Number(localDate().slice(0, 4));
    const used = await leaveRequests.find({
      user_id: req.user.id,
      leave_type: type.name,
      status: { $in: ['pending', 'approved'] },
      start_date: { $regex: `^${year}-` }
    }).toArray();
    const usedHolidays = new Set((await collection('holidays').find({ date: { $regex: `^${year}-` } }).toArray()).map((row) => row.date));
    const usedDays = used.reduce((sum, leave) => sum + workingDays(leave.start_date, leave.end_date, usedHolidays, weekends), 0);
    if (usedDays + requestedDays > type.annual_quota) {
      return res.status(422).json({ message: `Insufficient ${type.name.toLowerCase()} leave balance (${Math.max(0, type.annual_quota - usedDays)} day(s) left)` });
    }
  }
  const result = await leaveRequests.insertOne({
    user_id: req.user.id,
    leave_type: type.name,
    start_date: startDate,
    end_date: endDate,
    reason: String(reason).slice(0, 500),
    status: 'pending',
    reviewer_comment: '',
    approved_by: null,
    created_at: currentTimestamp()
  });
  await audit(req.user.id, 'leave.created', 'leave_request', { id: String(result.insertedId), leaveType: type.name, startDate, endDate });
  res.status(201).json({ message: 'Leave request submitted', id: String(result.insertedId), workingDays: requestedDays });
}));

router.get('/leave', asyncHandler(async (req, res) => {
  const [requestRows, types] = await Promise.all([
    collection('leaveRequests').find({ user_id: req.user.id }).sort({ created_at: -1 }).limit(200).toArray(),
    collection('leaveTypes').find().sort({ name_folded: 1 }).toArray()
  ]);
  const year = Number(localDate().slice(0, 4));
  const holidays = new Set((await collection('holidays').find({ date: { $regex: `^${year}-` } }).toArray()).map((row) => row.date));
  const company = await collection('companies').findOne({}, { sort: { _id: 1 } });
  const weekends = weekendIndices(company?.weekend);
  const balances = types.map((type) => {
    const requestsForType = requestRows.filter((item) =>
      item.leave_type === type.name && ['pending', 'approved'].includes(item.status) && item.start_date.startsWith(`${year}-`)
    );
    const used = requestsForType.reduce((sum, item) => sum + workingDays(item.start_date, item.end_date, holidays, weekends), 0);
    return {
      ...apiDocument(type),
      used,
      remaining: type.annual_quota === null ? null : Math.max(0, type.annual_quota - used)
    };
  });
  res.json({ requests: requestRows.map(apiDocument), balances });
}));

router.post('/leave/:id/cancel', asyncHandler(async (req, res) => {
  const leave = await collection('leaveRequests').findOne({ _id: objectId(req.params.id), user_id: req.user.id });
  if (!leave) return res.status(404).json({ message: 'Leave request not found' });
  if (leave.status !== 'pending') return res.status(409).json({ message: 'Only pending leave requests can be cancelled' });
  await collection('leaveRequests').updateOne(
    { _id: leave._id, status: 'pending' },
    { $set: { status: 'cancelled' } }
  );
  await audit(req.user.id, 'leave.cancelled', 'leave_request', { id: String(leave._id) });
  res.json({ message: 'Leave request cancelled' });
}));

router.post('/attendance-correction', asyncHandler(async (req, res) => {
  const { date, checkIn = null, checkOut = null, reason } = req.body;
  if (!isValidIsoDate(date) || date > localDate() || (!checkIn && !checkOut) || !reason || String(reason).trim().length < 5) {
    return res.status(400).json({ message: 'Provide a past or current date, at least one requested time, and a reason of at least 5 characters' });
  }
  if ((checkIn && Number.isNaN(Date.parse(checkIn))) || (checkOut && Number.isNaN(Date.parse(checkOut)))) {
    return res.status(400).json({ message: 'Requested check-in and check-out must be valid date-times' });
  }
  const corrections = collection('attendanceCorrections');
  if (await corrections.findOne({ user_id: req.user.id, date, status: 'pending' })) {
    return res.status(409).json({ message: 'A correction is already pending for that date' });
  }
  const result = await corrections.insertOne({
    user_id: req.user.id,
    date,
    requested_check_in: checkIn,
    requested_check_out: checkOut,
    reason: String(reason).trim().slice(0, 500),
    status: 'pending',
    reviewer_comment: '',
    reviewed_by: null,
    created_at: currentTimestamp()
  });
  await audit(req.user.id, 'attendance_correction.created', 'attendance_correction', { id: String(result.insertedId), date });
  res.status(201).json({ id: String(result.insertedId), message: 'Correction request sent to HR' });
}));

router.get('/payroll', asyncHandler(async (req, res) => {
  const rows = await collection('payrollRuns').find({ user_id: req.user.id }).sort({ month: -1 }).toArray();
  res.json(rows.map(apiDocument));
}));

router.get('/notifications', asyncHandler(async (req, res) => {
  const rows = await collection('notifications').find({ user_id: req.user.id }).sort({ created_at: -1 }).limit(50).toArray();
  res.json(rows.map(apiDocument));
}));

router.post('/notifications/:id/read', asyncHandler(async (req, res) => {
  await collection('notifications').updateOne(
    { _id: objectId(req.params.id), user_id: req.user.id },
    { $set: { read_at: currentTimestamp() } }
  );
  res.json({ message: 'Notification marked as read' });
}));

router.get('/announcements', asyncHandler(async (req, res) => {
  const rows = await collection('announcements').find({}, { projection: { title: 1, message: 1, created_at: 1 } }).sort({ created_at: -1 }).limit(30).toArray();
  res.json(rows.map(apiDocument));
}));

router.get('/dashboard', asyncHandler(async (req, res) => {
  const today = localDate();
  const [attendance, profile, leave, payslip, announcements] = await Promise.all([
    collection('attendance').findOne({ user_id: req.user.id, date: today }),
    collection('employeeProfiles').findOne({ user_id: req.user.id }, { projection: { base_salary: 1 } }),
    collection('leaveRequests').find({ user_id: req.user.id, status: 'approved' }, { projection: { _id: 1 } }).toArray(),
    collection('payrollRuns').findOne({ user_id: req.user.id, status: 'finalized' }, { sort: { month: -1 }, projection: { month: 1, net_salary: 1 } }),
    collection('announcements').find({}, { projection: { title: 1, message: 1, created_at: 1 } }).sort({ created_at: -1 }).limit(3).toArray()
  ]);
  res.json({
    attendance: apiDocument(attendance) || null,
    approvedLeaveCount: leave.length,
    baseSalary: profile?.base_salary || 0,
    lastPayslip: payslip ? { ...payslip, month: payslip.month, net_salary: payslip.net_salary } : null,
    announcements: announcements.map(apiDocument)
  });
}));

module.exports = router;
