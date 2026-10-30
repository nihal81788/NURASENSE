import { Router } from 'express';
import jwt from 'jsonwebtoken';
import {
  findUserByEmail,
  findUserById,
  createUser,
  verifyPassword,
  updateLastLogin,
  generateOtp,
  verifyOtpCode
} from '../data/database.js';

export const authRouter = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'nurasense_clinical_telemetry_jwt_secret_2026';

/**
 * POST /api/auth/send-otp
 * Generates and stores a 6-digit verification code in SQLite.
 * Prints to terminal and returns in response for testing.
 */
authRouter.post('/send-otp', (req, res) => {
  try {
    const { email, purpose = 'signup' } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // If signing up, check if account already exists
    if (purpose === 'signup') {
      const existing = findUserByEmail(normalizedEmail);
      if (existing) {
        return res.status(409).json({
          error: 'An account with this email address already exists. Please sign in instead.'
        });
      }
    }

    const { otp, expiresAt, validityMinutes } = generateOtp(normalizedEmail, purpose, 10);

    console.log(`\n======================================================`);
    console.log(`🔐 [NURASENSE SECURITY OTP]`);
    console.log(`📧 Recipient: ${normalizedEmail}`);
    console.log(`🎯 Purpose:   ${purpose.toUpperCase()}`);
    console.log(`🔑 OTP Code:  ${otp}`);
    console.log(`⏱️  Valid for: ${validityMinutes} minutes (expires at ${new Date(expiresAt).toLocaleTimeString()})`);
    console.log(`======================================================\n`);

    return res.json({
      success: true,
      message: `A 6-digit verification code has been sent to ${normalizedEmail}`,
      email: normalizedEmail,
      purpose,
      validityMinutes,
      // previewOtp returned so user can test immediately in the UI
      previewOtp: otp
    });
  } catch (error) {
    console.error('[AUTH ERROR: send-otp]', error);
    return res.status(500).json({ error: 'Failed to generate verification code. ' + error.message });
  }
});

/**
 * POST /api/auth/verify-otp
 * Validates a submitted 6-digit OTP code against SQLite.
 */
authRouter.post('/verify-otp', (req, res) => {
  try {
    const { email, otp, purpose = 'signup' } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and 6-digit verification code are required.' });
    }

    const verification = verifyOtpCode(email, otp, purpose);
    if (!verification.valid) {
      return res.status(400).json({ error: verification.message });
    }

    return res.json({
      success: true,
      verified: true,
      message: 'Email successfully verified!'
    });
  } catch (error) {
    console.error('[AUTH ERROR: verify-otp]', error);
    return res.status(500).json({ error: 'Failed to verify OTP code. ' + error.message });
  }
});

/**
 * POST /api/auth/signup
 * Validates OTP, hashes password with bcrypt, and saves new user to SQLite.
 */
authRouter.post('/signup', (req, res) => {
  try {
    const { name, email, password, otp } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Full name must be at least 2 characters.' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }
    if (!otp || otp.toString().trim().length !== 6) {
      return res.status(400).json({ error: 'Please enter the 6-digit verification code sent to your email.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Verify OTP first
    const verification = verifyOtpCode(normalizedEmail, otp, 'signup');
    if (!verification.valid) {
      return res.status(400).json({ error: verification.message });
    }

    // Save to SQLite database
    const newUser = createUser({
      name: name.trim(),
      email: normalizedEmail,
      password: password
    });

    // Generate JWT auth session
    const token = jwt.sign(
      {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log(`✨ [NEW USER REGISTERED] ID: ${newUser.id} | Email: ${newUser.email} | Name: ${newUser.name}`);

    return res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role
      }
    });
  } catch (error) {
    console.error('[AUTH ERROR: signup]', error);
    return res.status(400).json({ error: error.message || 'Registration failed.' });
  }
});

/**
 * POST /api/auth/login
 * Validates credentials against SQLite users table with bcrypt.
 */
authRouter.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email address and password are required.' });
    }

    const user = findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email address or password.' });
    }

    const match = verifyPassword(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email address or password.' });
    }

    updateLastLogin(user.id);

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log(`🔓 [USER LOGGED IN] ${user.email} (${user.name})`);

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('[AUTH ERROR: login]', error);
    return res.status(500).json({ error: 'Authentication failed. ' + error.message });
  }
});

/**
 * GET /api/auth/me
 */
authRouter.get('/me', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = findUserById(decoded.id);
      if (user) {
        return res.json({
          success: true,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role
          }
        });
      }
    } catch (_) {}
  }

  // Fallback to demo profile
  const demoUser = findUserByEmail('patient@nurasense.app');
  return res.json({
    success: true,
    user: demoUser ? {
      id: demoUser.id,
      name: demoUser.name,
      email: demoUser.email,
      role: demoUser.role
    } : {
      id: 'usr_demo_patient',
      name: 'Maya Roberts',
      email: 'patient@nurasense.app',
      role: 'patient'
    }
  });
});
