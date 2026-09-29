import { AppLink, MonoLabel } from '@etb/ui';

import { SiteFrame } from '../../components/SiteFrame';
import { DEMO_TYPES } from '../../workshop/demoTypes';

const SCREENS = ['home', 'hub-photo', 'soon-upscale', 'tool-empty', 'tool-progress', 'tool-result'];

function Links({ title, hrefs }: { title: string; hrefs: [string, string][] }) {
  return (
    <section className="mt-8.5">
      <MonoLabel as="h2" size="md">
        {title}
      </MonoLabel>
      <ul className="mt-3 max-w-xl border-t border-border">
        {hrefs.map(([href, label]) => (
          <li key={href}>
            <AppLink
              href={href}
              className="flex h-12 items-center border-b border-border font-mono text-14 hover:underline"
            >
              {label}
            </AppLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Local-only index of the workshop (ETB_WORKSHOP=1 builds). */
export default function WorkshopIndex() {
  return (
    <SiteFrame>
      <div className="px-4 pt-8.5 pb-10 lg:px-10">
        <MonoLabel>Workshop · local builds only</MonoLabel>
        <h1 className="mt-4.5 text-46 leading-display font-display tracking-display">Workshop</h1>
        <Links
          title="Design screens"
          hrefs={SCREENS.map((screen) => [`/workshop/screens/${screen}`, screen])}
        />
        <Links
          title="Components"
          hrefs={[['/workshop/components', 'All components, light and dark']]}
        />
        <Links
          title="ToolShell by ui type, dummy engine"
          hrefs={DEMO_TYPES.map((type) => [`/workshop/tools/${type}`, type])}
        />
      </div>
    </SiteFrame>
  );
}
