'use strict';
try { require('dotenv').config(); } catch(e){}
const express = require('express');
const session = require('express-session');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');

const { getDb } = require('./models/db');
const apiRouter = require('./routes/api');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure directories exist
['uploads', 'data'].forEach(dir => {
  const p = path.join(__dirname, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// Initialize database
getDb();

// CORS and local dev support
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Security Headers
app.use(helmet({
  contentSecurityPolicy: false
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session setup
app.use(session({
  name: 'cams.sid',
  secret: process.env.SESSION_SECRET || 'cams-super-secret-key-nit-trichy-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  }
}));

// Bearer token authentication support (for cross-origin and file protocol access)
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const raw = Buffer.from(authHeader.slice(7), 'base64').toString('utf8');
      const payload = JSON.parse(raw);
      if (payload && payload.userId && payload.exp > Date.now()) {
        if (!req.session) req.session = {};
        req.session.userId = payload.userId;
        req.session.systemRole = payload.systemRole;
        req.session.name = payload.name;
        if (payload.clubId) req.session.clubId = payload.clubId;
      }
    } catch(e) {}
  }
  next();
});

// Rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many login attempts. Please try again after 15 minutes.' }
});
app.use('/api/v1/auth/login', authLimiter);

// API Routes
app.use('/api/v1', apiRouter);

// Static uploads (for certificates, etc. if needed via internal check)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve Frontend
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// Fallback to frontend index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Centralized error handling
app.use(errorHandler);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`  CAMS Portal Server running on http://localhost:${PORT}`);
    console.log(`======================================================\n`);
  });
}

module.exports = app;
