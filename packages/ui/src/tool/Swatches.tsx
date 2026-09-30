'use client';

import { CopyButton } from '../primitives/CopyButton';

export interface SwatchInfo {
  hex: string;
  rgb: string;
  hsl: string;
  /** Share of the image, 0-1. */
  share: number;
}

/**
 * A palette result (C01): the image, a strip with each colour as wide as its
 * share, then one card a colour with HEX, RGB and HSL to copy. The share is
 * written out, so nothing depends on seeing the colours.
 */
export function Swatches({ swatches, image }: { swatches: SwatchInfo[]; image?: string }) {
  return (
    <div className="flex flex-col gap-6 px-4 py-6 lg:px-10 lg:pt-8.5">
      {image && (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL
        <img
          src={image}
          alt="Your image"
          className="max-h-56 max-w-full self-start border border-border object-contain"
        />
      )}
      <div
        aria-hidden="true"
        className="flex h-10 w-full overflow-hidden rounded-control border border-border"
      >
        {swatches.map((s) => (
          <span key={s.hex} className="min-w-1" style={{ background: s.hex, flexGrow: s.share }} />
        ))}
      </div>
      <ul aria-label="Palette" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {swatches.map((s) => (
          <li key={s.hex} className="flex border border-border sm:flex-col">
            <span
              aria-hidden="true"
              className="w-16 flex-none sm:h-18 sm:w-auto"
              style={{ background: s.hex }}
            />
            <div className="min-w-0 flex-1 px-3 pt-2.5 pb-1">
              <p className="flex items-baseline justify-between gap-2 font-mono text-13">
                <span className="font-medium text-text">{s.hex.toUpperCase()}</span>
                <span className="text-text-muted">{(s.share * 100).toFixed(1)}%</span>
              </p>
              <div className="-mx-1.5 flex">
                {(
                  [
                    ['HEX', s.hex.toUpperCase()],
                    ['RGB', s.rgb],
                    ['HSL', s.hsl],
                  ] as const
                ).map(([name, text]) => (
                  <CopyButton key={name} text={text} label={`Copy ${s.hex} as ${name}`} compact>
                    {name}
                  </CopyButton>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
