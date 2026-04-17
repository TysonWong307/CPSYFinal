// server.js — Western Alberta Institute of Technology
require('dotenv').config();
const express     = require('express');
const session     = require('express-session');
const bcrypt      = require('bcryptjs');
const helmet      = require('helmet');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const Joi         = require('joi');
const path        = require('path');
const { getPool, initDB, sql } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Trust Proxy (required for Azure) ──────────────────────────────────
app.set('trust proxy', 1);

// ─── Security Middleware ──────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers
      imgSrc:     ["'self'", "data:", "https:"],
    },
  },
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
// ─── Session ─────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 8, // 8 hours
  },
}));

// ─── Rate Limiters ────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { error: 'Too many attempts. Please try again later.' },
});

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { error: 'Too many messages sent. Please try again later.' },
});

// ─── Validation Schemas ───────────────────────────────────────────────
const registerSchema = Joi.object({
  first_name: Joi.string().min(2).max(100).required(),
  last_name:  Joi.string().min(2).max(100).required(),
  email:      Joi.string().email().required(),
  password:   Joi.string().min(8).max(128).required(),
  phone:      Joi.string().allow('').max(20),
  program:    Joi.string().allow('').max(200),
  dob:        Joi.date().iso().allow('').optional(),
});

const loginSchema = Joi.object({
  email:    Joi.string().email().required(),
  password: Joi.string().required(),
});

const contactSchema = Joi.object({
  name:    Joi.string().min(2).max(200).required(),
  email:   Joi.string().email().required(),
  subject: Joi.string().allow('').max(300),
  message: Joi.string().min(10).max(5000).required(),
});

// ─── Auth Middleware ──────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.studentId) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

// ═══════════════════════════════════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════════════════════════════════

// ── POST /api/register ────────────────────────────────────────────────
app.post('/api/register', authLimiter, async (req, res) => {
  const { error, value } = registerSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const db = await getPool();

    // Check if email already exists
    const existing = await db.request()
      .input('email', sql.NVarChar, value.email)
      .query('SELECT id FROM students WHERE email = @email');

    if (existing.recordset.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Hash password
    const hashed = await bcrypt.hash(value.password, 12);

    // Insert student
    const result = await db.request()
      .input('first_name', sql.NVarChar, value.first_name)
      .input('last_name',  sql.NVarChar, value.last_name)
      .input('email',      sql.NVarChar, value.email)
      .input('password',   sql.NVarChar, hashed)
      .input('phone',      sql.NVarChar, value.phone || null)
      .input('program',    sql.NVarChar, value.program || null)
      .input('dob',        sql.Date,     value.dob || null)
      .query(`
        INSERT INTO students (first_name, last_name, email, password, phone, program, dob)
        OUTPUT INSERTED.id, INSERTED.first_name, INSERTED.last_name, INSERTED.email
        VALUES (@first_name, @last_name, @email, @password, @phone, @program, @dob)
      `);

    const student = result.recordset[0];

    // Auto-login after registration
    req.session.studentId    = student.id;
    req.session.studentEmail = student.email;
    req.session.studentName  = `${student.first_name} ${student.last_name}`;

    return res.status(201).json({
      message: 'Registration successful!',
      student: {
        id:    student.id,
        name:  `${student.first_name} ${student.last_name}`,
        email: student.email,
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── POST /api/login ───────────────────────────────────────────────────
app.post('/api/login', authLimiter, async (req, res) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const db = await getPool();

    const result = await db.request()
      .input('email', sql.NVarChar, value.email)
      .query('SELECT * FROM students WHERE email = @email AND is_active = 1');

    if (result.recordset.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const student = result.recordset[0];
    const valid   = await bcrypt.compare(value.password, student.password);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    req.session.studentId    = student.id;
    req.session.studentEmail = student.email;
    req.session.studentName  = `${student.first_name} ${student.last_name}`;

    return res.json({
      message: 'Login successful!',
      student: {
        id:      student.id,
        name:    `${student.first_name} ${student.last_name}`,
        email:   student.email,
        program: student.program,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── POST /api/logout ──────────────────────────────────────────────────
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logged out successfully.' });
  });
});

// ── GET /api/me ───────────────────────────────────────────────────────
app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const db = await getPool();
    const result = await db.request()
      .input('id', sql.Int, req.session.studentId)
      .query('SELECT id, first_name, last_name, email, phone, program, dob, created_at FROM students WHERE id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Student not found.' });
    }

    return res.json({ student: result.recordset[0] });
  } catch (err) {
    console.error('Me error:', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/contact ─────────────────────────────────────────────────
app.post('/api/contact', contactLimiter, async (req, res) => {
  const { error, value } = contactSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const db = await getPool();
    await db.request()
      .input('name',    sql.NVarChar, value.name)
      .input('email',   sql.NVarChar, value.email)
      .input('subject', sql.NVarChar, value.subject || null)
      .input('message', sql.NVarChar, value.message)
      .query('INSERT INTO contact_submissions (name, email, subject, message) VALUES (@name, @email, @subject, @message)');

    return res.json({ message: 'Message received! We will be in touch soon.' });
  } catch (err) {
    console.error('Contact error:', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Catch-all: serve frontend ─────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start Server ─────────────────────────────────────────────────────
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 WAIT server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ Failed to initialize database:', err);
    process.exit(1);
  });
