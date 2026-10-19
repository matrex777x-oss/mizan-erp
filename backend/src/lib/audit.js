'use strict';

const systemDb = require('./systemDb');

/** أحداث سجل التدقيق المعروفة. */
const AUDIT_ACTIONS = {
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  PASSWORD_RESET: 'PASSWORD_RESET',
  USER_CREATE: 'USER_CREATE',
  USER_UPDATE: 'USER_UPDATE',
  USER_DEACTIVATE: 'USER_DEACTIVATE',
  BUSINESS_CREATE: 'BUSINESS_CREATE',
  BUSINESS_UPDATE: 'BUSINESS_UPDATE',
  ACCESS_GRANT: 'ACCESS_GRANT',
  ACCESS_REVOKE: 'ACCESS_REVOKE',
};

function clientIp(req) {
  return (req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '') || null;
}

/**
 * يكتب حدثاً في سجل التدقيق.
 *
 * لا يُفشل الطلب إن تعذّرت الكتابة: فقدان سطر في السجل أهون من رفض عملية
 * محاسبية صحيحة، والفشل يُطبع ليُرى.
 */
async function audit({ req = null, actor = null, businessId, action, target = null, detail = null }) {
  const who = actor || req?.user || null;

  try {
    await systemDb.auditLog.create({
      data: {
        userId: who?.id ?? null,
        userName: who?.name || who?.email || 'غير معروف',
        businessId: businessId !== undefined ? businessId : req?.businessId ?? null,
        action,
        target,
        detail,
        ip: req ? clientIp(req) : null,
      },
    });
  } catch (err) {
    console.warn('تعذّر كتابة سجل التدقيق:', err.message);
  }
}

module.exports = { audit, AUDIT_ACTIONS };
