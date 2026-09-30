/** Synthetic audio for the engines' tests: generated, so no fixture files to license. */

/** A 16-bit mono WAV of a sine tone. */
export function toneWav(seconds: number, rate: number, hz: number): Blob {
  const frames = Math.round(seconds * rate);
  const data = new DataView(new ArrayBuffer(44 + frames * 2));
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) data.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  data.setUint32(4, 36 + frames * 2, true);
  text(8, 'WAVEfmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, rate, true);
  data.setUint32(28, rate * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  text(36, 'data');
  data.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i += 1) {
    data.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 12_000), true);
  }
  return new Blob([data.buffer]);
}
