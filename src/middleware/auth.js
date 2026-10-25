const jwt = require('jsonwebtoken');
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'dev-only-secret-change-before-deploy-2026', (err, user) => {
    if (err) {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    req.user = user;
    next();
  });
}

function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied for this role' });
    }

    next();
  };
}

function requireUserScope(req, res, next) {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  const { apiDocument, collection, objectId } = require('../db');
  collection('users').findOne(
    { _id: objectId(userId) },
    { projection: { name: 1, email: 1, role: 1, is_active: 1, must_change_password: 1 } }
  )
    .then((record) => {
      const user = apiDocument(record);
      if (!user || !user.is_active) {
        return res.status(403).json({ message: 'User account is inactive' });
      }
      req.user = { ...req.user, ...user };
      const isAllowedPasswordRoute = req.baseUrl === '/api/auth' && ['/me', '/change-password'].includes(req.path);
      if (user.must_change_password && !isAllowedPasswordRoute) {
        return res.status(403).json({ message: 'Change your temporary password before continuing', mustChangePassword: true });
      }
      next();
    })
    .catch(next);
}

module.exports = { authenticateToken, authorizeRoles, requireUserScope };
