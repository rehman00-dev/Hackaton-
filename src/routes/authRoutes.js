const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { authenticateToken, requireUserScope } = require('../middleware/auth');
const { loginUser } = require('../services/authService');
const { collection, currentTimestamp, objectId, withTransaction } = require('../db');

router.get('/setup/status', async (req, res, next) => {
  try {
    const admin = await collection('users').findOne({ role: 'admin' }, { projection: { _id: 1 } });
    res.json({ setupRequired: !admin });
  } catch (error) {
    next(error);
  }
});

router.post('/setup', async (req, res, next) => {
  try {
    const { companyName, name, email, password } = req.body || {};
    const normalizedCompanyName = typeof companyName === 'string' ? companyName.trim() : '';
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!normalizedCompanyName || normalizedCompanyName.length > 120 ||
        !normalizedName || normalizedName.length > 120 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
        typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ message: 'Company, Admin name, valid email, and password (8+ characters) are required' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await withTransaction(async (session) => {
      if (await collection('users').findOne({ role: 'admin' }, { session, projection: { _id: 1 } })) {
        const error = new Error('Initial setup has already been completed');
        error.statusCode = 409;
        throw error;
      }
      const now = currentTimestamp();
      await collection('users').insertOne({
        name: normalizedName,
        email: normalizedEmail,
        password_hash: passwordHash,
        role: 'admin',
        department_id: null,
        phone: '',
        address: '',
        is_active: 1,
        must_change_password: 0,
        created_at: now
      }, { session });
      await collection('companies').insertOne({
        singleton_key: 'primary',
        name: normalizedCompanyName,
        office_hours: '09:00-17:00',
        grace_minutes: 15,
        weekend: 'SAT-SUN',
        office_location: '',
        office_radius_meters: 150,
        office_latitude: null,
        office_longitude: null,
        created_at: now
      }, { session });
    });
    res.status(201).json({ message: 'Company and Admin account created. You can now sign in.' });
  } catch (error) {
    if (error.statusCode === 409) return res.status(409).json({ message: error.message });
    if (error.code === 11000) return res.status(409).json({ message: 'Initial setup has already been completed or that email address is already in use' });
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    res.json(await loginUser(String(email).trim().toLowerCase(), password));
  } catch (error) {
    if (error.message === 'Invalid credentials') {
      return res.status(401).json({ message: error.message });
    }
    next(error);
  }
});

router.get('/me', authenticateToken, requireUserScope, (req, res) => {
  const { id, name, email, role, must_change_password } = req.user;
  res.json({ user: { id, name, email, role, must_change_password } });
});

router.post('/change-password', authenticateToken, requireUserScope, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ message: 'Current password and a new password of at least 8 characters are required' });
    }
    const user = await collection('users').findOne({ _id: objectId(req.user.id) });
    if (!user || !await bcrypt.compare(currentPassword, user.password_hash)) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await collection('users').updateOne(
      { _id: user._id },
      { $set: { password_hash: passwordHash, must_change_password: 0 } }
    );
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
