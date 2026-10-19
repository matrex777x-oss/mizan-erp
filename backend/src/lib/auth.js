'use strict';

const jwt = require('jsonwebtoken');
const prisma = require('./prisma');
const { unauthorized, forbidden } = require('./errors');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_TTL = '12h';

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, SECRET, { expiresIn: TOKEN_TTL });
}

/** يقرأ المستخدم من ترويسة Authorization ويضعه في req.user. */
async function authenticate(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw unauthorized();

    let payload;
    try {
      payload = jwt.verify(token, SECRET);
    } catch {
      throw unauthorized('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً');
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) throw unauthorized('الحساب غير مفعّل');

    req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

/** يمنع الأدوار غير المسموح لها. */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/** كل ما يغيّر البيانات ممنوع على دور المُطّلع. */
const requireWrite = requireRole('OWNER', 'ACCOUNTANT');

module.exports = { signToken, authenticate, requireRole, requireWrite, SECRET };
