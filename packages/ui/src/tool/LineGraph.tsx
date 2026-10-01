'use client';

export interface GraphInfo {
  label: string;
  unit: string;
  startSec: number;
  stepSec: number;
  values: number[];
  marks: { label: string; value: number }[];
  durationSec: number;
}

const W = 1000;
const H = 280;
/** Room for the level labels on the left and the times underneath, in viewBox units. */
const LEFT = 56;
const BOTTOM = 28;

const minus = (value: number) => (value < 0 ? `−${String(Math.abs(value))}` : String(value));

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${String(m)}:${String(s).padStart(2, '0')}`;
}

/**
 * A level over time (A06: short-term loudness): the line, the marks (the
 * integrated loudness, dashed) and a 6 dB grid, scaled to what the values
 * reach. An image to assistive tech, named with what it shows; the numbers
 * themselves are in the facts and the report beside it.
 */
export function LineGraph({ graph }: { graph: GraphInfo }) {
  const finite = graph.values.filter(Number.isFinite);
  if (finite.length < 2) return null;
  const marks = graph.marks.filter((mark) => Number.isFinite(mark.value));
  const highest = Math.max(...finite, ...marks.map((mark) => mark.value));
  const lowest = Math.min(...finite, ...marks.map((mark) => mark.value));
  const top = Math.min(0, Math.ceil(highest / 6) * 6);
  const bottom = Math.max(-72, Math.floor(lowest / 6) * 6 - 6);
  const duration = Math.max(graph.durationSec, graph.startSec + graph.stepSec);
  const x = (t: number) => LEFT + ((W - LEFT) * t) / duration;
  const y = (v: number) =>
    ((H - BOTTOM) * (top - Math.min(top, Math.max(bottom, v)))) / (top - bottom || 1);
  // A gap in the line where the audio is silent.
  const path: string[] = [];
  let pen = false;
  graph.values.forEach((value, i) => {
    if (!Number.isFinite(value)) {
      pen = false;
      return;
    }
    const t = graph.startSec + i * graph.stepSec;
    path.push(`${pen ? 'L' : 'M'}${x(t).toFixed(1)} ${y(value).toFixed(1)}`);
    pen = true;
  });
  const grid: number[] = [];
  for (let v = top; v >= bottom; v -= 6) grid.push(v);
  const times = [0, duration / 2, duration];
  return (
    <figure className="mt-8 border-t border-border pt-6">
      <figcaption className="font-mono text-11.5 font-medium uppercase tracking-label text-text-muted">
        {graph.label}
      </figcaption>
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        role="img"
        aria-label={`${graph.label}: from ${minus(Math.round(Math.min(...finite)))} to ${minus(Math.round(Math.max(...finite)))} ${graph.unit} over ${clock(graph.durationSec)}${marks.map((mark) => `; ${mark.label.toLowerCase()} ${minus(Math.round(mark.value * 10) / 10)} ${graph.unit}`).join('')}`}
        className="mt-4 block h-auto w-full font-mono"
      >
        {grid.map((v) => (
          <g key={v}>
            <line
              x1={LEFT}
              x2={W}
              y1={y(v)}
              y2={y(v)}
              style={{ stroke: 'var(--border)' }}
              strokeWidth={1}
            />
            <text
              x={LEFT - 10}
              y={y(v) + 5}
              textAnchor="end"
              style={{ fill: 'var(--text-muted)', fontSize: 14 }}
            >
              {minus(v)}
            </text>
          </g>
        ))}
        {times.map((t, i) => (
          <text
            key={t}
            x={x(t)}
            y={H - 6}
            textAnchor={i === 0 ? 'start' : i === times.length - 1 ? 'end' : 'middle'}
            style={{ fill: 'var(--text-muted)', fontSize: 14 }}
          >
            {clock(t)}
          </text>
        ))}
        {marks.map((mark) => (
          <g key={mark.label}>
            <line
              x1={LEFT}
              x2={W}
              y1={y(mark.value)}
              y2={y(mark.value)}
              style={{ stroke: 'var(--text)' }}
              strokeWidth={1.5}
              strokeDasharray="6 6"
            />
            <text
              x={W - 4}
              y={y(mark.value) - 8}
              textAnchor="end"
              style={{ fill: 'var(--text)', fontSize: 14 }}
            >
              {mark.label} {minus(Math.round(mark.value * 10) / 10)} {graph.unit}
            </text>
          </g>
        ))}
        <path
          d={path.join('')}
          fill="none"
          style={{ stroke: 'var(--accent)' }}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      </svg>
    </figure>
  );
}
