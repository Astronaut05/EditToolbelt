import type { ReactNode } from 'react';

import { Breadcrumb } from '../primitives/Breadcrumb';
import { PrivacyBadge } from '../primitives/PrivacyBadge';
import type { ShellTool } from './ToolShell';

/**
 * The ToolShell layout for calculators (design README → Not drawn yet):
 * the shared header block and inputs on the left, live results in mono on
 * the right. The tool supplies the inputs and results; the layout is shared.
 */
export function CalculatorShell({
  tool,
  inputs,
  results,
}: {
  tool: Pick<ShellTool, 'name' | 'h1' | 'tagline' | 'category'>;
  inputs: ReactNode;
  results: ReactNode;
}) {
  return (
    <div className="lg:grid lg:min-h-[calc(100dvh-var(--header-h))] lg:grid-cols-[var(--tool-left-col)_1fr]">
      <section
        aria-label="Inputs"
        className="px-4 pb-6 lg:border-r lg:border-border lg:px-10 lg:pt-8.5 lg:pb-10"
      >
        <Breadcrumb
          items={[{ label: tool.category.name, href: tool.category.href }, { label: tool.name }]}
          className="pt-5.5 lg:pt-0"
        />
        <h1 className="mt-3 text-34 leading-display font-display tracking-display text-balance lg:mt-4.5 lg:text-46">
          {tool.h1}
        </h1>
        <p className="mt-3 text-15.5 leading-body text-text-muted lg:mt-3.5 lg:text-16.5">
          {tool.tagline}
        </p>
        <PrivacyBadge
          runtime="client"
          text="Runs in your browser. Nothing you type is sent anywhere."
          className="mt-4"
        />
        <div className="mt-6.5">{inputs}</div>
      </section>
      <section
        aria-label="Results"
        aria-live="polite"
        className="bg-surface px-4 py-6 lg:px-10 lg:pt-8.5"
      >
        {results}
      </section>
    </div>
  );
}
