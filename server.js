const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const { connectDb, ensureAdminExists } = require('./src/db');
const app = express();
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.CLIENT_ORIGIN || (isProduction ? '' : 'http://localhost:5173,http://127.0.0.1:5173'))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('Production requires a JWT_SECRET of at least 32 characters.');
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
  next();
});
app.use(cors((req, callback) => {
  const requestOrigin = req.get('origin');
  const requestHost = req.get('host');
  const isSameOrigin = requestOrigin && requestHost && new URL(requestOrigin).host === requestHost;
  callback(null, {
    origin: !requestOrigin || allowedOrigins.includes(requestOrigin) || isSameOrigin
  });
}));
app.use('/api', async (req, res, next) => {
  try {
    await connectDb();
    await ensureAdminExists();
    next();
  } catch (error) {
    next(error);
  }
});
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb', parameterLimit: 1000 }));

app.get('/api/health', async (req, res) => {
  res.json({ ok: true, message: 'HCM Lite API is running', database: 'ready' });
});

app.use('/api/auth', require('./src/routes/authRoutes'));
app.use('/api/admin', require('./src/routes/adminRoutes'));
app.use('/api/hr', require('./src/routes/hrRoutes'));
app.use('/api/employee', require('./src/routes/employeeRoutes'));
app.use('/api/ai', require('./src/routes/aiRoutes'));
app.use('/api/dashboard', require('./src/routes/dashboardRoutes'));

app.use('/api', (req, res) => {
  res.status(404).json({ message: 'API route not found' });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Request body contains invalid JSON' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request body exceeds the 5 MB limit' });
  }
  res.status(500).json({ message: error.message || 'An unexpected server error occurred' });
});

if (isProduction) {
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.json({
      app: 'HCM Lite',
      message: 'API ready. Use the frontend or call /api/health.',
      docs: 'Set up company and Admin account on first run.'
    });
  });
}

if (require.main === module) {
  (async () => {
    try {
      await connectDb();
      await ensureAdminExists();
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`HCM Lite server running on http://localhost:${PORT}`);
      });
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  })();
}

module.exports = app;
