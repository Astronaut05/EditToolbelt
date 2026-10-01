/**
 * A server tool's settings, from the JSON Schema of its options that
 * `GET /tools/:id` answers (docs/06 → Tools), so a tool the API adds shows up
 * in the panel with its settings and no panel release. Option names are the
 * API's contract; LABELS only words them for people.
 */

export type Field =
  | { name: string; label: string; kind: 'choice'; choices: string[]; value: string }
  | { name: string; label: string; kind: 'number'; min?: number; max?: number; value: string }
  | { name: string; label: string; kind: 'toggle'; value: boolean }
  | { name: string; label: string; kind: 'colour'; value: string }
  | { name: string; label: string; kind: 'text'; value: string }
  /** Another upload (Burn Subtitles' subtitle file): the job takes its upload id. */
  | { name: string; label: string; kind: 'file'; value: null };

/** Words for option names the API uses; anything else is spelled out from its name. */
const LABELS: Record<string, string> = {
  targetMb: 'Target size (MB)',
  fps: 'Frame rate',
  codec: 'Codec',
  mode: 'Aim for',
  subtitles: 'Subtitle file',
  box: 'Box behind the text',
};

/** "targetMb" → "Target mb", "maxSide" → "Max side". */
export function labelFor(name: string): string {
  const known = LABELS[name];
  if (known) return known;
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

interface Prop {
  type?: string | string[];
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  pattern?: string;
  format?: string;
}

/** The form for a tool's options; `extraUploads` are the options that take another file. */
export function fieldsFor(
  schema: Record<string, unknown> | null,
  extraUploads: string[] = [],
): Field[] {
  const properties = (schema?.properties ?? {}) as Record<string, Prop>;
  return Object.entries(properties).map(([name, prop]): Field => {
    const label = labelFor(name);
    if (extraUploads.includes(name)) return { name, label, kind: 'file', value: null };
    const type = Array.isArray(prop.type) ? prop.type.find((t) => t !== 'null') : prop.type;
    if (prop.enum) {
      const choices = prop.enum.map(String);
      const wanted =
        typeof prop.default === 'string' || typeof prop.default === 'number'
          ? String(prop.default)
          : null;
      const value = choices.find((choice) => choice === wanted) ?? choices[0] ?? '';
      return { name, label, kind: 'choice', choices, value };
    }
    if (type === 'boolean') return { name, label, kind: 'toggle', value: prop.default === true };
    if (type === 'number' || type === 'integer') {
      return {
        name,
        label,
        kind: 'number',
        min: prop.minimum ?? prop.exclusiveMinimum,
        max: prop.maximum ?? prop.exclusiveMaximum,
        value: typeof prop.default === 'number' ? String(prop.default) : '',
      };
    }
    if (prop.pattern?.includes('0-9a-fA-F]{6}')) {
      return {
        name,
        label,
        kind: 'colour',
        value: typeof prop.default === 'string' ? prop.default : '#ffffff',
      };
    }
    return {
      name,
      label,
      kind: 'text',
      value: typeof prop.default === 'string' ? prop.default : '',
    };
  });
}

/**
 * The job's options from the form: numbers as numbers, empty numbers left
 * out (the API says what's missing), the other uploads' ids filled in.
 */
export function optionsFrom(fields: readonly Field[], uploads: Record<string, string> = {}) {
  const options: Record<string, unknown> = {};
  for (const field of fields) {
    switch (field.kind) {
      case 'number': {
        const n = Number(field.value);
        if (field.value.trim() !== '' && Number.isFinite(n)) options[field.name] = n;
        break;
      }
      case 'file': {
        const id = uploads[field.name];
        if (id) options[field.name] = id;
        break;
      }
      default:
        options[field.name] = field.value;
    }
  }
  return options;
}
