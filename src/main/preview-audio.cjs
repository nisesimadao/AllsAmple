// Splice's public web player unwraps its `sp` preview transport before feeding
// MP3 bytes to Web Audio. This is not a codec conversion or an original download.
// Observed player: https://splice.com/_app/immutable/chunks/BrQFmRJe.js
function unwrapPreview(bytes) {
  if (bytes[0] !== 0x73 || bytes[1] !== 0x70) return bytes;
  if (bytes.length < 29) throw new Error('試聴データのヘッダーが不完全です');
  const block = Number(bytes.readBigUInt64LE(2));
  if (!Number.isSafeInteger(block) || block < 1 || block * 3 > bytes.length - 28) throw new Error('試聴データのサイズが不正です');
  const key = bytes.subarray(10, 28), audio = Buffer.from(bytes.subarray(28));
  for (const start of [0, block * 2]) for (let i = 0; i < block; i++) audio[start + i] ^= key[i % key.length];
  if (!(audio.subarray(0, 3).equals(Buffer.from('ID3')) || (audio[0] === 255 && (audio[1] & 224) === 224))) throw new Error('試聴データをMP3として読み取れませんでした');
  return audio;
}
module.exports = { unwrapPreview };
