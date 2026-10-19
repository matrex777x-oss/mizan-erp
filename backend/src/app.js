'use strict';

const express = require('express');
const cors = require('cors');

const { AppError } = require('./lib/errors');
const { authenticate } = require('./lib/auth');

const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/accounts');
const partyRoutes = require('./routes/parties');
const journalRoutes = require('./routes/journal');
const invoiceRoutes = require('./routes/invoices');
const paymentRoutes = require('./routes/payments');
const reportRoutes = require('./routes/reports');
const settingsRoutes = require('./routes/settings');

function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRoutes);

  app.use('/api', authenticate);
  app.use('/api/accounts', accountRoutes);
  app.use('/api/parties', partyRoutes);
  app.use('/api/journal', journalRoutes);
  app.use('/api/invoices', invoiceRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/settings', settingsRoutes);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'المسار غير موجود' }));

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
