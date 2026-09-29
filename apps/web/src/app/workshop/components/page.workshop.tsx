import { MonoLabel } from '@etb/ui';

import { SiteFrame } from '../../../components/SiteFrame';
import { Gallery } from '../../../workshop/Gallery';

/** Component gallery (workshop builds only): every component, light and dark via the theme toggle. */
export default function ComponentsPage() {
  return (
    <SiteFrame>
      <div className="px-4 pt-8.5 lg:px-10">
        <MonoLabel>Workshop · local builds only</MonoLabel>
        <h1 className="mt-4.5 text-46 leading-display font-display tracking-display">Components</h1>
      </div>
      <Gallery />
    </SiteFrame>
  );
}
