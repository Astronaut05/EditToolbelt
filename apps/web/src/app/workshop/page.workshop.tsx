import { AppLink, MonoLabel } from '@etb/ui';

import { SiteFrame } from '../../components/SiteFrame';

const SCREENS = ['home', 'hub-photo', 'soon-upscale', 'tool-empty', 'tool-progress', 'tool-result'];

/** Local-only index of the workshop (ETB_WORKSHOP=1 builds). */
export default function WorkshopIndex() {
  return (
    <SiteFrame>
      <div className="px-4 pt-8.5 lg:px-10">
        <MonoLabel>Workshop · local builds only</MonoLabel>
        <h1 className="mt-4.5 text-46 leading-display font-display tracking-display">
          Design screens
        </h1>
        <ul className="mt-6.5 max-w-xl border-t border-border">
          {SCREENS.map((screen) => (
            <li key={screen}>
              <AppLink
                href={`/workshop/screens/${screen}`}
                className="flex h-12 items-center border-b border-border font-mono text-14 hover:underline"
              >
                {screen}
              </AppLink>
            </li>
          ))}
        </ul>
      </div>
    </SiteFrame>
  );
}
