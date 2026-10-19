'use strict';

const fs = require('node:fs');
const path = require('node:path');

const express = require('express');

const systemDb = require('../lib/systemDb');
const businessDb = require('../lib/businessDb');
const { audit, AUDIT_ACTIONS } = require('../lib/audit');
const { badRequest, notFound } = require('../lib/errors');
const { dataDir, systemDbPath, businessDbPath, BACKEND_ROOT } = require('../lib/paths');

const router = express.Router();

function sizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
}

function appVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND_ROOT, '..', 'package.json'), 'utf8'));
    return pkg.version;
  } catch {
    return null;
  }
}

/** حالة النظام: أين البيانات، وكم حجمها، وكم فيها من منشآت ومستخدمين. */
router.get('/', async (_req, res, next) => {
  try {
    const [users, activeUsers, admins, businesses, auditEntries] = await Promise.all([
      systemDb.user.count(),
      systemDb.user.count({ where: { active: true } }),
      systemDb.user.count({ where: { isAdmin: true, active: true } }),
      systemDb.business.findMany({ orderBy: { createdAt: 'asc' } }),
      systemDb.auditLog.count(),
    ]);

    res.json({
      version: appVersion(),
      node: process.version,
      // المشغّل الخارجي قد لا يمرّر DATA_DIR، فيُفيد المستخدمَ أن يرى أين تقع بياناته
      dataDir: dataDir(),
      dataDirIsDefault: !process.env.DATA_DIR,
      uptimeSeconds: Math.round(process.uptime()),
      systemDb: { path: systemDbPath(), size: sizeOf(systemDbPath()) },
      counts: { users, activeUsers, admins, businesses: businesses.length, auditEntries },
      businesses: businesses.map((business) => ({
        id: business.id,
        name: business.name,
        slug: business.slug,
        active: business.active,
        createdAt: business.createdAt,
        size: sizeOf(businessDbPath(business.slug)),
        exists: businessDb.businessDbExists(business.slug),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * تنزيل نسخة احتياطية من قاعدة منشأة.
 *
 * الملف نسخة كاملة تعمل وحدها: SQLite ملف واحد، فحفظه حفظ للمنشأة كلها.
 * نُنزّله كما هو دون إيقاف الخادم — والقراءة أثناء الكتابة قد تلتقط لحظة غير
 * متّسقة، لذا نأخذ نسخة بـ VACUUM INTO: تكتب ملفاً متّسقاً من لقطة واحدة.
 */
router.get('/backup/:businessId', async (req, res, next) => {
  let temp = null;

  try {
    const business = await systemDb.business.findUnique({ where: { id: req.params.businessId } });
    if (!business) throw notFound('المنشأة غير موجودة');
    if (!businessDb.businessDbExists(business.slug)) throw badRequest('لا توجد قاعدة لهذه المنشأة');

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    temp = path.join(dataDir(), `backup-${business.slug}-${stamp}.db`);

    const db = businessDb.getBusinessDb(business.slug);
    // VACUUM INTO لا يقبل وسيطاً مربوطاً، والمسار من صنعنا لا من المستخدم
    await db.$executeRawUnsafe(`VACUUM INTO '${temp.replace(/'/g, "''")}'`);

    await audit({
      req,
      businessId: business.id,
      action: AUDIT_ACTIONS.BACKUP_DOWNLOAD,
      target: business.id,
      detail: `${business.name} (${sizeOf(temp)} بايت)`,
    });

    res.download(temp, `mizan-${business.slug}-${stamp}.db`, (err) => {
      fs.rmSync(temp, { force: true });
      if (err && !res.headersSent) next(err);
    });
  } catch (err) {
    if (temp) fs.rmSync(temp, { force: true });
    next(err);
  }
});

module.exports = router;
