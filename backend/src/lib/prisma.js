'use strict';

const { currentDb } = require('./dbContext');

/**
 * وكيل على قاعدة المنشأة الجارية.
 *
 * يبقى `require('../lib/prisma')` كما هو في كل المسارات، لكن الاتصال يُحلّ لحظة
 * الاستعمال لا لحظة الاستيراد — فلكل منشأة قاعدتها، والوحدة تُستورَد مرة واحدة.
 */
module.exports = new Proxy(
  {},
  {
    get(_target, prop) {
      const db = currentDb();
      const value = db[prop];
      return typeof value === 'function' ? value.bind(db) : value;
    },
    set(_target, prop, value) {
      currentDb()[prop] = value;
      return true;
    },
    has(_target, prop) {
      return prop in currentDb();
    },
  },
);
