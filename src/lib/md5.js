// Minimal MD5 (UTF-8 aware) — 用于 B 站 WBI 签名
function md5(str) {
  return hex(_md5(utf8Bytes(str)));
}

function utf8Bytes(s) {
  const out = [];
  for (const ch of unescape(encodeURIComponent(s))) out.push(ch.charCodeAt(0) & 0xff);
  return out;
}

function hex(n) { return n.toString(16); }

function _md5(bytes) {
  const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
             5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
             4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
             6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const K = new Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

  const ml = bytes.length * 8;
  const withOne = bytes.concat([0x80]);
  while (withOne.length % 64 !== 56) withOne.push(0);
  const lenLo = ml >>> 0, lenHi = Math.floor(ml / 4294967296);
  for (let i = 0; i < 4; i++) withOne.push((lenLo >>> (8 * i)) & 0xff);
  for (let i = 0; i < 4; i++) withOne.push((lenHi >>> (8 * i)) & 0xff);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let off = 0; off < withOne.length; off += 64) {
    const M = new Array(16);
    for (let i = 0; i < 16; i++) {
      M[i] = withOne[off + i*4] | (withOne[off + i*4 + 1] << 8) | (withOne[off + i*4 + 2] << 16) | (withOne[off + i*4 + 3] << 24);
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5*i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3*i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7*i) % 16; }
      F = (F + A + K[i] + (M[g] | 0)) | 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, S[i])) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }

  const words = [a0, b0, c0, d0];
  let out = '';
  for (const w of words) {
    for (let i = 0; i < 4; i++) {
      const b = (w >>> (8 * i)) & 0xff;
      out += ('0' + b.toString(16)).slice(-2);
    }
  }
  return out;
}

function rotl(x, c) { return (x << c) | (x >>> (32 - c)); }

export { md5 };
