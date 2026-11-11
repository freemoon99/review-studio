const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const E = require("../dist/engine.js");
const original = new Uint8ClampedArray([100, 50, 200, 255, 250, 0, 100, 0]);
assert.deepEqual(
  Array.from(E.applyTone(original.slice(), E.DEFAULTS)),
  Array.from(original),
);
const bright = E.applyTone(new Uint8ClampedArray([80, 80, 80, 127]), {
  exposure: 100,
});
assert.deepEqual(Array.from(bright), [160, 160, 160, 127]);
const gray = E.applyTone(new Uint8ClampedArray([160, 80, 40, 255]), {
  saturation: -100,
});
assert.equal(gray[0], gray[1]);
assert.equal(gray[1], gray[2]);
const transparent = new Uint8ClampedArray(16);
assert.equal(E.autoExposure(transparent), 0);
assert.equal(E.autoExposure(new Uint8ClampedArray([1, 1, 1, 255])), 45);
for (const [w, h] of [
  [900, 1200],
  [2400, 1600],
])
  for (const r of [1, 0.75, 4 / 3, 16 / 9])
    for (const pos of [0, 50, 100]) {
      const c = E.cropRect(w, h, r, pos, pos);
      assert(Math.abs(c.width / c.height - r) < 1e-8);
      assert(
        c.x >= 0 &&
          c.y >= 0 &&
          c.x + c.width <= w + 0.001 &&
          c.y + c.height <= h + 0.001,
      );
    }
const image = new Uint8ClampedArray(5 * 3 * 4);
for (let p = 0; p < 15; p++) {
  const i = p * 4,
    col = p % 5;
  image.set(col === 2 ? [20, 80, 20, 255] : [240, 240, 240, 255], i);
}
assert.equal(E.removeConnected(image, 5, 3, 0, 1, 10), 6);
assert.equal(image[(1 * 5 + 2) * 4 + 3], 255);
assert.equal(image[(1 * 5 + 4) * 4 + 3], 255);
assert.equal(E.removeConnected(image, 5, 3, 0, 1, 10), 0);
// No row-wrap leak from rightmost pixel to leftmost pixel in next row.
const edge = new Uint8ClampedArray([
  0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255,
]);
assert.equal(E.removeConnected(edge, 2, 2, 1, 0, 1), 1);
assert.equal(edge[11], 255);
(async () => {
  const zip = E.makeZip([
    { name: "01-제품.jpg", bytes: new Uint8Array([1, 2, 3, 4]) },
    { name: "02-photo.png", bytes: new TextEncoder().encode("photo-bytes") },
  ]);
  fs.writeFileSync(
    path.join(__dirname, "studio-test.zip"),
    Buffer.from(await zip.arrayBuffer()),
  );
  assert.equal(E.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  console.log(
    "PASS: tone identity, exposure, alpha, grayscale, auto-exposure, 24 crop boundaries, connected background removal, row boundary, transparent seed, ZIP CRC.",
  );
})();
