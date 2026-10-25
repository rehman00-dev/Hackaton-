const express = require('express');
const router = express.Router();
const { authenticateToken, requireUserScope } = require('../middleware/auth');
const { collection } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const { localDate } = require('../utils/dateUtils');

router.use(authenticateToken, requireUserScope);

router.get('/summary', asyncHandler(async (req, res) => {
  if (req.user.role === 'employee') {
    const [attendance, pendingLeave, payslip] = await Promise.all([
      collection('attendance').aggregate([
        { $match: { user_id: req.user.id } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]).toArray(),
      collection('leaveRequests').countDocuments({ user_id: req.user.id, status: 'pending' }),
      collection('payrollRuns').findOne(
        { user_id: req.user.id, status: 'finalized' },
        { sort: { month: -1 }, projection: { month: 1, net_salary: 1 } }
      )
    ]);
    return res.json({
      role: 'employee',
      attendance: attendance.map((row) => ({ status: row._id, count: row.count })),
      pendingLeave,
      lastPayslip: payslip ? { month: payslip.month, net_salary: payslip.net_salary } : null
    });
  }
  const [headcount, today, leave, payroll, departments] = await Promise.all([
    collection('users').countDocuments({ role: 'employee', is_active: 1 }),
    collection('attendance').aggregate([
      { $match: { date: localDate() } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]).toArray(),
    collection('leaveRequests').aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]).toArray(),
    collection('payrollRuns').aggregate([
      { $match: { status: 'finalized' } },
      { $group: { _id: null, net: { $sum: '$net_salary' } } }
    ]).toArray(),
    collection('departments').find().sort({ name_folded: 1 }).toArray()
  ]);
  const departmentIds = departments.map((department) => String(department._id));
  const employeeCounts = departmentIds.length
    ? await collection('users').aggregate([
      { $match: { role: 'employee', is_active: 1, department_id: { $in: departmentIds } } },
      { $group: { _id: '$department_id', employees: { $sum: 1 } } }
    ]).toArray()
    : [];
  const countByDepartment = new Map(employeeCounts.map((row) => [row._id, row.employees]));
  res.json({
    role: req.user.role,
    headcount,
    attendanceToday: today.map((row) => ({ status: row._id, count: row.count })),
    leaveRequests: leave.map((row) => ({ status: row._id, count: row.count })),
    finalizedPayroll: payroll[0]?.net || 0,
    departments: departments.map((row) => ({ name: row.name, employees: countByDepartment.get(String(row._id)) || 0 }))
  });
}));

module.exports = router;
