'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ExcelJS = require('exceljs');

const { badRequest } = require('../lib/errors');

/**
 * تصدير ما يراه المستخدم: الشاشة ترسل أعمدة الجدول وصفوفه، والخادم يضيف
 * ترويسة المنشأة من إعداداتها ويبني الملف.
 *
 * لماذا من الشاشة لا من التقرير في الخادم: التقارير محسوبة في مساراتها، وإعادة
 * حسابها للتصدير تعني منطقاً مكرَّراً قد يختلف عمّا عُرض. وما يُرسَل هنا بيانات
 * رآها المستخدم فعلاً وله صلاحيتها أصلاً — فلا يفتح التصدير باباً لما لا يراه.
 */

const MAX_ROWS = 20000;
const MAX_CELL = 500;

function validatePayload(body) {
  const title = String(body?.title || '').trim();
  if (!title) throw badRequest('عنوان التصدير مطلوب');

  const columns = Array.isArray(body?.columns) ? body.columns : [];
  if (!columns.length) throw badRequest('لا أعمدة للتصدير');

  const rows = Array.isArray(body?.rows) ? body.rows : [];
  if (rows.length > MAX_ROWS) throw badRequest(`التصدير محدود بـ ${MAX_ROWS} صفاً`);

  return {
    title: title.slice(0, 150),
    subtitle: String(body?.subtitle || '').slice(0, 300),
    columns: columns.slice(0, 40).map((column) => ({
      label: String(column?.label ?? '').slice(0, 80),
      numeric: Boolean(column?.numeric),
    })),
    rows: rows.map((row) =>
      (Array.isArray(row) ? row : []).slice(0, 40).map((cell) =>
        cell === null || cell === undefined ? '' : String(cell).slice(0, MAX_CELL),
      ),
    ),
    totals: Array.isArray(body?.totals)
      ? body.totals.slice(0, 40).map((cell) => (cell == null ? '' : String(cell).slice(0, MAX_CELL)))
      : null,
  };
}

/** رقم عشري كنص ← عدد، وما سواه يبقى نصاً. */
function asNumber(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u066C,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** ترويسة التصدير مبنيّة لا مرقّمة: كل سطر باسمه فلا يختلط العنوان بغيره. */
function header(settings, data) {
  return {
    company: settings?.companyName || 'منشأتي',
    details: [
      settings?.taxNumber ? `الرقم الضريبي: ${settings.taxNumber}` : null,
      settings?.phone,
      settings?.email,
      settings?.address,
    ]
      .filter(Boolean)
      .join(' · '),
    title: data.title,
    subtitle: data.subtitle,
    stamp: `صُدِّر في ${new Date().toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}`,
  };
}

/** الترويسة أسطراً، لورقة Excel. */
function headerLines(settings, data) {
  const meta = header(settings, data);
  return [meta.company, meta.details, meta.title, meta.subtitle, meta.stamp].filter(Boolean);
}

/** ملف Excel حقيقي (xlsx) بترويسة المنشأة وأعمدة الجدول. */
async function buildWorkbook(body, settings) {
  const data = validatePayload(body);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = settings?.companyName || 'ميزان';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(data.title.slice(0, 28) || 'تقرير', {
    views: [{ rightToLeft: true }],
    pageSetup: { orientation: 'landscape', fitToPage: true },
  });

  const width = data.columns.length;

  for (const line of headerLines(settings, data)) {
    const row = sheet.addRow([line]);
    sheet.mergeCells(row.number, 1, row.number, Math.max(width, 1));
    row.getCell(1).alignment = { horizontal: 'right' };
    row.getCell(1).font = { bold: row.number <= 1, size: row.number === 1 ? 14 : 11 };
  }
  sheet.addRow([]);

  const head = sheet.addRow(data.columns.map((column) => column.label));
  head.font = { bold: true };
  head.alignment = { horizontal: 'right' };
  head.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    cell.border = { bottom: { style: 'thin' } };
  });

  for (const row of data.rows) {
    const added = sheet.addRow(
      row.map((cell, index) => {
        // الأعمدة الرقمية تدخل أعداداً لا نصوصاً، فتُجمع وتُصفّى في Excel
        if (!data.columns[index]?.numeric) return cell;
        const number = asNumber(cell);
        return number === null ? cell : number;
      }),
    );

    added.eachCell((cell, index) => {
      const column = data.columns[index - 1];
      cell.alignment = { horizontal: column?.numeric ? 'left' : 'right' };
      if (column?.numeric && typeof cell.value === 'number') cell.numFmt = '#,##0.00';
    });
  }

  if (data.totals) {
    const totals = sheet.addRow(
      data.totals.map((cell, index) => {
        if (!data.columns[index]?.numeric) return cell;
        const number = asNumber(cell);
        return number === null ? cell : number;
      }),
    );
    totals.font = { bold: true };
    totals.eachCell((cell, index) => {
      cell.border = { top: { style: 'double' } };
      if (data.columns[index - 1]?.numeric && typeof cell.value === 'number') {
        cell.numFmt = '#,##0.00';
      }
    });
  }

  data.columns.forEach((column, index) => {
    const values = [column.label, ...data.rows.map((row) => row[index] ?? '')];
    const longest = values.reduce((max, value) => Math.max(max, String(value).length), 8);
    sheet.getColumn(index + 1).width = Math.min(Math.max(longest + 4, 12), 50);
  });

  return { buffer: await workbook.xlsx.writeBuffer(), title: data.title };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** صفحة HTML عربية مهيّأة للطباعة — تتحوّل إلى PDF كما هي. */
function buildHtml(body, settings) {
  const data = validatePayload(body);
  const meta = header(settings, data);

  const headCells = data.columns
    .map((column) => `<th class="${column.numeric ? 'num' : ''}">${escapeHtml(column.label)}</th>`)
    .join('');

  const rows = data.rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell, index) =>
              `<td class="${data.columns[index]?.numeric ? 'num' : ''}">${escapeHtml(cell)}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('');

  const totals = data.totals
    ? `<tfoot><tr>${data.totals
        .map(
          (cell, index) =>
            `<td class="${data.columns[index]?.numeric ? 'num' : ''}">${escapeHtml(cell)}</td>`,
        )
        .join('')}</tr></tfoot>`
    : '';

  // لا خطوط ولا سكربتات من الإنترنت: خطوط النظام تعرض العربية سليمة
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>${escapeHtml(data.title)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  /* ورقة بيضاء دائماً: المتصفّح بلا هذا يتبع نمط النظام الداكن فيختفي النص */
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { background: #fff; }
  body {
    font-family: "Segoe UI", Tahoma, "Noto Naskh Arabic", "Traditional Arabic", sans-serif;
    color: #111; margin: 0; padding: 10mm; font-size: 12px;
  }
  /* الطباعة تتكفّل بالهوامش عبر @page، فلا تُضاف إليها هوامش الصفحة */
  @media print { body { padding: 0; } }
  header { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 14px; }
  .company { font-size: 18px; font-weight: 700; }
  .meta { color: #555; font-size: 11px; margin-top: 2px; }
  h1 { font-size: 15px; margin: 10px 0 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: right; }
  th { background: #f1f1f1; font-weight: 700; border-bottom: 1px solid #999; }
  td.num, th.num { text-align: left; font-variant-numeric: tabular-nums; direction: ltr; }
  tfoot td { font-weight: 700; border-top: 2px solid #111; border-bottom: none; }
  tr { break-inside: avoid; }
  thead { display: table-header-group; }
</style>
</head>
<body>
  <header>
    <div class="company">${escapeHtml(meta.company)}</div>
    ${meta.details ? `<div class="meta">${escapeHtml(meta.details)}</div>` : ''}
    <h1>${escapeHtml(meta.title)}</h1>
    ${meta.subtitle ? `<div class="meta">${escapeHtml(meta.subtitle)}</div>` : ''}
    <div class="meta">${escapeHtml(meta.stamp)}</div>
  </header>
  <table>
    <thead><tr>${headCells}</tr></thead>
    <tbody>${rows}</tbody>
    ${totals}
  </table>
</body>
</html>`;
}

/**
 * متصفّح Chromium المثبَّت على الجهاز.
 *
 * لا نُنزّل Chromium مع الحزمة (أكثر من 150 ميغابايت): ويندوز فيه Edge دائماً،
 * وهو يعرض العربية بتشكيلها الصحيح — وهذا ما يصعب على مكتبات PDF المجرَّدة.
 */
// Chrome أولاً: بعض نسخ Edge على ويندوز لا تُقلع تحت التحكّم الآلي
const BROWSER_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

function browserCandidates() {
  const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH] : BROWSER_CANDIDATES;
  return candidates.filter((candidate) => fs.existsSync(path.normalize(candidate)));
}

function findBrowser() {
  return browserCandidates()[0] || null;
}

// أول متصفّح أقلع فعلاً — الوجود على القرص لا يعني أنه يعمل
let workingBrowser = null;

/**
 * يشغّل أول متصفّح يُقلع من المرشَّحين.
 * نجرّب ولا نكتفي بوجود الملف: نسخ Edge المثبَّتة من المتجر موجودة على القرص
 * وتفشل في الإقلاع تحت التحكّم الآلي، فيبقى التصدير معطّلاً بلا سبب ظاهر.
 */
async function launchBrowser() {
  const puppeteer = require('puppeteer-core');
  const options = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };

  const candidates = workingBrowser ? [workingBrowser, ...browserCandidates()] : browserCandidates();
  const failures = [];

  for (const executablePath of [...new Set(candidates)]) {
    try {
      const browser = await puppeteer.launch({ ...options, executablePath });
      workingBrowser = executablePath;
      return browser;
    } catch (err) {
      failures.push(`${path.basename(executablePath)}: ${err.message.split('\n')[0]}`);
    }
  }

  throw badRequest(
    failures.length
      ? `تعذّر تشغيل متصفّح لتوليد PDF (${failures.join(' · ')}). اضبط CHROME_PATH على متصفّح يعمل، أو صدّر Excel.`
      : 'لا يوجد متصفّح على الخادم لتوليد PDF. ثبّت Chrome، أو اضبط CHROME_PATH، أو صدّر Excel واطبع من متصفّحك.',
  );
}

async function renderPdf(html) {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
    });
  } finally {
    await browser.close();
  }
}

module.exports = {
  buildWorkbook,
  buildHtml,
  renderPdf,
  findBrowser,
  launchBrowser,
  validatePayload,
  MAX_ROWS,
};
