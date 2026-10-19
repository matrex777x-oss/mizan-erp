'use strict';

/**
 * ترحيلات بيانات قاعدة المنشأة.
 *
 * `db push` يوائم الجداول ولا يملأ صفوفاً. وبعض التغييرات تحتاج ملء ما هو قائم:
 * إضافة المستودعات مثلاً تترك كل حركات المخزون السابقة بلا مستودع. هنا تُسجَّل
 * كل عملية باسمها فتُنفَّذ مرة واحدة على كل قاعدة.
 *
 * كل ترحيل يجب أن يكون **قابلاً لإعادة التنفيذ بلا ضرر**: قد يسقط الاتصال في
 * منتصفه قبل تسجيله، فيُعاد في الإقلاع التالي.
 */

const MIGRATIONS = [
  {
    name: '2026-10-warehouses',
    note: 'مستودع افتراضي، وإسناد حركات المخزون وأرصدته إليه',
    async run(db) {
      // 1) مستودع افتراضي واحد
      let warehouse = await db.warehouse.findFirst({ where: { isDefault: true } });
      if (!warehouse) {
        warehouse = await db.warehouse.findFirst({ orderBy: { createdAt: 'asc' } });
      }
      if (!warehouse) {
        warehouse = await db.warehouse.create({
          data: { code: 'MAIN', name: 'المستودع الرئيسي', isDefault: true },
        });
      }

      // 2) كل حركة بلا مستودع تصير فيه
      const moves = await db.stockMove.updateMany({
        where: { warehouseId: null },
        data: { warehouseId: warehouse.id },
      });

      await db.invoiceLine.updateMany({
        where: { warehouseId: null, itemId: { not: null } },
        data: { warehouseId: warehouse.id },
      });
      await db.stockAdjustmentLine.updateMany({
        where: { warehouseId: null },
        data: { warehouseId: warehouse.id },
      });

      // 3) رصيد كل صنف يصير رصيده في المستودع الافتراضي
      const items = await db.item.findMany({ where: { kind: 'STOCK' } });
      for (const item of items) {
        if (item.onHand === 0n && item.stockValue === 0n) continue;

        await db.itemStock.upsert({
          where: { itemId_warehouseId: { itemId: item.id, warehouseId: warehouse.id } },
          update: { onHand: item.onHand, stockValue: item.stockValue },
          create: {
            itemId: item.id,
            warehouseId: warehouse.id,
            onHand: item.onHand,
            stockValue: item.stockValue,
          },
        });
      }

      return `${moves.count} حركة، ${items.length} صنفاً`;
    },
  },
];

/** يشغّل ما لم يُنفَّذ من الترحيلات على قاعدة منشأة. */
async function runDataMigrations(db) {
  const applied = [];

  for (const migration of MIGRATIONS) {
    const done = await db.dataMigration.findUnique({ where: { name: migration.name } });
    if (done) continue;

    const detail = await migration.run(db);
    await db.dataMigration.create({
      data: { name: migration.name, note: detail || migration.note },
    });
    applied.push(`${migration.name} (${detail || migration.note})`);
  }

  return applied;
}

module.exports = { MIGRATIONS, runDataMigrations };
