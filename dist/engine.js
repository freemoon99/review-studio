(function (root) {
  "use strict";
  const DEFAULTS = {
    exposure: 0,
    contrast: 0,
    saturation: 0,
    warmth: 0,
    shadows: 0,
  };
  const PRESETS = {
    natural: { ...DEFAULTS, contrast: 3, saturation: -3 },
    bright: {
      ...DEFAULTS,
      exposure: 18,
      contrast: 5,
      shadows: 12,
      saturation: -4,
    },
    warm: { ...DEFAULTS, exposure: 8, warmth: 12, saturation: 3, shadows: 5 },
  };
  const clamp = (n, min = 0, max = 255) => Math.max(min, Math.min(max, n));
  function applyTone(data, settings) {
    const s = { ...DEFAULTS, ...settings },
      gain = 2 ** (s.exposure / 100),
      c = (100 + s.contrast) / (100 - s.contrast * 0.8),
      sat = 1 + s.saturation / 100;
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      let r = data[i] * gain,
        g = data[i + 1] * gain,
        b = data[i + 2] * gain;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b,
        lift = s.shadows * 0.65 * (1 - Math.min(1, luma / 255)) ** 2;
      r = (r + lift - 128) * c + 128 + s.warmth * 0.7;
      g = (g + lift - 128) * c + 128 + s.warmth * 0.08;
      b = (b + lift - 128) * c + 128 - s.warmth * 0.7;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      data[i] = clamp(lum + (r - lum) * sat);
      data[i + 1] = clamp(lum + (g - lum) * sat);
      data[i + 2] = clamp(lum + (b - lum) * sat);
    }
    return data;
  }
  function autoExposure(data) {
    let sum = 0,
      count = 0;
    for (let i = 0; i < data.length; i += 16) {
      if (data[i + 3] < 128) continue;
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      count++;
    }
    if (!count) return 0;
    return Math.round(
      clamp(Math.log2(150 / Math.max(1, sum / count)) * 100, -35, 45),
    );
  }
  function cropRect(w, h, ratio = "original", px = 50, py = 50) {
    let width = w,
      height = h;
    const r = Number(ratio);
    if (Number.isFinite(r) && r > 0) {
      if (w / h > r) width = h * r;
      else height = w / r;
    }
    return {
      x: ((w - width) * clamp(px, 0, 100)) / 100,
      y: ((h - height) * clamp(py, 0, 100)) / 100,
      width,
      height,
    };
  }
  // Remove only the connected area near the chosen seed color. It is not object recognition.
  function removeConnected(data, width, height, x, y, tolerance) {
    x = clamp(Math.round(x), 0, width - 1);
    y = clamp(Math.round(y), 0, height - 1);
    const seed = y * width + x,
      si = seed * 4;
    if (data[si + 3] === 0) return 0;
    const color = [data[si], data[si + 1], data[si + 2]],
      limit = tolerance * tolerance * 3,
      queue = new Uint32Array(width * height),
      seen = new Uint8Array(width * height);
    let head = 0,
      tail = 1,
      removed = 0;
    queue[0] = seed;
    seen[seed] = 1;
    while (head < tail) {
      const p = queue[head++],
        i = p * 4;
      if (!data[i + 3]) continue;
      const dist =
        (data[i] - color[0]) ** 2 +
        (data[i + 1] - color[1]) ** 2 +
        (data[i + 2] - color[2]) ** 2;
      if (dist > limit) continue;
      data[i + 3] = 0;
      removed++;
      const col = p % width;
      const next = [
        col > 0 ? p - 1 : -1,
        col < width - 1 ? p + 1 : -1,
        p >= width ? p - width : -1,
        p < width * (height - 1) ? p + width : -1,
      ];
      for (const n of next)
        if (n >= 0 && !seen[n]) {
          seen[n] = 1;
          queue[tail++] = n;
        }
    }
    return removed;
  }
  const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  function crc32(data) {
    let c = 0xffffffff;
    for (const b of data) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function makeZip(files) {
    const encoder = new TextEncoder(),
      chunks = [],
      central = [];
    let offset = 0;
    for (const f of files) {
      const name = encoder.encode(f.name),
        bytes = f.bytes,
        crc = crc32(bytes),
        header = new Uint8Array(30 + name.length),
        v = new DataView(header.buffer);
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, 0x800, true);
      v.setUint32(14, crc, true);
      v.setUint32(18, bytes.length, true);
      v.setUint32(22, bytes.length, true);
      v.setUint16(26, name.length, true);
      header.set(name, 30);
      chunks.push(header, bytes);
      const record = new Uint8Array(46 + name.length),
        r = new DataView(record.buffer);
      r.setUint32(0, 0x02014b50, true);
      r.setUint16(4, 20, true);
      r.setUint16(6, 20, true);
      r.setUint16(8, 0x800, true);
      r.setUint32(16, crc, true);
      r.setUint32(20, bytes.length, true);
      r.setUint32(24, bytes.length, true);
      r.setUint16(28, name.length, true);
      r.setUint32(42, offset, true);
      record.set(name, 46);
      central.push(record);
      offset += header.length + bytes.length;
    }
    const size = central.reduce((n, b) => n + b.length, 0),
      end = new Uint8Array(22),
      v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, files.length, true);
    v.setUint16(10, files.length, true);
    v.setUint32(12, size, true);
    v.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, end], { type: "application/zip" });
  }
  root.ReviewEngine = {
    DEFAULTS,
    PRESETS,
    applyTone,
    autoExposure,
    cropRect,
    removeConnected,
    makeZip,
    crc32,
    clamp,
  };
  if (typeof module !== "undefined") module.exports = root.ReviewEngine;
})(typeof window !== "undefined" ? window : globalThis);
