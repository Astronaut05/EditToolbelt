/**
 * Tool registry schema (docs/02-tool-framework.md → Registry entry).
 *
 * The registry is the source of truth for every tool (CLAUDE.md rule 3).
 * Entries are plain objects checked against this schema in tests and CI, so
 * Zod never ships to the browser. `soon` entries need only what the hub card
 * and the placeholder page show; `live`/`beta` entries need everything.
 */
import { z } from 'zod';

export const CATEGORY_IDS = [
  'photo',
  'video',
  'audio',
  'color',
  'subtitles-time',
  'utility',
] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

export const STATUSES = ['live', 'beta', 'soon', 'disabled'] as const;
export type ToolStatus = (typeof STATUSES)[number];

export const RUNTIMES = ['client', 'server-cpu', 'server-gpu', 'hybrid'] as const;
export type Runtime = (typeof RUNTIMES)[number];

export const ENGINE_IDS = [
  'image-geometry',
  'image-codec',
  'image-paint',
  'image-color',
  'image-vector',
  'image-ml',
  'image-ml-server',
  'video-webcodecs',
  'video-ffmpeg-wasm',
  'video-ffmpeg-server',
  'video-ml-server',
  'audio-dsp',
  'audio-ml-server',
  'media-probe',
  'text',
] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export const UI_TYPES = [
  'canvas-editor',
  'timeline',
  'form',
  'analyzer',
  'calculator',
  'batch',
] as const;
export type UiType = (typeof UI_TYPES)[number];

export const SURFACES = ['web', 'mobile', 'panel', 'api'] as const;
export type Surface = (typeof SURFACES)[number];

const kebab = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be lowercase kebab-case');

/** UI copy rule (docs/03 → Copy rules): no em or en dashes. */
const copy = z
  .string()
  .trim()
  .min(1)
  .refine((text) => !/[–—]/.test(text), 'no em or en dashes in UI copy');

/** docs/05-credits-and-payments.md → Pricing a job. */
export const creditRuleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('free') }),
  z.strictObject({ kind: z.literal('flat'), credits: z.number().int().positive() }),
  z.strictObject({
    kind: z.literal('perMinute'),
    credits: z.number().positive(),
    minCredits: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal('perMegapixel'),
    credits: z.number().positive(),
    minCredits: z.number().int().positive(),
  }),
]);
export type CreditRule = z.infer<typeof creditRuleSchema>;

export const limitsSchema = z.strictObject({
  client: z
    .strictObject({
      maxBytes: z.number().int().positive(),
      maxPixels: z.number().int().positive().optional(),
      maxDurationSec: z.number().positive().optional(),
    })
    .optional(),
  server: z
    .record(
      z.enum(['free', 'paid']),
      z.strictObject({
        maxBytes: z.number().int().positive(),
        maxPixels: z.number().int().positive().optional(),
        maxDurationSec: z.number().positive().optional(),
      }),
    )
    .optional(),
  maxConcurrent: z.number().int().positive().optional(),
  timeoutSec: z.number().int().positive().optional(),
});

const seoSchema = z.strictObject({
  /** <title>: search phrase first, brand last, ≤ 60 chars where possible. */
  title: copy.max(70),
  /** Meta description, ≤ 155 chars. */
  description: copy.max(155),
  /** = primary search phrase, natural wording. One H1 per page. */
  h1: copy.max(60),
  primaryQuery: z.string().min(1),
  secondaryQueries: z.array(z.string().min(1)),
  /** 3-5 steps under a live tool. */
  howTo: z.array(copy).max(5).optional(),
  /** 3-6 real questions with specific answers. */
  faq: z
    .array(z.strictObject({ q: copy, a: copy }))
    .max(6)
    .optional(),
});

export const toolDefSchema = z
  .strictObject({
    /** Stable, never renamed once live. Equals `slug` for every current tool. */
    id: kebab,
    /** Spec code from tools/README.md, e.g. "P07". */
    code: z.string().regex(/^[PVACTU]\d{2}$/, 'must look like P07'),
    /** URL path segment: /remove-background (docs/09 → URL scheme). */
    slug: kebab,
    category: z.enum(CATEGORY_IDS),
    name: copy.max(48),
    /** One line under the H1. */
    tagline: copy.max(90),
    /** Short line on hub rows and "Until then, try" rows. */
    summary: copy.max(48),
    /** Default status; admin can override at runtime from M3 (tool_flags). */
    status: z.enum(STATUSES),
    wave: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    runtime: z.enum(RUNTIMES),
    engines: z.array(z.enum(ENGINE_IDS)).min(1),
    ui: z.enum(UI_TYPES),
    accepts: z.array(z.string()).optional(),
    outputs: z.array(z.string()).optional(),
    batch: z.boolean(),
    limits: limitsSchema.optional(),
    cost: creditRuleSchema,
    surfaces: z.array(z.enum(SURFACES)).min(1),
    desktopBest: z.boolean().optional(),
    /**
     * Needs cross-origin isolation (SharedArrayBuffer for multi-threaded
     * ffmpeg.wasm). The route gets COOP/COEP headers and every link into it
     * is a full page load (docs/01 → Cross-origin isolation).
     */
    crossOriginIsolated: z.boolean().optional(),
    seo: seoSchema,
    /** 3-6 tool ids. */
    related: z.array(kebab).min(3).max(6),
    /** What the tool will do: the numbered list on its coming-soon page (2-4 items). */
    willDo: z.array(copy.max(110)).min(2).max(4),
  })
  .superRefine((tool, ctx) => {
    if (tool.id !== tool.slug) {
      ctx.addIssue({ code: 'custom', path: ['slug'], message: 'slug must equal id' });
    }
    if (tool.related.includes(tool.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['related'],
        message: 'a tool is not related to itself',
      });
    }
    const serverOnly = tool.runtime === 'server-cpu' || tool.runtime === 'server-gpu';
    if (serverOnly && tool.cost.kind === 'free') {
      ctx.addIssue({ code: 'custom', path: ['cost'], message: 'server tools cost credits' });
    }
    if (tool.runtime === 'client' && tool.cost.kind !== 'free') {
      ctx.addIssue({ code: 'custom', path: ['cost'], message: 'browser tools are free' });
    }
    // Live and beta pages carry the full page template (docs/09 → Page template).
    // Calculators take no files, so they have no accepts, outputs or limits.
    if (tool.status === 'live' || tool.status === 'beta') {
      const files: [unknown, string][] =
        tool.ui === 'calculator'
          ? []
          : [
              [tool.accepts, 'accepts'],
              [tool.outputs, 'outputs'],
              [tool.limits, 'limits'],
            ];
      const required: [unknown, string][] = [
        ...files,
        [tool.seo.howTo, 'seo.howTo'],
        [tool.seo.faq, 'seo.faq'],
      ];
      for (const [value, path] of required) {
        if (value === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: path.split('.'),
            message: `required when ${tool.status}`,
          });
        }
      }
      if (tool.seo.howTo && (tool.seo.howTo.length < 3 || tool.seo.howTo.length > 5)) {
        ctx.addIssue({ code: 'custom', path: ['seo', 'howTo'], message: '3-5 steps' });
      }
      if (tool.seo.faq && tool.seo.faq.length < 3) {
        ctx.addIssue({ code: 'custom', path: ['seo', 'faq'], message: '3-6 questions' });
      }
    }
  });

export type ToolDef = z.infer<typeof toolDefSchema>;
