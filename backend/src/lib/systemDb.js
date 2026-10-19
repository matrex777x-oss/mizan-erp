'use strict';

const { PrismaClient } = require('@prisma/system-client');
const { systemDbPath, fileUrl } = require('./paths');

/**
 * عميل قاعدة النظام — واحد لكل عملية.
 *
 * يُنشأ عند أول استعمال لا عند الاستيراد، حتى تكون متغيرات البيئة ومجلد البيانات
 * قد ضُبطا (سكربتات الترحيل والطوارئ تضبطهما بنفسها).
 */
let client = null;

function connect() {
  if (!client) {
    client = new PrismaClient({
      datasources: { db: { url: fileUrl(systemDbPath()) } },
    });
  }
  return client;
}

async function disconnect() {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}

const proxy = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === 'disconnect') return disconnect;
      const db = connect();
      const value = db[prop];
      return typeof value === 'function' ? value.bind(db) : value;
    },
    has(_target, prop) {
      return prop in connect();
    },
  },
);

module.exports = proxy;
