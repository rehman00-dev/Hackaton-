const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { authenticateToken, authorizeRoles, requireUserScope } = require('../middleware/auth');
const { apiDocument, collection, currentTimestamp, objectId, withTransaction } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const { createUser } = require('../services/authService');
const { audit, notify } = require('../services/auditService');
const { parseCsv } = require('../utils/parseCsv');
const { localDate } = require('../utils/dateUtils');

router.use(authenticateToken, requireUserScope, authorizeRoles('admin', 'hr'));

async function validateEmployeeRows(rows) {
  const [departments, users, profiles] = await Promise.all([
    collection('departments').find().toArray(),
    collection('users').find({}, { projection: { email: 1 } }).toArray(),
    collection('employeeProfiles').find({ employee_code_folded: { $type: 'string' } }, { projection: { employee_code_folded: 1 } }).toArray()
  ]);
  const existingUsers = new Set(users.map((row) => row.email.toLowerCase()));
  const existingCodes = new Set(profiles.map((row) => row.employee_code_folded));
  const seenEmails = new Set();
  const seenCodes = new Set();
  return rows.map((row, index) => {
    const errors = [];
    const email = String(row.email || '').trim().toLowerCase();
    const code = String(row.employee_code || '').trim();
    const salary = Number(row.base_salary);
    const department = departments.find((item) => item.name_folded === String(row.department || '').trim().toLowerCase());
    const date = /^\d{4}-\d{2}-\d{2}$/.test(row.join_date || '') ? new Date(`${row.join_date}T00:00:00Z`) : null;
    if (!row.name?.trim()) errors.push('Name is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email is invalid');
    if (existingUsers.has(email) || seenEmails.has(email)) errors.push('Email must be unique');
    if (!code) errors.push('Employee code is required');
    if (existingCodes.has(code.toLowerCase()) || seenCodes.has(code.toLowerCase())) errors.push('Employee code must be unique');
    if (!department) errors.push('Department does not exist');
    if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== row.join_date) errors.push('Join date must be a valid ISO date');
    if (!Number.isFinite(salary) || salary <= 0) errors.push('Salary must be greater than zero');
    if (email) seenEmails.add(email);
    if (code) seenCodes.add(code.toLowerCase());
    return { row: index + 2, valid: errors.length === 0, errors, data: row, departmentId: department ? String(department._id) : undefined, email, code, salary };
  });
}

async function employeesWithDetails(users) {
  if (!users.length) return [];
  const userIds = users.map((user) => String(user._id));
  const departmentIds = [...new Set(users.map((user) => user.department_id).filter(Boolean))];
  const [profiles, departments] = await Promise.all([
    collection('employeeProfiles').find({ user_id: { $in: userIds } }).toArray(),
    departmentIds.length
      ? collection('departments').find({ _id: { $in: departmentIds.map(objectId) } }).toArray()
      : []
  ]);
  const profileByUser = new Map(profiles.map((profile) => [profile.user_id, profile]));
  const departmentById = new Map(departments.map((department) => [String(department._id), department.name]));
  return users.map((user) => ({
    ...apiDocument(user),
    department_name: departmentById.get(user.department_id) || null,
    ...(profileByUser.has(String(user._id)) ? apiDocument(profileByUser.get(String(user._id))) : {}),
    user_id: String(user._id)
  }));
}

function sortReviewRows(rows) {
  return rows.sort((a, b) =>
    Number(a.status !== 'pending') - Number(b.status !== 'pending') ||
    String(b.created_at).localeCompare(String(a.created_at))
  );
}

router.get('/employees', asyncHandler(async (req, res) => {
  const search = String(req.query.search || '').trim().toLowerCase();
  const users = await collection('users').find({ role: 'employee' }).sort({ name: 1 }).limit(200).toArray();
  const details = await employeesWithDetails(users);
  res.json(search
    ? details.filter((row) => `${row.name} ${row.email} ${row.employee_code || ''} ${row.designation || ''} ${row.department_name || ''}`.toLowerCase().includes(search))
    : details);
}));

router.post('/employees', asyncHandler(async (req, res) => {
  const { name, email, password, department_id, designation, employee_code, base_salary, join_date } = req.body;
  const salary = Number(base_salary);
  if (!name || !email || typeof password !== 'string' || password.length < 8 || !Number.isFinite(salary) || salary <= 0) {
    return res.status(400).json({ message: 'Name, email, password (8+ characters), and salary greater than zero are required' });
  }
  if (join_date && !/^\d{4}-\d{2}-\d{2}$/.test(join_date)) return res.status(400).json({ message: 'Join date must use YYYY-MM-DD format' });
  const departmentId = department_id ? String(department_id) : null;
  if (departmentId && !await collection('departments').findOne({ _id: objectId(departmentId) })) {
    return res.status(400).json({ message: 'Choose a valid department' });
  }
  if (employee_code?.trim() && await collection('employeeProfiles').findOne({ employee_code_folded: employee_code.trim().toLowerCase() })) {
    return res.status(409).json({ message: 'Employee code is already in use' });
  }
  try {
    const user = await withTransaction(async (session) => {
      const created = await createUser({
        name: String(name).trim(),
        email: String(email).trim().toLowerCase(),
        password,
        role: 'employee',
        department_id: departmentId
      }, { session });
      const code = employee_code?.trim() || `EMP-${created.id.slice(-8).toUpperCase()}`;
      await collection('employeeProfiles').insertOne({
        user_id: created.id,
        employee_code: code,
        employee_code_folded: code.toLowerCase(),
        designation: designation?.trim() || 'Employee',
        base_salary: salary,
        join_date: join_date || localDate(),
        created_at: currentTimestamp()
      }, { session });
      return { id: created.id, code };
    });
    await audit(req.user.id, 'employee.created', 'employee', { userId: user.id, employeeCode: user.code });
    res.status(201).json({ id: user.id, employee_code: user.code, message: 'Employee login created' });
  } catch (error) {
    if (error.code === 11000 || error.message.includes('already exists')) return res.status(409).json({ message: 'Email or employee code is already in use' });
    throw error;
  }
}));

router.patch('/employees/:id', asyncHandler(async (req, res) => {
  const users = collection('users');
  const profiles = collection('employeeProfiles');
  const user = await users.findOne({ _id: objectId(req.params.id), role: 'employee' });
  if (!user) return res.status(404).json({ message: 'Employee not found' });
  const profile = await profiles.findOne({ user_id: String(user._id) });
  const input = req.body;
  const userChanges = {};
  const profileChanges = {};
  if (input.name !== undefined) {
    if (!String(input.name).trim()) return res.status(400).json({ message: 'Employee name cannot be empty' });
    userChanges.name = String(input.name).trim();
  }
  if (input.email !== undefined) {
    const email = String(input.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Email is invalid' });
    if (await users.findOne({ email, _id: { $ne: user._id } })) return res.status(409).json({ message: 'Email is already in use' });
    userChanges.email = email;
  }
  if (input.department_id !== undefined) {
    const departmentId = input.department_id ? String(input.department_id) : null;
    if (departmentId && !await collection('departments').findOne({ _id: objectId(departmentId) })) {
      return res.status(400).json({ message: 'Choose a valid department' });
    }
    userChanges.department_id = departmentId;
  }
  if (input.employee_code !== undefined) {
    const code = String(input.employee_code).trim();
    if (!code) return res.status(400).json({ message: 'Employee code cannot be empty' });
    if (await profiles.findOne({ employee_code_folded: code.toLowerCase(), user_id: { $ne: String(user._id) } })) {
      return res.status(409).json({ message: 'Employee code is already in use' });
    }
    profileChanges.employee_code = code;
    profileChanges.employee_code_folded = code.toLowerCase();
  }
  if (input.designation !== undefined) profileChanges.designation = String(input.designation).trim();
  if (input.join_date !== undefined) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.join_date) ? new Date(`${input.join_date}T00:00:00Z`) : null;
    if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.join_date) {
      return res.status(400).json({ message: 'Join date must be a valid ISO date' });
    }
    profileChanges.join_date = input.join_date;
  }
  if (input.base_salary !== undefined) {
    const salary = Number(input.base_salary);
    if (!Number.isFinite(salary) || salary <= 0) return res.status(400).json({ message: 'Salary must be greater than zero' });
    profileChanges.base_salary = salary;
  }
  if (!Object.keys(userChanges).length && !Object.keys(profileChanges).length) {
    return res.status(400).json({ message: 'No employee details were provided' });
  }
  try {
    await withTransaction(async (session) => {
      if (Object.keys(userChanges).length) await users.updateOne({ _id: user._id }, { $set: userChanges }, { session });
      if (Object.keys(profileChanges).length) {
        await profiles.updateOne(
          { user_id: String(user._id) },
          { $set: profileChanges, $setOnInsert: { user_id: String(user._id), created_at: currentTimestamp() } },
          { upsert: true, session }
        );
      }
    });
    await audit(req.user.id, 'employee.updated', 'employee', { id: String(user._id), fields: [...Object.keys(userChanges), ...Object.keys(profileChanges)] });
    res.json({ message: 'Employee details updated' });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'Email or employee code is already in use' });
    throw error;
  }
}));

router.post('/employees/import/dry-run', asyncHandler(async (req, res) => {
  let rows;
  try {
    rows = parseCsv(req.body.csv);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const results = await validateEmployeeRows(rows);
  res.json({
    total: results.length,
    validCount: results.filter((row) => row.valid).length,
    invalidCount: results.filter((row) => !row.valid).length,
    rows: results.map(({ row, valid, errors, data }) => ({ row, valid, errors, data }))
  });
}));

router.post('/employees/import', asyncHandler(async (req, res) => {
  let rows;
  try {
    rows = parseCsv(req.body.csv);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const results = await validateEmployeeRows(rows);
  const invalid = results.filter((row) => !row.valid);
  if (invalid.length) {
    return res.status(422).json({
      message: 'Fix the invalid rows and run the dry run again before importing',
      rows: invalid.map(({ row, errors }) => ({ row, errors }))
    });
  }
  try {
    const credentials = await withTransaction(async (session) => {
      const imported = [];
      for (const result of results) {
        const temporaryPassword = crypto.randomBytes(12).toString('base64url');
        const employee = await createUser({
          name: result.data.name.trim(),
          email: result.email,
          password: temporaryPassword,
          role: 'employee',
          department_id: result.departmentId
        }, { session });
        await collection('employeeProfiles').insertOne({
          user_id: employee.id,
          employee_code: result.code,
          employee_code_folded: result.code.toLowerCase(),
          designation: result.data.designation?.trim() || 'Employee',
          join_date: result.data.join_date,
          base_salary: result.salary,
          created_at: currentTimestamp()
        }, { session });
        imported.push({ name: result.data.name.trim(), email: result.email, employee_code: result.code, temporary_password: temporaryPassword });
      }
      return imported;
    });
    await audit(req.user.id, 'employees.csv_imported', 'employee', { count: credentials.length });
    res.status(201).json({ imported: credentials.length, credentials });
  } catch (error) {
    if (error.code === 11000 || error.message.includes('already exists')) {
      return res.status(409).json({ message: 'An employee email or code changed since the dry run. Run validation again.' });
    }
    throw error;
  }
}));

router.get('/employees/export.csv', asyncHandler(async (req, res) => {
  const users = await collection('users').find({ role: 'employee' }).sort({ name: 1 }).toArray();
  const rows = await employeesWithDetails(users);
  const headers = ['name', 'email', 'employee_code', 'designation', 'department_name', 'join_date', 'base_salary'];
  const csvCell = (value) => {
    let cell = String(value ?? '');
    if (/^[=+\-@]/.test(cell)) cell = `'${cell}`;
    return `"${cell.replace(/"/g, '""')}"`;
  };
  const csv = [
    ['name', 'email', 'employee_code', 'designation', 'department', 'join_date', 'base_salary'].join(','),
    ...rows.map((employee) => headers.map((key) => csvCell(employee[key])).join(','))
  ].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="hcm-employees.csv"');
  res.send(csv);
}));

router.get('/departments', asyncHandler(async (req, res) => {
  const departments = await collection('departments').find().sort({ name_folded: 1 }).toArray();
  const ids = departments.map((department) => String(department._id));
  const employees = ids.length
    ? await collection('users').aggregate([
      { $match: { role: 'employee', is_active: 1, department_id: { $in: ids } } },
      { $group: { _id: '$department_id', employee_count: { $sum: 1 } } }
    ]).toArray()
    : [];
  const counts = new Map(employees.map((row) => [row._id, row.employee_count]));
  res.json(departments.map((row) => ({ id: String(row._id), name: row.name, employee_count: counts.get(String(row._id)) || 0 })));
}));

router.get('/leave-types', asyncHandler(async (req, res) => {
  const rows = await collection('leaveTypes').find().sort({ name_folded: 1 }).toArray();
  res.json(rows.map(apiDocument));
}));

router.post('/departments', asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ message: 'Department name is required' });
  const company = await collection('companies').findOne({}, { sort: { _id: 1 } });
  if (!company) return res.status(400).json({ message: 'Set up the company before adding departments' });
  const folded = name.toLowerCase();
  if (await collection('departments').findOne({ company_id: String(company._id), name_folded: folded })) {
    return res.status(409).json({ message: 'Department already exists' });
  }
  try {
    const result = await collection('departments').insertOne({
      name,
      name_folded: folded,
      company_id: String(company._id),
      created_at: currentTimestamp()
    });
    await audit(req.user.id, 'department.created', 'department', { id: String(result.insertedId), name });
    res.status(201).json({ id: String(result.insertedId), name });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'Department already exists' });
    throw error;
  }
}));

router.get('/attendance', asyncHandler(async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : localDate();
  const records = await collection('attendance').find({ date }).sort({ date: -1 }).toArray();
  const users = records.length
    ? await collection('users').find({ _id: { $in: records.map((row) => objectId(row.user_id)) } }).toArray()
    : [];
  const userById = new Map(users.map((user) => [String(user._id), user]));
  const detailRows = await employeesWithDetails(users);
  const detailsByUser = new Map(detailRows.map((row) => [row.user_id, row]));
  res.json(records.map((row) => ({
    ...apiDocument(row),
    name: userById.get(row.user_id)?.name || '',
    email: userById.get(row.user_id)?.email || '',
    employee_code: detailsByUser.get(row.user_id)?.employee_code || null,
    department_name: detailsByUser.get(row.user_id)?.department_name || null
  })).sort((a, b) => a.name.localeCompare(b.name)));
}));

router.get('/corrections', asyncHandler(async (req, res) => {
  const rows = sortReviewRows(await collection('attendanceCorrections').find().limit(200).toArray());
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const users = userIds.length ? await collection('users').find({ _id: { $in: userIds.map(objectId) } }).toArray() : [];
  const profiles = userIds.length ? await collection('employeeProfiles').find({ user_id: { $in: userIds } }).toArray() : [];
  const names = new Map(users.map((row) => [String(row._id), row.name]));
  const codes = new Map(profiles.map((row) => [row.user_id, row.employee_code]));
  res.json(rows.map((row) => ({ ...apiDocument(row), name: names.get(row.user_id) || '', employee_code: codes.get(row.user_id) || null })));
}));

router.post('/corrections/:id/review', asyncHandler(async (req, res) => {
  const corrections = collection('attendanceCorrections');
  const correction = await corrections.findOne({ _id: objectId(req.params.id) });
  if (!correction) return res.status(404).json({ message: 'Correction request not found' });
  if (correction.status !== 'pending') return res.status(409).json({ message: 'This correction has already been reviewed' });
  const { decision, comment = '' } = req.body;
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ message: 'Decision must be approved or rejected' });
  await withTransaction(async (session) => {
    if (decision === 'approved') {
      const attendance = collection('attendance');
      const existing = await attendance.findOne({ user_id: correction.user_id, date: correction.date }, { session });
      const company = await collection('companies').findOne({}, { session, sort: { _id: -1 } });
      const checkIn = correction.requested_check_in || existing?.check_in || null;
      const checkOut = correction.requested_check_out || existing?.check_out || null;
      const startTime = (company?.office_hours || '09:00-17:00').split('-')[0] || '09:00';
      const [hour, minute] = startTime.split(':').map(Number);
      const inTime = checkIn ? new Date(checkIn) : null;
      const lateMinutes = inTime
        ? Math.max(0, inTime.getHours() * 60 + inTime.getMinutes() - (hour * 60 + minute) - Number(company?.grace_minutes ?? 15))
        : 0;
      let status = lateMinutes > 0 ? 'late' : 'present';
      if (checkIn && checkOut && (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 3600000 < 5) status = 'half_day';
      await attendance.updateOne(
        { user_id: correction.user_id, date: correction.date },
        { $set: { check_in: checkIn, check_out: checkOut, late_minutes: lateMinutes, status }, $setOnInsert: { created_at: currentTimestamp() } },
        { upsert: true, session }
      );
    }
    await corrections.updateOne(
      { _id: correction._id, status: 'pending' },
      { $set: { status: decision, reviewer_comment: String(comment).slice(0, 500), reviewed_by: req.user.id } },
      { session }
    );
    const now = currentTimestamp();
    await collection('notifications').insertOne({
      user_id: correction.user_id,
      title: 'Attendance correction updated',
      message: `Your correction for ${correction.date} was ${decision}.`,
      read_at: null,
      created_at: now
    }, { session });
    await collection('auditLogs').insertOne({
      actor_id: req.user.id,
      action: `attendance_correction.${decision}`,
      entity: 'attendance_correction',
      details: JSON.stringify({ id: String(correction._id) }),
      created_at: now
    }, { session });
  });
  res.json({ message: `Correction ${decision}` });
}));

router.get('/leave', asyncHandler(async (req, res) => {
  const status = req.query.status;
  const filter = status && ['pending', 'approved', 'rejected', 'cancelled'].includes(status) ? { status } : {};
  const rows = sortReviewRows(await collection('leaveRequests').find(filter).limit(300).toArray());
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const users = userIds.length ? await collection('users').find({ _id: { $in: userIds.map(objectId) } }).toArray() : [];
  const profiles = userIds.length ? await collection('employeeProfiles').find({ user_id: { $in: userIds } }).toArray() : [];
  const names = new Map(users.map((row) => [String(row._id), row]));
  const codes = new Map(profiles.map((row) => [row.user_id, row.employee_code]));
  res.json(rows.map((row) => ({
    ...apiDocument(row),
    name: names.get(row.user_id)?.name || '',
    email: names.get(row.user_id)?.email || '',
    employee_code: codes.get(row.user_id) || null
  })));
}));

router.post('/leave/:id/review', asyncHandler(async (req, res) => {
  const leave = await collection('leaveRequests').findOne({ _id: objectId(req.params.id) });
  if (!leave) return res.status(404).json({ message: 'Leave request not found' });
  if (leave.status !== 'pending') return res.status(409).json({ message: 'This leave request has already been reviewed' });
  const { decision, comment = '' } = req.body;
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ message: 'Decision must be approved or rejected' });
  await withTransaction(async (session) => {
    const result = await collection('leaveRequests').updateOne(
      { _id: leave._id, status: 'pending' },
      { $set: { status: decision, approved_by: req.user.id, reviewer_comment: String(comment).slice(0, 500) } },
      { session }
    );
    if (!result.modifiedCount) throw new Error('This leave request has already been reviewed');
    const now = currentTimestamp();
    await collection('notifications').insertOne({
      user_id: leave.user_id,
      title: 'Leave request updated',
      message: `Your ${leave.leave_type} leave request was ${decision}.`,
      read_at: null,
      created_at: now
    }, { session });
    await collection('auditLogs').insertOne({
      actor_id: req.user.id,
      action: `leave.${decision}`,
      entity: 'leave_request',
      details: JSON.stringify({ id: String(leave._id) }),
      created_at: now
    }, { session });
  });
  res.json({ message: `Leave ${decision}` });
}));

router.post('/payroll/run', asyncHandler(async (req, res) => {
  const month = String(req.body.month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ message: 'Month must use YYYY-MM format' });
  const today = new Date();
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  if (month > currentMonth) return res.status(400).json({ message: 'Payroll cannot be prepared for a future month' });
  const [year, monthNumber] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const lastPayrollDay = month === currentMonth ? today.getDate() : daysInMonth;
  const company = await collection('companies').findOne({}, { sort: { _id: 1 } });
  const weekend = String(company?.weekend || 'SAT-SUN').split('-')
    .map((day) => ({ SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 }[day])).filter(Number.isInteger);
  const holidayRows = await collection('holidays').find({ date: { $regex: `^${month}-` } }).toArray();
  const holidays = new Set(holidayRows.map((row) => row.date));
  let workingDays = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(Date.UTC(year, monthNumber - 1, day));
    if (!weekend.includes(date.getUTCDay()) && !holidays.has(`${month}-${String(day).padStart(2, '0')}`)) workingDays += 1;
  }
  if (!workingDays) return res.status(400).json({ message: 'No working days found for this month' });
  const employeeUsers = await collection('users').find({ role: 'employee', is_active: 1 }).sort({ _id: 1 }).toArray();
  if (!employeeUsers.length) return res.status(400).json({ message: 'Register employees before running payroll' });
  const userIds = employeeUsers.map((user) => String(user._id));
  const [profiles, existingRun, leaveTypes] = await Promise.all([
    collection('employeeProfiles').find({ user_id: { $in: userIds } }).toArray(),
    collection('payrollRuns').findOne({ month }, { projection: { _id: 1, status: 1 } }),
    collection('leaveTypes').find().toArray()
  ]);
  if (existingRun) return res.status(409).json({ message: `Payroll for ${month} already exists (${existingRun.status})` });
  const profileByUser = new Map(profiles.map((profile) => [profile.user_id, profile]));
  const paidByType = new Map(leaveTypes.map((type) => [type.name.toLowerCase(), type.paid]));
  const rows = [];
  for (const employee of employeeUsers) {
    const employeeId = String(employee._id);
    const profile = profileByUser.get(employeeId);
    if (!profile) continue;
    const [attendance, approvedLeaves] = await Promise.all([
      collection('attendance').find({ user_id: employeeId, date: { $regex: `^${month}-` } }).toArray(),
      collection('leaveRequests').find({
        user_id: employeeId,
        status: 'approved',
        start_date: { $lte: `${month}-${String(daysInMonth).padStart(2, '0')}` },
        end_date: { $gte: `${month}-01` }
      }).toArray()
    ]);
    const attendanceByDate = new Map(attendance.map((record) => [record.date, record.status]));
    const firstDay = profile.join_date && profile.join_date > `${month}-01` ? profile.join_date : `${month}-01`;
    let absentDays = 0;
    let halfDays = 0;
    let unpaidDays = 0;
    for (let date = new Date(`${firstDay}T12:00:00`), last = new Date(`${month}-${String(lastPayrollDay).padStart(2, '0')}T12:00:00`); date <= last; date.setDate(date.getDate() + 1)) {
      const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      if (weekend.includes(date.getDay()) || holidays.has(dateKey)) continue;
      const approvedLeave = approvedLeaves.find((leave) => leave.start_date <= dateKey && leave.end_date >= dateKey);
      if (approvedLeave) {
        if (!paidByType.get(approvedLeave.leave_type.toLowerCase())) unpaidDays += 1;
        continue;
      }
      const status = attendanceByDate.get(dateKey);
      if (status === 'half_day') halfDays += 1;
      else if (status === 'absent' || !status) absentDays += 1;
    }
    const basic = Number(profile.base_salary) || 0;
    const gross = basic * 1.5;
    const annual = gross * 12;
    const annualTax = annual <= 600000 ? 0 : annual <= 1200000 ? (annual - 600000) * 0.05 :
      annual <= 2400000 ? 30000 + (annual - 1200000) * 0.15 :
      annual <= 3600000 ? 210000 + (annual - 2400000) * 0.25 :
      510000 + (annual - 3600000) * 0.35;
    const deduction = (gross / workingDays) * (absentDays + unpaidDays + halfDays * 0.5);
    const tax = annualTax / 12;
    const prorated = firstDay > `${month}-01` ? Math.max(0, (daysInMonth - Number(firstDay.slice(-2)) + 1) / daysInMonth) : 1;
    const proratedGross = gross * prorated;
    const proratedTax = tax * prorated;
    rows.push({
      user_id: employeeId,
      month,
      gross_salary: proratedGross,
      tax: proratedTax,
      net_salary: Math.max(0, proratedGross - proratedTax - deduction),
      status: 'draft',
      finalized_by: null,
      finalized_at: null,
      created_at: currentTimestamp()
    });
  }
  if (!rows.length) return res.status(400).json({ message: 'Register employee profiles before running payroll' });
  try {
    await withTransaction(async (session) => {
      if (await collection('payrollRuns').findOne({ month }, { session, projection: { _id: 1, status: 1 } })) {
        const error = new Error(`Payroll for ${month} already exists`);
        error.statusCode = 409;
        throw error;
      }
      await collection('payrollRuns').insertMany(rows, { session });
      await collection('auditLogs').insertOne({
        actor_id: req.user.id,
        action: 'payroll.draft_created',
        entity: 'payroll',
        details: JSON.stringify({ month, employees: rows.length }),
        created_at: currentTimestamp()
      }, { session });
    });
  } catch (error) {
    if (error.statusCode === 409 || error.code === 11000) return res.status(409).json({ message: `Payroll for ${month} already exists` });
    throw error;
  }
  res.status(201).json({ month, employeeCount: rows.length, workingDays, status: 'draft' });
}));

router.get('/payroll', asyncHandler(async (req, res) => {
  const rows = await collection('payrollRuns').find().sort({ month: -1 }).limit(500).toArray();
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const users = userIds.length ? await collection('users').find({ _id: { $in: userIds.map(objectId) } }).toArray() : [];
  const profiles = userIds.length ? await collection('employeeProfiles').find({ user_id: { $in: userIds } }).toArray() : [];
  const names = new Map(users.map((row) => [String(row._id), row.name]));
  const codes = new Map(profiles.map((row) => [row.user_id, row.employee_code]));
  res.json(rows.map((row) => ({
    ...apiDocument(row),
    name: names.get(row.user_id) || '',
    employee_code: codes.get(row.user_id) || null
  })).sort((a, b) => b.month.localeCompare(a.month) || a.name.localeCompare(b.name)));
}));

router.get('/announcements', asyncHandler(async (req, res) => {
  const rows = await collection('announcements').find().sort({ created_at: -1 }).limit(30).toArray();
  const authorIds = [...new Set(rows.map((row) => row.created_by))];
  const authors = authorIds.length ? await collection('users').find({ _id: { $in: authorIds.map(objectId) } }).toArray() : [];
  const names = new Map(authors.map((row) => [String(row._id), row.name]));
  res.json(rows.map((row) => ({ ...apiDocument(row), author: names.get(row.created_by) || '' })));
}));

router.post('/announcements', asyncHandler(async (req, res) => {
  const { title, message } = req.body;
  if (!title || !message) return res.status(400).json({ message: 'Title and message are required' });
  const result = await collection('announcements').insertOne({
    title: String(title).trim(),
    message: String(message).trim(),
    created_by: req.user.id,
    created_at: currentTimestamp()
  });
  await audit(req.user.id, 'announcement.created', 'announcement', { id: String(result.insertedId) });
  res.status(201).json({ id: String(result.insertedId) });
}));

module.exports = router;
