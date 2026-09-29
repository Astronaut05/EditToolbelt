/** ToolShell demo types (shared by the server route and the client demo). */
export const DEMO_TYPES = [
  'form',
  'canvas-editor',
  'timeline',
  'analyzer',
  'calculator',
  'batch',
] as const;
export type DemoType = (typeof DEMO_TYPES)[number];
