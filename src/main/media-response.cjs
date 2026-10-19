const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { Readable } = require('node:stream');
async function mediaResponse(file, range, onClose = () => {}) {
  const { size } = await fs.stat(file);
  const extension = require('node:path').extname(file).toLowerCase();
  const type = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.aif': 'audio/aiff', '.aiff': 'audio/aiff' }[extension] || 'application/octet-stream';
  const headers = { 'Accept-Ranges': 'bytes', 'Content-Type': type };
  let start = 0, end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) { onClose(); return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } }); }
    start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) { onClose(); return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } }); }
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = String(end - start + 1);
  const stream = createReadStream(file, { start, end }); stream.once('close', onClose);
  return new Response(Readable.toWeb(stream), { status: range ? 206 : 200, headers });
}
module.exports = { mediaResponse };
