'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const prisma = require('../lib/prisma');
const { signToken, authenticate } = require('../lib/auth');
const { unauthorized } = require('../lib/errors');
const { requireString } = require('../lib/validate');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات كثيرة، حاول بعد قليل' },
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const email = requireString(req.body?.email, 'البريد الإلكتروني').toLowerCase();
    const password = requireString(req.body?.password, 'كلمة المرور', { max: 200 });

    const user = await prisma.user.findUnique({ where: { email } });
    const hash = user?.password || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok || !user.active) throw unauthorized('بيانات الدخول غير صحيحة');

    res.json({
      token: signToken(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

module.exports = router;
