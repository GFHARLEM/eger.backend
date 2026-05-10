// ================================================================
// NjoroNest — Express Backend Server
// With JWT Authentication & Role-Based Access Control
// ================================================================

require('dotenv').config();
const express    = require('express');
const mysql      = require('mysql2/promise');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

const app  = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_njoronest_secret';

// ── CORS configuration — allow all origins ──────────────────────
app.use(cors({ origin: '*' }));

// ── UPLOADS FOLDER ───────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── MULTER (optional — gracefully skip if not installed) ─────────
let upload;
try {
  const multer  = require('multer');
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename:    (req, file, cb) => {
      const ext  = path.extname(file.originalname).toLowerCase();
      const name = `photo-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
      cb(null, name);
    }
  });
  const fileFilter = (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext     = path.extname(file.originalname).toLowerCase();
    allowed.includes(ext) ? cb(null, true) : cb(new Error('Only JPG/PNG/WEBP allowed'), false);
  };
  upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024, files: 4 } });
  console.log('✅ Multer loaded — photo uploads enabled');
} catch (e) {
  console.warn('⚠️  Multer not found. Run: npm install');
  console.warn('   Photo uploads disabled until multer is installed.');
  upload = { array: () => (req, res, next) => { req.files = []; next(); } };
}

// ── MIDDLEWARE ───────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, '..')));

// ── REQUEST LOGGER (helps debug) ─────────────────────────────────
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// ── DATABASE ─────────────────────────────────────────────────────
const db = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'school',
  port:               Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit:    10,
});

// ================================================================
// AUTH MIDDLEWARE
// ================================================================

// ── authenticateToken — verifies JWT from Authorization header ───
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer <token>"

  if (!token) {
    return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { user_id, username, email, role, phone }
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
  }
}

// ── authorizeRoles — checks if user role is in allowed list ──────
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions.' });
    }
    next();
  };
}

// ── AUTO-SETUP: create tables ────────────────────────────────────
async function setupDatabase() {
  try {
    const conn = await db.getConnection();
    console.log('✅ MySQL connected to database:', process.env.DB_NAME || 'school');

    // Create rooms table if it doesn't exist
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS rooms (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        title       VARCHAR(255)  NOT NULL,
        type        ENUM('bedsitter','single','one-bedroom','shared','airbnb') NOT NULL,
        price       INT           NOT NULL,
        pricing_model ENUM('monthly','nightly','daily') DEFAULT 'monthly',
        min_stay_days INT         DEFAULT 1,
        location    VARCHAR(255)  NOT NULL,
        latitude    DECIMAL(10,7) DEFAULT NULL,
        longitude   DECIMAL(10,7) DEFAULT NULL,
        distance    VARCHAR(100),
        amenities   TEXT,
        description TEXT,
        phone       VARCHAR(20)   NOT NULL,
        badge       ENUM('verified','new') DEFAULT NULL,
        icon        VARCHAR(10)   DEFAULT '🏠',
        photos      TEXT          DEFAULT NULL,
        available   TINYINT(1)    DEFAULT 1,
        created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create listing_requests table if it doesn't exist
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS listing_requests (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        landlord_name VARCHAR(150) NOT NULL,
        phone         VARCHAR(20)  NOT NULL,
        type          VARCHAR(50),
        price         INT,
        location      VARCHAR(255),
        distance      VARCHAR(100),
        amenities     TEXT,
        description   TEXT,
        photos        TEXT         DEFAULT NULL,
        status        ENUM('pending','approved','rejected') DEFAULT 'pending',
        submitted_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add columns safely (ignore if already exists)
    const safeAddColumn = async (table, column, definition) => {
      try { await conn.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); console.log(`✅ Added ${column} to ${table}`); }
      catch (e) { if (!e.message.includes('Duplicate column')) throw e; }
    };
    await safeAddColumn('rooms', 'photos', 'TEXT DEFAULT NULL');
    await safeAddColumn('rooms', 'pricing_model', "ENUM('monthly','nightly','daily') DEFAULT 'monthly'");
    await safeAddColumn('rooms', 'min_stay_days', 'INT DEFAULT 1');
    await safeAddColumn('rooms', 'latitude', 'DECIMAL(10,7) DEFAULT NULL');
    await safeAddColumn('rooms', 'longitude', 'DECIMAL(10,7) DEFAULT NULL');
    await safeAddColumn('listing_requests', 'photos', 'TEXT DEFAULT NULL');

    try {
      await conn.execute(`ALTER TABLE rooms MODIFY COLUMN type ENUM('bedsitter','single','one-bedroom','shared','airbnb') NOT NULL`);
    } catch (e) {
      if (!e.message.includes('already exists')) throw e;
    }

    // Create reviews table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS reviews (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        room_id       INT          NOT NULL,
        reviewer_name VARCHAR(120) NOT NULL,
        rating        TINYINT      NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment       TEXT         NOT NULL,
        created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      )
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS bookings (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        room_id       INT          NOT NULL,
        guest_name    VARCHAR(150) NOT NULL,
        guest_phone   VARCHAR(30)  NOT NULL,
        stay_days     INT          NOT NULL,
        check_in_date DATE         NOT NULL,
        check_out_date DATE        NOT NULL,
        total_price   INT          NOT NULL,
        status        ENUM('booked','cancelled','completed') DEFAULT 'booked',
        created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      )
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS booking_queue (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        room_id       INT          NOT NULL,
        guest_name    VARCHAR(150) NOT NULL,
        guest_phone   VARCHAR(30)  NOT NULL,
        stay_days     INT          NOT NULL,
        requested_check_in DATE    NOT NULL,
        status        ENUM('waiting','notified','closed') DEFAULT 'waiting',
        created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      )
    `);
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS listing_reports (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        room_id         INT          NOT NULL,
        reporter_name   VARCHAR(150) NOT NULL,
        reporter_phone  VARCHAR(30)  NOT NULL,
        reason          VARCHAR(120) NOT NULL,
        details         TEXT,
        created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      )
    `);

    // ── ROLES TABLE ──────────────────────────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS roles (
        role_id   INT AUTO_INCREMENT PRIMARY KEY,
        role_name VARCHAR(50) NOT NULL UNIQUE
      )
    `);

    // Seed roles
    const [[{ roleCount }]] = await conn.execute('SELECT COUNT(*) AS roleCount FROM roles');
    if (roleCount === 0) {
      await conn.execute(`INSERT INTO roles (role_name) VALUES ('student'), ('landlord'), ('admin')`);
      console.log('✅ Roles seeded: student, landlord, admin');
    }

    // ── USERS TABLE ──────────────────────────────────────────────
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS users (
        user_id       INT AUTO_INCREMENT PRIMARY KEY,
        username      VARCHAR(50)  NOT NULL UNIQUE,
        email         VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role_id       INT          NOT NULL,
        phone         VARCHAR(20)  DEFAULT NULL,
        created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (role_id) REFERENCES roles(role_id)
      )
    `);

    // Seed default admin user (admin@njoronest.com / admin123)
    const [[{ adminCount }]] = await conn.execute(
      `SELECT COUNT(*) AS adminCount FROM users u JOIN roles r ON u.role_id = r.role_id WHERE r.role_name = 'admin'`
    );
    if (adminCount === 0) {
      const [[adminRole]] = await conn.execute(`SELECT role_id FROM roles WHERE role_name = 'admin'`);
      if (adminRole) {
        const hash = await bcrypt.hash('admin123', 10);
        await conn.execute(
          `INSERT INTO users (username, email, password_hash, role_id, phone) VALUES (?, ?, ?, ?, ?)`,
          ['Admin', 'admin@njoronest.com', hash, adminRole.role_id, '0700000000']
        );
        console.log('✅ Default admin created: admin@njoronest.com / admin123');
      }
    }

    // Seed sample rooms if empty
    const [[{ count }]] = await conn.execute('SELECT COUNT(*) AS count FROM rooms');
    if (count === 0) {
      await conn.execute(`
        INSERT INTO rooms (title, type, price, pricing_model, min_stay_days, location, latitude, longitude, distance, amenities, description, phone, badge, icon) VALUES
        ('Spacious Bedsitter — Self Contained',  'bedsitter',   6000, 'monthly', 1, 'Njoro Town, 8 min walk', NULL, NULL, '8 min walk',  'Water, WiFi, Security, Parking',  'Lovely self-contained bedsitter with constant water, WiFi and 24hr security.', '0712345678', 'verified', '🏠'),
        ('Elegant Bedsitter — Near Gate A',      'bedsitter',   4500, 'monthly', 1, 'Njoro, 5 min walk', NULL, NULL, '5 min walk',  'Water, Security, Kitchen',        'Clean elegant bedsitter very close to the main university gate.', '0723456789', 'new', '🏡'),
        ('Single Room — Budget Friendly',        'single',      3000, 'monthly', 1, 'Njoro, 10 min walk', NULL, NULL, '10 min walk', 'Water, Shared Bathroom',          'Affordable single room in a shared compound. Good for tight budgets.', '0734567890', NULL, '🛏️'),
        ('1 Bedroom Apartment — Modern Finish',  'one-bedroom', 9500, 'monthly', 1, 'Njoro, 12 min walk', NULL, NULL, '12 min walk', 'WiFi, Water, Parking, Kitchen',   'Modern fully finished 1 bedroom. Tiled floor, instant shower, borehole water.', '0745678901', 'verified', '🏢'),
        ('Shared Room — 2 Students',             'shared',      2000, 'monthly', 1, 'Njoro, 6 min walk', NULL, NULL, '6 min walk',  'Water, Security, Budget',         'Looking for a roommate! Spacious room in a clean compound.', '0756789012', 'new', '👥'),
        ('Jirani Guest Suites — Njoro',          'airbnb',      1300, 'nightly', 1, 'Jirani Guest Suites, Njoro', -0.3657200, 35.9339100, '7 min drive', 'WiFi, Parking, Private Bath', 'Based on public short-stay listing references around Njoro.', '0767890123', 'verified', '🏨'),
        ('Kiamboni 1 Bedroom Stay — Njoro',      'airbnb',      2200, 'nightly', 2, 'Kiamboni area, Njoro', -0.3584500, 35.9201800, '9 min drive', 'WiFi, Kitchen, Parking, Hot Shower', 'Airbnb-style one-bedroom stay suitable for up to 4 guests.', '0711223344', 'new', '🧳'),
        ('Black Wattle House — Njoro',           'airbnb',      3200, 'nightly', 2, 'Black Wattle House, Njoro', -0.3526600, 35.9462000, '12 min drive', 'Garden, WiFi, Parking, Quiet Compound', 'Popular short-stay style house setup for visitors.', '0722334455', 'verified', '🏘️')
      `);
      console.log('✅ Sample rooms seeded into database');
    }

    conn.release();
    console.log('✅ Database ready\n');
  } catch (err) {
    console.error('\n❌ Database setup failed:', err.message);
    console.error('   Check your .env — DB_USER, DB_PASSWORD, DB_NAME');
    console.error('   Make sure MySQL is running.\n');
  }
}

// ================================================================
// AUTH ROUTES
// ================================================================

// ── POST /api/auth/register ──────────────────────────────────────
app.post('/api/auth/register', [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').isIn(['student', 'landlord']).withMessage('Role must be student or landlord'),
  body('phone').optional().trim()
], async (req, res) => {
  try {
    // Validate inputs
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: errors.array()[0].msg });
    }

    const { username, email, password, role, phone } = req.body;

    // Check if email or username already exists
    const [existing] = await db.execute(
      'SELECT user_id FROM users WHERE email = ? OR username = ?', [email, username]
    );
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Email or username already registered.' });
    }

    // Get role_id
    const [[roleRow]] = await db.execute('SELECT role_id FROM roles WHERE role_name = ?', [role]);
    if (!roleRow) {
      return res.status(400).json({ success: false, message: 'Invalid role.' });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Insert user
    const [result] = await db.execute(
      'INSERT INTO users (username, email, password_hash, role_id, phone) VALUES (?, ?, ?, ?, ?)',
      [username.trim(), email, password_hash, roleRow.role_id, phone || null]
    );

    console.log(`✅ User registered: ${username} (${role})`);
    res.status(201).json({
      success: true,
      message: 'Registration successful! You can now log in.',
      user_id: result.insertId
    });
  } catch (err) {
    console.error('POST /api/auth/register error:', err.message);
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────
app.post('/api/auth/login', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: errors.array()[0].msg });
    }

    const { email, password } = req.body;

    // Find user with role name
    const [users] = await db.execute(
      `SELECT u.*, r.role_name FROM users u JOIN roles r ON u.role_id = r.role_id WHERE u.email = ?`,
      [email]
    );
    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const user = users[0];

    // Compare password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // Generate JWT (expires in 24 hours)
    const token = jwt.sign(
      { user_id: user.user_id, username: user.username, email: user.email, role: user.role_name, phone: user.phone },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log(`✅ User logged in: ${user.username} (${user.role_name})`);
    res.json({
      success: true,
      message: 'Login successful!',
      token,
      user: {
        user_id: user.user_id,
        username: user.username,
        email: user.email,
        role: user.role_name,
        phone: user.phone
      }
    });
  } catch (err) {
    console.error('POST /api/auth/login error:', err.message);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});

// ── GET /api/auth/me — returns current user from token ───────────
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const [users] = await db.execute(
      `SELECT u.user_id, u.username, u.email, u.phone, r.role_name, u.created_at
       FROM users u JOIN roles r ON u.role_id = r.role_id WHERE u.user_id = ?`,
      [req.user.user_id]
    );
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    res.json({ success: true, user: users[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// PUBLIC ROUTES (existing — unchanged)
// ================================================================

// ── GET /api/rooms ───────────────────────────────────────────────
app.get('/api/rooms', async (req, res) => {
  try {
    const { type, minPrice, maxPrice, search, stayDays } = req.query;
    let sql    = `
      SELECT
        rooms.*,
        CASE
          WHEN rooms.type = 'airbnb'
          THEN (SELECT COUNT(DISTINCT b.guest_phone) FROM bookings b WHERE b.room_id = rooms.id)
          ELSE 0
        END AS total_bookings,
        CASE
          WHEN rooms.type = 'airbnb'
          THEN (SELECT COUNT(*) FROM booking_queue q WHERE q.room_id = rooms.id AND q.status = 'waiting')
          ELSE 0
        END AS queue_count,
        CASE
          WHEN rooms.type = 'airbnb'
          THEN (
            SELECT COUNT(*)
            FROM bookings b2
            WHERE b2.room_id = rooms.id
              AND b2.status = 'booked'
              AND b2.check_in_date <= CURDATE()
              AND b2.check_out_date > CURDATE()
          )
          ELSE 0
        END AS active_bookings,
        CASE
          WHEN rooms.type = 'airbnb'
          THEN (
            SELECT MIN(b4.check_out_date)
            FROM bookings b4
            WHERE b4.room_id = rooms.id
              AND b4.status = 'booked'
              AND b4.check_in_date <= CURDATE()
              AND b4.check_out_date > CURDATE()
          )
          ELSE NULL
        END AS next_available_date
      FROM rooms
      WHERE 1 = 1
    `;
    const params = [];

    if (type && type !== 'all')  {
      if (type === 'booked-airbnb') {
        sql += ` AND rooms.type = 'airbnb'
                 AND EXISTS (
                   SELECT 1
                   FROM bookings b3
                   WHERE b3.room_id = rooms.id
                     AND b3.status = 'booked'
                     AND b3.check_in_date <= CURDATE()
                     AND b3.check_out_date > CURDATE()
                 )`;
      } else {
        sql += ' AND rooms.type = ?';
        params.push(type);
      }
    }
    if (minPrice)                { sql += ' AND price >= ?';  params.push(Number(minPrice)); }
    if (maxPrice)                { sql += ' AND price <= ?';  params.push(Number(maxPrice)); }
    if (search) {
      sql += ' AND (title LIKE ? OR location LIKE ? OR amenities LIKE ? OR description LIKE ?)';
      const t = `%${search}%`;
      params.push(t, t, t, t);
    }
    if (stayDays) {
      sql += ' AND (type != "airbnb" OR min_stay_days <= ?)';
      params.push(Number(stayDays));
    }
    sql += ' ORDER BY created_at DESC';

    const [rows] = await db.execute(sql, params);
    res.json({ success: true, count: rows.length, rooms: rows });
  } catch (err) {
    console.error('GET /api/rooms error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/rooms/:id ───────────────────────────────────────────
app.get('/api/rooms/:id', async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM rooms WHERE id = ?', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Room not found.' });
    res.json({ success: true, room: rows[0] });
  } catch (err) {
    console.error('GET /api/rooms/:id error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/listings — AUTO-PUBLISH directly to rooms ──────────
app.post('/api/listings', upload.array('photos', 4), async (req, res) => {
  try {
    console.log('📋 New room submission:', req.body);
    const { landlord_name, phone, type, price, location, latitude, longitude, distance, amenities, description, pricing_model, min_stay_days } = req.body;

    const missing = [];
    if (!landlord_name) missing.push('Name');
    if (!phone)         missing.push('Phone');
    if (!price)         missing.push('Price');
    if (!location)      missing.push('Location');

    if (missing.length > 0) {
      if (req.files) req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch(_) {} });
      return res.status(400).json({ success: false, message: `Missing: ${missing.join(', ')}` });
    }

    const photoFilenames = req.files && req.files.length > 0
      ? req.files.map(f => f.filename).join(',') : null;

    const typeLabel = (type || 'bedsitter').charAt(0).toUpperCase() + (type || 'bedsitter').slice(1);
    const title     = `${typeLabel} — ${location}`;

    // Publish DIRECTLY to rooms with 'new' badge — no approval queue
    const [result] = await db.execute(
      `INSERT INTO rooms
        (title, type, price, pricing_model, min_stay_days, location, latitude, longitude, distance, amenities, description, phone, badge, icon, photos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', '🏠', ?)`,
      [title, type || 'bedsitter', Number(price) || 0, (pricing_model || 'monthly'),
       Number(min_stay_days) || 1, location, latitude ? Number(latitude) : null, longitude ? Number(longitude) : null,
       distance || null, amenities || null, description || null, phone, photoFilenames]
    );

    console.log(`✅ Room auto-published — ID ${result.insertId}`);
    res.status(201).json({
      success: true,
      message: 'Room is now live on the site!',
      room_id: result.insertId,
      photos_uploaded: req.files ? req.files.length : 0
    });
  } catch (err) {
    console.error('❌ POST /api/listings:', err.message);
    if (req.files) req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch(_) {} });
    res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

// ── GET /api/reviews/:roomId ─────────────────────────────────────
app.get('/api/reviews/:roomId', async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM reviews WHERE room_id = ? ORDER BY created_at DESC',
      [req.params.roomId]
    );
    res.json({ success: true, reviews: rows });
  } catch (err) {
    console.error('GET /api/reviews error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/reviews/:roomId ────────────────────────────────────
app.post('/api/reviews/:roomId', async (req, res) => {
  try {
    const { reviewer_name, rating, comment } = req.body;
    const roomId = req.params.roomId;

    if (!reviewer_name || !rating || !comment) {
      return res.status(400).json({ success: false, message: 'Name, rating and comment are required.' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' });
    }

    // Verify room exists
    const [rooms] = await db.execute('SELECT id FROM rooms WHERE id = ? AND available = 1', [roomId]);
    if (!rooms.length) return res.status(404).json({ success: false, message: 'Room not found.' });

    await db.execute(
      'INSERT INTO reviews (room_id, reviewer_name, rating, comment) VALUES (?, ?, ?, ?)',
      [roomId, reviewer_name.trim(), Number(rating), comment.trim()]
    );

    res.status(201).json({ success: true, message: 'Review posted!' });
  } catch (err) {
    console.error('POST /api/reviews error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/bookings/:roomId ────────────────────────────────────
app.post('/api/bookings/:roomId', async (req, res) => {
  try {
    const roomId = Number(req.params.roomId);
    const { guest_name, guest_phone, stay_days, check_in_date } = req.body;
    const days = Number(stay_days);

    if (!guest_name || !guest_phone || !days || !check_in_date) {
      return res.status(400).json({ success: false, message: 'Guest name, phone, stay days and check-in date are required.' });
    }
    if (days < 1) {
      return res.status(400).json({ success: false, message: 'Stay duration must be at least 1 day.' });
    }

    const [rooms] = await db.execute('SELECT * FROM rooms WHERE id = ?', [roomId]);
    if (!rooms.length) return res.status(404).json({ success: false, message: 'Listing not found.' });
    const room = rooms[0];

    if (room.type !== 'airbnb') {
      return res.status(400).json({ success: false, message: 'Bookings are only enabled for Airbnb listings.' });
    }
    if (days < Number(room.min_stay_days || 1)) {
      return res.status(400).json({ success: false, message: `Minimum stay is ${room.min_stay_days} day(s).` });
    }

    const checkIn = new Date(check_in_date);
    if (Number.isNaN(checkIn.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid check-in date.' });
    }
    const checkOut = new Date(checkIn);
    checkOut.setDate(checkOut.getDate() + days);

    const totalPrice = Number(room.price) * days;
    const requestedStart = check_in_date;
    const requestedEnd = checkOut.toISOString().slice(0, 10);
    const [overlaps] = await db.execute(
      `SELECT id
       FROM bookings
       WHERE room_id = ?
         AND status = 'booked'
         AND check_in_date < ?
         AND check_out_date > ?
       LIMIT 1`,
      [roomId, requestedEnd, requestedStart]
    );

    if (overlaps.length > 0) {
      await db.execute(
        `INSERT INTO booking_queue (room_id, guest_name, guest_phone, stay_days, requested_check_in)
         VALUES (?, ?, ?, ?, ?)`,
        [roomId, guest_name.trim(), guest_phone.trim(), days, check_in_date]
      );
      const [[{ queueCount }]] = await db.execute(
        'SELECT COUNT(*) AS queueCount FROM booking_queue WHERE room_id = ? AND status = "waiting"',
        [roomId]
      );
      return res.status(202).json({
        success: true,
        queued: true,
        queue_count: queueCount,
        message: 'Unit is currently unavailable. You have been added to queue.'
      });
    }

    const [result] = await db.execute(
      `INSERT INTO bookings (room_id, guest_name, guest_phone, stay_days, check_in_date, check_out_date, total_price)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        roomId,
        guest_name.trim(),
        guest_phone.trim(),
        days,
        check_in_date,
        checkOut.toISOString().slice(0, 10),
        totalPrice
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Booking confirmed.',
      booking_id: result.insertId,
      total_price: totalPrice,
      check_out_date: checkOut.toISOString().slice(0, 10)
    });
  } catch (err) {
    console.error('POST /api/bookings/:roomId error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/reports/:roomId ─────────────────────────────────────
app.post('/api/reports/:roomId', async (req, res) => {
  try {
    const roomId = Number(req.params.roomId);
    const { reporter_name, reporter_phone, reason, details } = req.body;

    if (!reporter_name || !reporter_phone || !reason) {
      return res.status(400).json({ success: false, message: 'Name, phone and reason are required.' });
    }

    const [rooms] = await db.execute('SELECT id FROM rooms WHERE id = ?', [roomId]);
    if (!rooms.length) return res.status(404).json({ success: false, message: 'Listing not found.' });

    const [rented] = await db.execute(
      'SELECT id FROM bookings WHERE room_id = ? AND guest_phone = ? LIMIT 1',
      [roomId, reporter_phone.trim()]
    );
    if (!rented.length) {
      return res.status(403).json({
        success: false,
        message: 'Only guests who have rented this listing at least once can report it.'
      });
    }

    await db.execute(
      `INSERT INTO listing_reports (room_id, reporter_name, reporter_phone, reason, details)
       VALUES (?, ?, ?, ?, ?)`,
      [roomId, reporter_name.trim(), reporter_phone.trim(), reason.trim(), (details || '').trim() || null]
    );
    res.status(201).json({ success: true, message: 'Report submitted successfully.' });
  } catch (err) {
    console.error('POST /api/reports/:roomId error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/stats ───────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const [[{ totalRooms }]]     = await db.execute('SELECT COUNT(*) AS totalRooms FROM rooms');
    const [[{ totalLandlords }]] = await db.execute('SELECT COUNT(DISTINCT phone) AS totalLandlords FROM rooms');
    res.json({ success: true, totalRooms, totalLandlords });
  } catch (err) {
    console.error('GET /api/stats error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// PROTECTED ROUTES — LANDLORD
// ================================================================

// ── GET /api/landlord/my-rooms — landlord's own rooms ────────────
app.get('/api/landlord/my-rooms', authenticateToken, authorizeRoles('landlord'), async (req, res) => {
  try {
    const phone = req.user.phone;
    if (!phone) return res.json({ success: true, rooms: [] });

    const [rows] = await db.execute('SELECT * FROM rooms WHERE phone = ? ORDER BY created_at DESC', [phone]);
    res.json({ success: true, rooms: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/rooms — landlord creates a room (phone from token) ─
app.post('/api/rooms', authenticateToken, authorizeRoles('landlord'), upload.array('photos', 4), async (req, res) => {
  try {
    const { title, type, price, pricing_model, min_stay_days, location, latitude, longitude, distance, amenities, description } = req.body;
    const phone = req.user.phone; // Use phone from JWT token

    if (!title || !price || !location) {
      if (req.files) req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch(_) {} });
      return res.status(400).json({ success: false, message: 'Title, price and location are required.' });
    }

    const photoFilenames = req.files && req.files.length > 0
      ? req.files.map(f => f.filename).join(',') : null;

    const [result] = await db.execute(
      `INSERT INTO rooms (title, type, price, pricing_model, min_stay_days, location, latitude, longitude, distance, amenities, description, phone, badge, icon, photos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', '🏠', ?)`,
      [title, type || 'bedsitter', Number(price) || 0, pricing_model || 'monthly',
       Number(min_stay_days) || 1, location, latitude ? Number(latitude) : null, longitude ? Number(longitude) : null,
       distance || null, amenities || null, description || null, phone || '', photoFilenames]
    );

    res.status(201).json({ success: true, message: 'Room created!', room_id: result.insertId });
  } catch (err) {
    if (req.files) req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch(_) {} });
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /api/rooms/:id — landlord updates own room ───────────────
app.put('/api/rooms/:id', authenticateToken, authorizeRoles('landlord'), async (req, res) => {
  try {
    const roomId = req.params.id;
    const phone = req.user.phone;

    // Make sure landlord owns this room
    const [existing] = await db.execute('SELECT * FROM rooms WHERE id = ? AND phone = ?', [roomId, phone]);
    if (!existing.length) {
      return res.status(403).json({ success: false, message: 'You can only edit your own rooms.' });
    }

    const { title, type, price, pricing_model, min_stay_days, location, distance, amenities, description } = req.body;

    await db.execute(
      `UPDATE rooms SET title=?, type=?, price=?, pricing_model=?, min_stay_days=?, location=?, distance=?, amenities=?, description=? WHERE id=? AND phone=?`,
      [title || existing[0].title, type || existing[0].type, Number(price) || existing[0].price,
       pricing_model || existing[0].pricing_model, Number(min_stay_days) || existing[0].min_stay_days,
       location || existing[0].location, distance || existing[0].distance,
       amenities || existing[0].amenities, description || existing[0].description, roomId, phone]
    );

    res.json({ success: true, message: 'Room updated!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/landlord/rooms/:id — landlord deletes own room ───
app.delete('/api/landlord/rooms/:id', authenticateToken, authorizeRoles('landlord'), async (req, res) => {
  try {
    const phone = req.user.phone;
    const [existing] = await db.execute('SELECT id FROM rooms WHERE id = ? AND phone = ?', [req.params.id, phone]);
    if (!existing.length) {
      return res.status(403).json({ success: false, message: 'You can only delete your own rooms.' });
    }
    await db.execute('DELETE FROM rooms WHERE id = ? AND phone = ?', [req.params.id, phone]);
    res.json({ success: true, message: 'Room deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================================================================
// PROTECTED ROUTES — STUDENT
// ================================================================

// ── GET /api/student/favorites — placeholder ─────────────────────
app.get('/api/student/favorites', authenticateToken, authorizeRoles('student'), (req, res) => {
  res.json({ success: true, favorites: [], message: 'Favorites feature coming soon!' });
});

// ================================================================
// PROTECTED ROUTES — ADMIN
// ================================================================

// ── GET /api/admin/users — list all users ────────────────────────
app.get('/api/admin/users', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT u.user_id, u.username, u.email, u.phone, r.role_name, u.created_at
       FROM users u JOIN roles r ON u.role_id = r.role_id ORDER BY u.created_at DESC`
    );
    res.json({ success: true, users: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/admin/users/:id — delete a user ──────────────────
app.delete('/api/admin/users/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    // Prevent deleting yourself
    if (Number(req.params.id) === req.user.user_id) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own account.' });
    }
    await db.execute('DELETE FROM users WHERE user_id = ?', [req.params.id]);
    res.json({ success: true, message: 'User deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/admin/requests ──────────────────────────────────────
app.get('/api/admin/requests', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM listing_requests ORDER BY submitted_at DESC');
    res.json({ success: true, requests: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/admin/approve/:id ──────────────────────────────────
app.post('/api/admin/approve/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const [requests] = await db.execute('SELECT * FROM listing_requests WHERE id = ?', [req.params.id]);
    if (!requests.length) return res.status(404).json({ success: false, message: 'Request not found.' });

    const r = requests[0];
    await db.execute(
      `INSERT INTO rooms (title, type, price, pricing_model, min_stay_days, location, latitude, longitude, distance, amenities, description, phone, badge, photos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
      [
        `${r.type.charAt(0).toUpperCase() + r.type.slice(1)} — ${r.location}`,
        r.type, r.price, r.pricing_model || 'monthly', r.min_stay_days || 1, r.location, r.latitude || null, r.longitude || null,
        r.distance, r.amenities, r.description, r.phone, r.photos || null
      ]
    );
    await db.execute('UPDATE listing_requests SET status = "approved" WHERE id = ?', [r.id]);
    res.json({ success: true, message: 'Room approved and published!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/admin/rooms/:id ──────────────────────────────────
app.delete('/api/admin/rooms/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    await db.execute('DELETE FROM rooms WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Room permanently deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/admin/stats — extended stats ────────────────────────
app.get('/api/admin/stats', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const [[{ totalRooms }]]     = await db.execute('SELECT COUNT(*) AS totalRooms FROM rooms');
    const [[{ totalLandlords }]] = await db.execute('SELECT COUNT(DISTINCT phone) AS totalLandlords FROM rooms');
    const [[{ totalUsers }]]     = await db.execute('SELECT COUNT(*) AS totalUsers FROM users');
    const [[{ totalBookings }]]  = await db.execute('SELECT COUNT(*) AS totalBookings FROM bookings');
    const [[{ totalReviews }]]   = await db.execute('SELECT COUNT(*) AS totalReviews FROM reviews');
    const [[{ totalReports }]]   = await db.execute('SELECT COUNT(*) AS totalReports FROM listing_reports');
    res.json({ success: true, totalRooms, totalLandlords, totalUsers, totalBookings, totalReviews, totalReports });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── HEALTH CHECK ─────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await db.execute('SELECT 1');
    res.json({ success: true, message: '🚀 Server running', db: 'connected', port: PORT });
  } catch (err) {
    res.json({ success: false, message: '🚀 Server running', db: 'disconnected', error: err.message });
  }
});

// ── MULTER ERROR HANDLER ─────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: 'Photo too large. Max 5MB per photo.' });
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ success: false, message: 'Max 4 photos allowed.' });
  }
  console.error('Server error:', err.message);
  res.status(500).json({ success: false, message: err.message });
});

// ── START ─────────────────────────────────────────────────────────
setupDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 NjoroNest running at http://localhost:${PORT}`);
    console.log(`   Test it: http://localhost:${PORT}/api/health\n`);
  });
});
 
