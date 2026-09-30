/**
 * @etb/engines: browser processing engines (docs/02 → Engines).
 *
 * The engine contract, a dummy engine for building the ToolShell (M1), and the
 * real engines as their tools go live (docs/12-milestones.md → M2).
 */
export type { Capabilities, Engine, EngineOutput, InputMeta, RunContext } from './types';
export { dummyEngine, EngineAbortError, type DummyOptions } from './dummy';
export { subtitleEngine, type SubtitleEngineOptions } from './subtitles';
