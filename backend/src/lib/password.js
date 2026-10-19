'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const { badRequest } = require('./errors');

const MIN_LENGTH = 8;

/**
 * كلمات المرور تُخزَّن بـ bcrypt — وهي تجزئة في اتجاه واحد لا تُفك.
 * فلا يمكن لأحد عرض كلمة مرور قائمة، ولا لآدمن النظام نفسه: يعيد تعيينها فقط.
 */
function hash(plain) {
  return bcrypt.hash(plain, 10);
}

function compare(plain, hashed) {
  return bcrypt.compare(plain, hashed || '');
}

/** تجزئة وهمية بطول صحيح، تُقارَن بها المحاولات على بريد غير موجود. */
const DUMMY_HASH = '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';

function requireStrong(value, label = 'كلمة المرور') {
  if (typeof value !== 'string' || !value) throw badRequest(`${label} مطلوبة`);
  if (value.length < MIN_LENGTH) throw badRequest(`${label} يجب أن تكون ${MIN_LENGTH} أحرف على الأقل`);
  if (value.length > 200) throw badRequest(`${label} طويلة جداً`);
  if (!/[A-Za-z؀-ۿ]/.test(value)) throw badRequest(`${label} يجب أن تحتوي حرفاً واحداً على الأقل`);
  if (!/[0-9]/.test(value)) throw badRequest(`${label} يجب أن تحتوي رقماً واحداً على الأقل`);
  return value;
}

/** كلمة مرور مؤقتة تُعرض مرة واحدة عند إعادة التعيين. */
function temporary() {
  const body = crypto.randomBytes(4).toString('hex');
  return `Mizan@${body}`;
}

module.exports = { hash, compare, requireStrong, temporary, DUMMY_HASH, MIN_LENGTH };
