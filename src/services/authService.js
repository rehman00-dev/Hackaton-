const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { collection, currentTimestamp } = require('../db');

async function loginUser(email, password) {
  const user = await collection('users').findOne({ email });
  if (!user || !user.is_active) {
    throw new Error('Invalid credentials');
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new Error('Invalid credentials');
  }

  const token = jwt.sign(
    { id: String(user._id), email: user.email, role: user.role },
    process.env.JWT_SECRET || 'dev-only-secret-change-before-deploy-2026',
    { expiresIn: '8h' }
  );

  return {
    token,
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      must_change_password: user.must_change_password
    }
  };
}

async function createUser({ name, email, password, role = 'employee', department_id = null }, options = {}) {
  email = String(email).trim().toLowerCase();
  if (!['admin', 'hr', 'employee'].includes(role)) {
    throw new Error('Invalid user role');
  }
  const existing = await collection('users').findOne({ email }, options);
  if (existing) {
    throw new Error('User with this email already exists');
  }

  const salt = await bcrypt.genSalt(10);
  const password_hash = await bcrypt.hash(password, salt);

  const result = await collection('users').insertOne({
    name,
    email,
    password_hash,
    role,
    department_id: department_id ? String(department_id) : null,
    is_active: 1,
    must_change_password: role === 'employee' ? 1 : 0,
    created_at: currentTimestamp()
  }, options);
  return { id: String(result.insertedId) };
}

module.exports = { loginUser, createUser };
