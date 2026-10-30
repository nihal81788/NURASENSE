/**
 * NuraSense — Relational SQLite Database Engine
 * High-performance ACID SQL database powered by Node.js built-in `node:sqlite`.
 * Manages verified users, bcrypt-hashed credentials, and OTP verification lifecycle.
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = process.env.VERCEL ? '/tmp' : __dirname;

// Ensure database directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_PATH = path.join(DB_DIR, 'nurasense.db');
export const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for high-concurrency read/writes
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
`);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'patient',
    is_verified INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    last_login TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

  CREATE TABLE IF NOT EXISTS otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL COLLATE NOCASE,
    otp TEXT NOT NULL,
    purpose TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_otps_email_purpose ON otps(email, purpose);
`);

/**
 * Seed initial demo account if not present
 */
function seedInitialData() {
  const findDemo = db.prepare('SELECT id FROM users WHERE email = ?');
  const demoUser = findDemo.get('patient@nurasense.app');
  if (!demoUser) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('nura-demo', salt);
    const insert = db.prepare(`
      INSERT INTO users (id, email, password_hash, name, role, is_verified, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      'usr_demo_patient',
      'patient@nurasense.app',
      hash,
      'Maya Roberts',
      'patient',
      1,
      new Date().toISOString()
    );
    console.log('✅ Seeded default demo patient (patient@nurasense.app) into SQLite database');
  }
}

seedInitialData();

/**
 * User CRUD Operations
 */
export function findUserByEmail(email) {
  if (!email) return null;
  const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
  return stmt.get(email.trim().toLowerCase());
}

export function findUserById(id) {
  if (!id) return null;
  const stmt = db.prepare('SELECT id, email, name, role, is_verified, created_at, last_login FROM users WHERE id = ?');
  return stmt.get(id);
}

export function createUser({ name, email, password, role = 'patient' }) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = findUserByEmail(normalizedEmail);
  if (existing) {
    throw new Error('An account with this email address already exists.');
  }

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password, salt);
  const id = 'usr_' + crypto.randomBytes(8).toString('hex');
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO users (id, email, password_hash, name, role, is_verified, created_at, last_login)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `);
  stmt.run(id, normalizedEmail, passwordHash, name.trim(), role, now, now);

  return {
    id,
    email: normalizedEmail,
    name: name.trim(),
    role,
    is_verified: 1,
    created_at: now
  };
}

export function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

export function updateLastLogin(id) {
  const stmt = db.prepare('UPDATE users SET last_login = ? WHERE id = ?');
  stmt.run(new Date().toISOString(), id);
}

/**
 * OTP (One-Time Password) Lifecycle Operations
 */
export function generateOtp(email, purpose = 'signup', validityMinutes = 10) {
  const normalizedEmail = email.trim().toLowerCase();
  // Invalidate any previously unconsumed OTPs for this email & purpose
  db.prepare('UPDATE otps SET consumed = 1 WHERE email = ? AND purpose = ? AND consumed = 0').run(normalizedEmail, purpose);

  // Generate cryptographically secure 6-digit number
  const otpCode = crypto.randomInt(100000, 1000000).toString();
  const expiresAt = Date.now() + validityMinutes * 60 * 1000;
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO otps (email, otp, purpose, expires_at, consumed, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `);
  insert.run(normalizedEmail, otpCode, purpose, expiresAt, now);

  return {
    otp: otpCode,
    expiresAt,
    validityMinutes
  };
}

export function verifyOtpCode(email, otp, purpose = 'signup') {
  if (!email || !otp) return { valid: false, message: 'Email and OTP code are required.' };
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedOtp = otp.toString().trim();

  const stmt = db.prepare(`
    SELECT * FROM otps 
    WHERE email = ? AND purpose = ? AND consumed = 0
    ORDER BY id DESC LIMIT 1
  `);
  const record = stmt.get(normalizedEmail, purpose);

  if (!record) {
    return { valid: false, message: 'No active verification code found. Please request a new code.' };
  }

  if (Date.now() > record.expires_at) {
    // Mark as consumed since expired
    db.prepare('UPDATE otps SET consumed = 1 WHERE id = ?').run(record.id);
    return { valid: false, message: 'Verification code has expired. Please request a new one.' };
  }

  if (record.otp !== normalizedOtp) {
    return { valid: false, message: 'Incorrect 6-digit verification code. Please check and try again.' };
  }

  // Mark as successfully consumed
  db.prepare('UPDATE otps SET consumed = 1 WHERE id = ?').run(record.id);
  return { valid: true };
}
