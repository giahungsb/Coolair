/* Unit test: parseLocation — validate check-in GPS (chống dữ liệu bẩn từ client). */
const test = require('node:test'), assert = require('node:assert');
const { parseLocation } = require('../server/routes/posts.js');

test('location hợp lệ -> trả về {name,lat,lng}', () => {
  const r = parseLocation({ location: { name: 'Hồ Gươm', lat: 21.0285, lng: 105.8542 } });
  assert.deepStrictEqual(r, { name: 'Hồ Gươm', lat: 21.0285, lng: 105.8542 });
});

test('thiếu name -> undefined (không check-in)', () => {
  assert.strictEqual(parseLocation({ location: { name: '', lat: 21, lng: 105 } }), undefined);
  assert.strictEqual(parseLocation({}), undefined);
  assert.strictEqual(parseLocation(null), undefined);
});

test('tọa độ ngoài biên -> undefined', () => {
  assert.strictEqual(parseLocation({ location: { name: 'X', lat: 91, lng: 105 } }), undefined);
  assert.strictEqual(parseLocation({ location: { name: 'X', lat: 21, lng: 181 } }), undefined);
  assert.strictEqual(parseLocation({ location: { name: 'X', lat: NaN, lng: 105 } }), undefined);
  assert.strictEqual(parseLocation({ location: { name: 'X', lat: 'abc', lng: 105 } }), undefined);
});

test('name quá dài -> cắt 100 ký tự', () => {
  const r = parseLocation({ location: { name: 'a'.repeat(200), lat: 21, lng: 105 } });
  assert.strictEqual(r.name.length, 100);
});

test('tọa độ biên hợp lệ (-90/90, -180/180)', () => {
  assert.ok(parseLocation({ location: { name: 'X', lat: -90, lng: -180 } }));
  assert.ok(parseLocation({ location: { name: 'X', lat: 90, lng: 180 } }));
});
