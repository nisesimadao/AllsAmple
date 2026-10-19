// Original synthetic audio, generated only in temporary test folders.
function wav({ seconds = 3, frequency = 440, channels = 1, sampleRate = 44100 } = {}) {
  const frames = seconds * sampleRate, bytes = frames * channels * 2;
  const buffer = Buffer.alloc(44 + bytes); buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + bytes, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(channels, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * channels * 2, 28); buffer.writeUInt16LE(channels * 2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(bytes, 40);
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * frame / sampleRate) * 9000), 44 + (frame * channels + channel) * 2);
  return buffer;
}
module.exports = { wav };
