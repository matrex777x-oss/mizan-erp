'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const money = require('../src/lib/money');

test('toMinor يقرأ الصيغ المختلفة ويقرّب نصف لأعلى', () => {
  assert.equal(money.toMinor('10'), 1000n);
  assert.equal(money.toMinor('10.5'), 1050n);
  assert.equal(money.toMinor('12.345'), 1235n);
  assert.equal(money.toMinor('12.344'), 1234n);
  assert.equal(money.toMinor('-3.456'), -346n);
  assert.equal(money.toMinor('.5'), 50n);
  assert.equal(money.toMinor('1,250.75'), 125075n);
  assert.equal(money.toMinor('١٢٣٤٫٥٦'), 123456n);
  assert.equal(money.toMinor(''), 0n);
});

test('toMinor يرفض القيم غير الرقمية', () => {
  assert.throws(() => money.toMinor('abc'));
  assert.throws(() => money.toMinor('1.2.3'));
});

test('fromMinor يعيد نصاً عشرياً بمنزلتين', () => {
  assert.equal(money.fromMinor(1235n), '12.35');
  assert.equal(money.fromMinor(0n), '0.00');
  assert.equal(money.fromMinor(-5n), '-0.05');
  assert.equal(money.fromMinor(100000n), '1000.00');
});

test('حساب السطر والضريبة بدقة الأعداد الصحيحة', () => {
  const quantity = money.toQuantity('2.5');
  const price = money.toMinor('10.33');
  const subtotal = money.lineAmount(quantity, price);
  assert.equal(subtotal, 2583n); // 25.825 => 25.83

  assert.equal(money.taxAmount(subtotal, money.toRate('15')), 387n); // 3.8745 => 3.87
  assert.equal(money.taxAmount(10000n, money.toRate('15')), 1500n);
  assert.equal(money.taxAmount(10000n, 0), 0n);
});

test('toRate يحوّل النسبة إلى عُشر من المئة', () => {
  assert.equal(money.toRate('15'), 1500);
  assert.equal(money.toRate('15.5'), 1550);
  assert.equal(money.toRate(0), 0);
});
