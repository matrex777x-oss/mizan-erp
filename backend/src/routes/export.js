'use strict';

const express = require('express');

const prisma = require('../lib/prisma');
const { buildWorkbook, buildHtml, renderPdf, findBrowser } = require('../services/exporters');

const router = express.Router();

/**
 * التصدير متاح لكل عضو في المنشأة بلا قدرة خاصة: ما يُصدَّر هو ما عُرض على
 * الشاشة، والشاشات نفسها محكومة بالقدرات. فمن لا يرى تقريراً لا يملك بياناته
 * أصلاً ليرسلها.
 */

/** اسم ملف آمن من عنوان عربي. */
function fileName(title, extension) {
  const safe = String(title || 'تقرير')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .slice(0, 60) || 'تقرير';
  const stamp = new Date().toISOString().slice(0, 10);
  return `${safe}-${stamp}.${extension}`;
}

async function settingsOf() {
  return prisma.settings.findUnique({ where: { id: 1 } });
}

router.get('/capabilities', (_req, res) => {
  // الواجهة تخفي زر PDF حين لا يوجد متصفّح على الخادم بدل أن يفشل الزر
  res.json({ xlsx: true, pdf: Boolean(findBrowser()) });
});

router.post('/xlsx', async (req, res, next) => {
  try {
    const settings = await settingsOf();
    const { buffer, title } = await buildWorkbook(req.body, settings);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName(title, 'xlsx'))}`,
    );
    res.send(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
});

router.post('/pdf', async (req, res, next) => {
  try {
    const settings = await settingsOf();
    const html = buildHtml(req.body, settings);
    const pdf = await renderPdf(html);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName(req.body?.title, 'pdf'))}`,
    );
    res.send(Buffer.from(pdf));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
