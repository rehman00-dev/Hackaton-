const { rateLimit } = require('express-rate-limit');

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many sign-in attempts. Try again in 15 minutes.' }
});

const setupRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many setup attempts. Try again in an hour.' }
});

module.exports = { loginRateLimit, setupRateLimit };
