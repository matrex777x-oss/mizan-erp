'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

/**
 * قاعدة المنشأة الجارية في هذا الطلب.
 *
 * نمرّرها بسياق التنفيذ لا بوسيط في كل دالة: المسارات تستعمل `prisma` في 129
 * موضعاً، ونسيان تمرير القاعدة في موضع واحد يعني قراءة أو كتابة في قاعدة منشأة
 * أخرى — وهو خطأ صامت لا يظهر إلا بعد أن تختلط حسابات منشأتين. السياق يجعل
 * الخطأ مستحيلاً: إمّا أن تكون المنشأة محدَّدة أو يرمي الوصول خطأً صريحاً.
 */
const storage = new AsyncLocalStorage();

/** ينفّذ `fn` وكل ما ينتظره داخل سياق قاعدة منشأة واحدة. */
function runWithDb(client, fn) {
  return storage.run(client, fn);
}

function currentDb() {
  const db = storage.getStore();
  if (!db) {
    throw new Error(
      'لا توجد منشأة في سياق هذا الطلب: استُعملت قاعدة البيانات خارج runWithDb/withBusinessDb',
    );
  }
  return db;
}

function hasDb() {
  return Boolean(storage.getStore());
}

module.exports = { runWithDb, currentDb, hasDb };
