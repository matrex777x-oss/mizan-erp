'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

/**
 * تهيئة التشغيل بأمر واحد: ملف إعدادات بمفتاح عشوائي، قاعدة بيانات جاهزة،
 * وشجرة حسابات ومستخدم أول عند أول إقلاع. مصمَّمة ليعمل التطبيق داخل أي
 * مشغّل خارجي (تطبيق نفق، خدمة نظام، حاوية) دون خطوات يدوية.
 */

// العنوانان في .env لأدوات prisma في سطر الأوامر وحدها: التشغيل يحسب مسار كل
// قاعدة بنفسه (lib/paths.js)، فلا يعتمد على قيمة مكتوبة هنا.
const ENV_DEFAULTS = {
  DATABASE_URL: '"file:./dev.db"',
  SYSTEM_DATABASE_URL: '"file:./system.db"',
};

/** يضمن وجود .env بمفتاح توقيع عشوائي لا يُولَّد مرتين. */
function ensureEnvFile() {
  const envPath = path.join(ROOT, '.env');

  if (fs.existsSync(envPath)) {
    // ملف قديم أُنشئ قبل قاعدة النظام: نكمل ما ينقصه دون المساس بمفتاح التوقيع
    const current = fs.readFileSync(envPath, 'utf8');
    const missing = Object.entries(ENV_DEFAULTS).filter(([key]) => !current.includes(`${key}=`));

    if (missing.length) {
      const addition = missing.map(([key, value]) => `${key}=${value}`).join('\n');
      fs.appendFileSync(envPath, `${current.endsWith('\n') ? '' : '\n'}${addition}\n`);
      console.log(`✓ أُضيف إلى backend/.env: ${missing.map(([key]) => key).join('، ')}`);
    }
    return envPath;
  }

  const secret = crypto.randomBytes(32).toString('hex');
  const content = [
    '# أُنشئ تلقائياً عند أول تشغيل',
    ...Object.entries(ENV_DEFAULTS).map(([key, value]) => `${key}=${value}`),
    `JWT_SECRET="${secret}"`,
    '',
  ].join('\n');

  fs.writeFileSync(envPath, content, { mode: 0o600 });
  console.log('✓ أُنشئ ملف الإعدادات backend/.env بمفتاح توقيع عشوائي');
  return envPath;
}

/**
 * يضبط عناوين القواعد في البيئة.
 *
 * لكل منشأة قاعدتها، وعنوانها يُحسب لحظة الاتصال (انظر lib/businessDb.js)، فما
 * يُضبط هنا هو قاعدة النظام وحدها — وتحتاجه أيضاً أدوات prisma في العمليات الفرعية.
 * `DATA_DIR` ينقل مجلد البيانات كله خارج المشروع فتبقى القواعد عند تحديث الكود.
 */
function resolveDatabaseUrl() {
  const { systemDbPath, fileUrl } = require('./lib/paths');
  process.env.SYSTEM_DATABASE_URL = fileUrl(systemDbPath());
  return process.env.SYSTEM_DATABASE_URL;
}

const PROJECT = path.join(ROOT, '..');

/** يشغّل أمراً في مجلد ويُظهر مخرجاته للمستخدم. */
function run(command, args, cwd) {
  execFileSync(command, args, { cwd, env: process.env, stdio: 'inherit', shell: process.platform === 'win32' });
}

/**
 * شبكة أمان: بعض المشغّلات تكتفي بـ `node index.js` دون خطوة بناء.
 * إن كانت الواجهة غير مبنيّة نبنيها مرة واحدة عند الإقلاع.
 */
function ensureFrontendBuilt() {
  const web = path.join(PROJECT, 'frontend');
  if (!fs.existsSync(web)) return;
  if (fs.existsSync(path.join(web, 'dist', 'index.html'))) return;

  try {
    if (!fs.existsSync(path.join(web, 'node_modules'))) {
      console.log('… تثبيت حزم الواجهة (مرة واحدة)');
      run('npm', ['install', '--no-audit', '--no-fund'], web);
    }
    console.log('… بناء الواجهة (مرة واحدة)');
    run('npm', ['run', 'build'], web);
  } catch {
    console.warn('تعذّر بناء الواجهة تلقائياً — شغّل: npm run setup');
  }
}

/**
 * شبكة أمان: عميل Prisma مولَّد لا مثبَّت. بعض المشغّلات تكتفي بـ `npm install`
 * ثم `npm start`، كما أن npm الحديث يحجب سكربتات التثبيت افتراضياً فلا يولّده
 * الحزمة نفسها. إن لم يكن مولَّداً نولّده مرة واحدة قبل أول استيراد له.
 */
function ensurePrismaClient() {
  const clients = [
    { schema: 'prisma/schema.prisma', out: ['node_modules', '.prisma', 'client'] },
    { schema: 'prisma/system.prisma', out: ['node_modules', '@prisma', 'system-client'] },
  ];

  for (const { schema, out } of clients) {
    const schemaPath = path.join(ROOT, schema);
    const outDir = path.join(ROOT, ...out);

    // بصمة المخطط الذي وُلّد منه العميل، نكتبها نحن بعد كل توليد ناجح.
    // لا نقارن بنسخة المخطط التي يضعها المولّد: هو يعيد تنسيقها فلا تطابق
    // الأصل حرفياً أبداً، فيبدو المخطط متغيّراً في كل إقلاع.
    const stampPath = path.join(outDir, '.mizan-schema');
    const stamp = crypto.createHash('sha256').update(fs.readFileSync(schemaPath)).digest('hex');

    let applied = null;
    try {
      applied = fs.readFileSync(stampPath, 'utf8').trim();
    } catch {
      applied = null;
    }

    // وجود العميل وحده لا يكفي: تحديث الكود قد يغيّر المخطط، فيتجاهل العميل
    // القديم الحقول الجديدة صمتاً — يكتبها ولا تُحفظ دون أي خطأ.
    if (applied === stamp && fs.existsSync(path.join(outDir, 'index.js'))) continue;

    console.log(
      applied
        ? `… المخطط ${schema} تغيّر — إعادة توليد العميل`
        : `… توليد عميل قاعدة البيانات من ${schema} (مرة واحدة)`,
    );

    try {
      execFileSync(
        process.execPath,
        [require.resolve('prisma/build/index.js'), 'generate', '--schema', schemaPath],
        { cwd: ROOT, env: process.env, stdio: 'inherit' },
      );
    } catch (err) {
      // على ويندوز يُقفل محرّك الاستعلام ما دامت نسخة أخرى من التطبيق تعمل
      throw new Error(
        `تعذّر توليد عميل قاعدة البيانات من ${schema}.\n` +
          'إن كانت نسخة أخرى من «ميزان» تعمل الآن فأوقفها ثم أعد التشغيل: ' +
          'ويندوز يقفل محرّك Prisma ما دامت عملية تستخدمه.\n' +
          `التفصيل: ${err.message}`,
      );
    }

    fs.writeFileSync(stampPath, stamp);
  }
}

/**
 * يجهّز قاعدة النظام وقواعد المنشآت عند الحاجة فقط.
 * يعيد بيانات الدخول الأولى إن كانت هذه أول مرة.
 */
async function prepareDatabase() {
  const { migrateLegacyIfNeeded } = require('./lib/migrateLegacy');
  const { prepareSystem } = require('./lib/systemBootstrap');

  // قاعدة ما قبل تعدّد المنشآت (backend/prisma/dev.db) تُرحَّل مرة واحدة
  await migrateLegacyIfNeeded();

  return prepareSystem();
}

module.exports = { ensureEnvFile, resolveDatabaseUrl, ensurePrismaClient, ensureFrontendBuilt, prepareDatabase, ROOT };
