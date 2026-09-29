/**
 * @etb/engines: browser processing engines (docs/02 → Engines).
 *
 * M1 ships only the engine contract and a dummy engine for the ToolShell; the
 * real engines arrive in M2 (docs/12-milestones.md).
 */
export type { Capabilities, Engine, EngineOutput, InputMeta, RunContext } from './types';
export { dummyEngine, EngineAbortError, type DummyOptions } from './dummy';
