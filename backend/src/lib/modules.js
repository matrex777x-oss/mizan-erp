'use strict';

const prisma = require('./prisma');
const { badRequest } = require('./errors');

/**
 * وحدات اختيارية تُعطَّل من إعدادات المنشأة.
 *
 * التعطيل يُفرض في الخادم لا في الواجهة وحدها: إخفاء شاشة لا يمنع طلباً، وصنف
 * مخزني يُنشأ في منشأة «بلا مخزون» يظهر أثره في المركز المالي بلا شاشة تفسّره.
 * ولا تُعطَّل وحدة فيها حركة أصلاً (انظر routes/settings.js).
 */
async function inventoryEnabled() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  return settings ? settings.inventoryEnabled !== false : true;
}

async function assertInventoryEnabled() {
  if (!(await inventoryEnabled())) {
    throw badRequest('وحدة المخزون معطَّلة في إعدادات هذه المنشأة');
  }
}

/** وسيط يمنع المسار كله حين تكون الوحدة معطَّلة. */
function requireInventory(_req, _res, next) {
  assertInventoryEnabled().then(() => next(), next);
}

module.exports = { inventoryEnabled, assertInventoryEnabled, requireInventory };
