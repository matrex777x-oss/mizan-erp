'use strict';

const { badRequest } = require('./errors');

function requireString(value, field, { max = 255, min = 1 } = {}) {
  if (typeof value !== 'string') throw badRequest(`الحقل «${field}» مطلوب`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw badRequest(`الحقل «${field}» مطلوب`);
  if (trimmed.length > max) throw badRequest(`الحقل «${field}» أطول من ${max} حرفاً`);
  return trimmed;
}

function optionalString(value, field, { max = 255 } = {}) {
  if (value === null || value === undefined || value === '') return null;
  return requireString(value, field, { max });
}

function requireEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw badRequest(`قيمة «${field}» غير صالحة. المسموح: ${allowed.join('، ')}`);
  }
  return value;
}

function requireDate(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest(`تاريخ «${field}» غير صالح`);
  // نثبّت التاريخ على منتصف النهار UTC حتى لا تنزلق الأيام بين المناطق الزمنية
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
}

function optionalDate(value, field) {
  if (value === null || value === undefined || value === '') return null;
  return requireDate(value, field);
}

function requireArray(value, field, { min = 1 } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    throw badRequest(`الحقل «${field}» يجب أن يحتوي على ${min} عنصر على الأقل`);
  }
  return value;
}

module.exports = {
  requireString,
  optionalString,
  requireEnum,
  requireDate,
  optionalDate,
  requireArray,
};
