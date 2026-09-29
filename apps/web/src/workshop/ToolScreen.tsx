'use client';

import { dummyEngine } from '@etb/engines';
import { ToolShell, type ShellState } from '@etb/ui';

import { trackUnknown } from '../lib/analytics';
import { removeBackgroundPreset, removeBackgroundTool } from './removeBackground';

/** The Remove Background ToolShell in a fixed state, for the design screens. */
export function ToolScreen({ state }: { state: ShellState }) {
  return (
    <ToolShell
      tool={removeBackgroundTool}
      preset={removeBackgroundPreset}
      engine={dummyEngine}
      engineOptions={{
        durationMs: 2500,
        stages: ['Downloading the AI model, first time only', 'Finding the subject'],
      }}
      initialState={state}
      onEvent={trackUnknown}
    />
  );
}
