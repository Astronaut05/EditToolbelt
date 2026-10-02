/**
 * An in-place radix-2 complex FFT, for the time-stretcher's spectra. Sizes
 * are powers of two; the twiddles and bit-reversal for a size are made once.
 */
export class Fft {
  readonly size: number;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly reversed: Uint32Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0)
      throw new RangeError('FFT size must be a power of two');
    this.size = size;
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i += 1) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / size);
    }
    this.reversed = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i += 1) {
      let r = 0;
      for (let b = 0; b < bits; b += 1) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.reversed[i] = r;
    }
  }

  /** Forward (or, with `inverse`, the unscaled inverse) transform of re + i·im, in place. */
  transform(re: Float64Array, im: Float64Array, inverse = false): void {
    const n = this.size;
    const rev = this.reversed;
    for (let i = 0; i < n; i += 1) {
      const j = rev[i] ?? 0;
      if (j > i) {
        const tr = re[i] ?? 0;
        re[i] = re[j] ?? 0;
        re[j] = tr;
        const ti = im[i] ?? 0;
        im[i] = im[j] ?? 0;
        im[j] = ti;
      }
    }
    const sign = inverse ? -1 : 1;
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let start = 0; start < n; start += len) {
        for (let k = 0; k < half; k += 1) {
          const wr = this.cos[k * step] ?? 1;
          const wi = sign * (this.sin[k * step] ?? 0);
          const a = start + k;
          const b = a + half;
          const xr = (re[b] ?? 0) * wr - (im[b] ?? 0) * wi;
          const xi = (re[b] ?? 0) * wi + (im[b] ?? 0) * wr;
          re[b] = (re[a] ?? 0) - xr;
          im[b] = (im[a] ?? 0) - xi;
          re[a] = (re[a] ?? 0) + xr;
          im[a] = (im[a] ?? 0) + xi;
        }
      }
    }
  }
}
