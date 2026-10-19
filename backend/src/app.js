'use strict';

const fs = require('node:fs');
const path = require('node:path');

const express = require('express');
const cors = require('cors');

const { AppError } = require('./lib/errors');
const { authenticate, requirePasswordChanged, withBusiness, requireAdmin } = require('./lib/auth');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const businessRoutes = require('./routes/businesses');
const systemRoutes = require('./routes/system');
const accountRoutes = require('./routes/accounts');
const partyRoutes = require('./routes/parties');
const journalRoutes = require('./routes/journal');
const invoiceRoutes = require('./routes/invoices');
const paymentRoutes = require('./routes/payments');
const itemRoutes = require('./routes/items');
const adjustmentRoutes = require('./routes/adjustments');
const reportRoutes = require('./routes/reports');
const settingsRoutes = require('./routes/settings');

function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // الدخول وتغيير كلمة المرور: لا يلزمها منشأة، وبعضها قبل المصادقة
  app.use('/api/auth', authRoutes);

  app.use('/api', authenticate);
  app.use('/api', requirePasswordChanged);

  // إدارة النظام: قاعدة النظام لا قاعدة منشأة، فلا تمرّ بـ withBusiness
  app.use('/api/admin/users', requireAdmin, userRoutes);
  app.use('/api/admin/businesses', requireAdmin, businessRoutes);
  app.use('/api/admin/system', requireAdmin, systemRoutes);

  // من هنا كل شيء داخل منشأة واحدة: withBusiness يصل الطلب بقاعدتها وحدها
  app.use('/api', withBusiness);
  app.use('/api/accounts', accountRoutes);
  app.use('/api/parties', partyRoutes);
  app.use('/api/journal', journalRoutes);
  app.use('/api/invoices', invoiceRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/items', itemRoutes);
  app.use('/api/stock-adjustments', adjustmentRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/settings', settingsRoutes);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'المسار غير موجود' }));

  // الواجهة المبنيّة تُقدَّم من الخادم نفسه، فيكفي منفذ واحد للتطبيق كله
  const dist = process.env.FRONTEND_DIST || path.join(__dirname, '..', '..', 'frontend', 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    // أي مسار غير /api يعود إلى الواجهة لتتولّى التوجيه بنفسها
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    app.get('/', (_req, res) =>
      res
        .status(503)
        .type('text/plain; charset=utf-8')
        .send('الواجهة غير مبنيّة بعد. شغّل: npm run setup'),
    );
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: err.message, details: err.details });
    }
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'القيمة مستخدمة من قبل', details: err.meta?.target });
    }
    if (err?.code === 'P2025') {
      return res.status(404).json({ error: 'العنصر غير موجود' });
    }
    console.error(err);
    return res.status(500).json({ error: 'خطأ غير متوقع في الخادم' });
  });

  return app;
}

module.exports = { createApp };
