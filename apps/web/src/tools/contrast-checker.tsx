'use client';

import { Check, X } from 'lucide-react';

import { color, contrast } from '@etb/core';
import {
  Button,
  CalculatorShell,
  cn,
  ColorInput,
  CopyButton,
  MonoLabel,
  OptionRow,
  type ShellTool,
} from '@etb/ui';

import { ChoiceRow, Results, Rows, TextField } from './calc-ui';
import { oneOf, useQueryState } from './url-state';

const DEFAULTS = { t: '#777777', b: '#ffffff', aim: 'aa' };

const AIMS = ['aa', 'aaa', 'large'] as const;
type Aim = (typeof AIMS)[number];
const AIM_RATIO: Record<Aim, number> = {
  aa: contrast.THRESHOLDS.aaNormal,
  aaa: contrast.THRESHOLDS.aaaNormal,
  large: contrast.THRESHOLDS.aaLarge,
};
const AIM_LABEL: Record<Aim, string> = {
  aa: 'AA, normal text',
  aaa: 'AAA, normal text',
  large: 'AA, large text and UI',
};

const CHECKS: { level: contrast.Level; label: string; detail: string }[] = [
  { level: 'aaNormal', label: 'AA · normal text', detail: '4.5:1 (1.4.3)' },
  { level: 'aaLarge', label: 'AA · large text', detail: '3:1 (1.4.3)' },
  { level: 'aaaNormal', label: 'AAA · normal text', detail: '7:1 (1.4.6)' },
  { level: 'aaaLarge', label: 'AAA · large text', detail: '4.5:1 (1.4.6)' },
  { level: 'nonText', label: 'Icons, borders, focus rings', detail: '3:1 (1.4.11)' },
];

function Chip({ hex }: { hex: string }) {
  return (
    <span
      aria-hidden="true"
      className="checkerboard inline-block size-5 flex-none rounded-control border border-border"
    >
      <span className="block size-full rounded-control" style={{ background: hex }} />
    </span>
  );
}

/** C04 Contrast Checker (tools/color.md): the WCAG 2.2 ratio, what it passes, and a fix. */
export default function ContrastChecker({ tool }: { tool: ShellTool }) {
  const [state, set] = useQueryState(DEFAULTS);
  const aim = oneOf(state.aim, AIMS, 'aa');
  const text = color.parseColor(state.t);
  const background = color.parseColor(state.b);

  const pick = (key: 't' | 'b', parsed: typeof text) => (
    <OptionRow label="Pick">
      <ColorInput
        label={key === 't' ? 'Pick the text color' : 'Pick the background color'}
        value={parsed.ok ? color.toHex({ ...parsed.rgb, a: 1 }) : '#000000'}
        onChange={(value) => {
          set(key, value);
        }}
      />
    </OptionRow>
  );

  const inputs = (
    <Rows>
      <TextField
        id="cc-text"
        label="Text color"
        value={state.t}
        onChange={(value) => {
          set('t', value);
        }}
        placeholder="#777777"
        width="w-52"
        invalid={!text.ok}
      />
      {pick('t', text)}
      <TextField
        id="cc-background"
        label="Background color"
        value={state.b}
        onChange={(value) => {
          set('b', value);
        }}
        placeholder="#ffffff"
        width="w-52"
        invalid={!background.ok}
      />
      {pick('b', background)}
      <OptionRow label="Swap">
        <Button
          type="button"
          onClick={() => {
            set('t', state.b);
            set('b', state.t);
          }}
        >
          Swap text and background
        </Button>
      </OptionRow>
      <ChoiceRow
        label="Aim for"
        value={aim}
        onChange={(value) => {
          set('aim', value);
        }}
        options={[
          { value: 'aa', label: 'AA' },
          { value: 'aaa', label: 'AAA' },
          { value: 'large', label: 'Large' },
        ]}
      />
    </Rows>
  );

  if (!text.ok || !background.ok) {
    const problem = !text.ok
      ? `Text color: ${text.error}`
      : `Background color: ${background.ok ? '' : background.error}`;
    return (
      <CalculatorShell
        tool={tool}
        inputs={inputs}
        results={<Results facts={[]} problem={problem} />}
      />
    );
  }

  const ratio = contrast.contrastRatio(text.rgb, background.rgb);
  const result = contrast.passes(ratio);
  const target = AIM_RATIO[aim];
  const textHex = color.toHex(text.rgb);
  const backgroundHex = color.toHex(background.rgb);
  const fixes =
    ratio >= target
      ? []
      : [
          {
            side: 'text' as const,
            label: 'Text color',
            found: contrast.nearestPassing(text.rgb, background.rgb, target, 'text'),
          },
          {
            side: 'background' as const,
            label: 'Background color',
            found: contrast.nearestPassing(background.rgb, text.rgb, target, 'background'),
          },
        ];

  const results = (
    <Results
      facts={[
        { label: 'Contrast ratio', value: contrast.ratioLabel(ratio) },
        {
          label: AIM_LABEL[aim],
          value: ratio >= target ? 'Passes' : 'Fails',
          unit: `needs ${String(target)}:1`,
        },
      ]}
    >
      <div
        className="checkerboard mt-6 overflow-hidden rounded-card border border-border"
        aria-label="Preview"
        role="img"
      >
        <div className="p-5" style={{ background: backgroundHex, color: textHex }}>
          <p className="text-24 leading-tight">Large text, 24 px</p>
          <p className="mt-2 text-16">Normal text, 16 px: the quick brown fox jumps over.</p>
          <p
            className="mt-3 inline-block rounded-control border-2 px-3 py-1.5 text-14"
            style={{ borderColor: textHex }}
          >
            A button outline
          </p>
        </div>
      </div>

      <MonoLabel as="h2" size="md" className="mt-8">
        WCAG 2.2
      </MonoLabel>
      <ul className="mt-3 border-t border-border">
        {CHECKS.map((check) => {
          const ok = result[check.level];
          const Icon = ok ? Check : X;
          return (
            <li
              key={check.level}
              className="flex min-h-12 items-center justify-between gap-3 border-b border-border text-14"
            >
              <span>
                {check.label}{' '}
                <span className="font-mono text-12.5 text-text-muted">{check.detail}</span>
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 font-mono text-12.5 uppercase',
                  ok ? 'text-text' : 'text-text-muted',
                )}
              >
                <Icon aria-hidden="true" className={cn('size-4', !ok && 'text-danger')} />
                {ok ? 'Pass' : 'Fail'}
              </span>
            </li>
          );
        })}
      </ul>

      {fixes.length > 0 && (
        <>
          <MonoLabel as="h2" size="md" className="mt-8">
            Nearest that passes {AIM_LABEL[aim]}
          </MonoLabel>
          <ul className="mt-3 border-t border-border">
            {fixes.map(({ side, label, found }) => {
              if (!found) {
                return (
                  <li
                    key={side}
                    className="flex min-h-12 items-center border-b border-border text-14"
                  >
                    {label}: no color reaches {String(target)}:1 against this{' '}
                    {side === 'text' ? 'background' : 'text'}.
                  </li>
                );
              }
              const hex = color.toHex(found.rgb);
              return (
                <li
                  key={side}
                  className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-14"
                >
                  <span className="flex items-center gap-2.5">
                    <Chip hex={hex} />
                    <span>
                      {label} <span className="font-mono">{hex}</span>{' '}
                      <span className="font-mono text-12.5 text-text-muted">
                        {contrast.ratioLabel(found.ratio)}
                      </span>
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <CopyButton text={hex} label={`Copy ${hex}`} />
                    <Button
                      type="button"
                      onClick={() => {
                        set(side === 'text' ? 't' : 'b', hex);
                      }}
                    >
                      Use it
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-13.5 text-text-muted">
            Same hue, lightness moved just far enough; chroma eased only where sRGB runs out.
          </p>
        </>
      )}
      {(text.rgb.a < 1 || background.rgb.a < 1) && (
        <p className="mt-3 text-13.5 text-text-muted">
          Transparent colors are measured as shown: the text over the background, the background
          over white.
        </p>
      )}
    </Results>
  );

  return <CalculatorShell tool={tool} inputs={inputs} results={results} />;
}
