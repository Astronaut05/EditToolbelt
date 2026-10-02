import {
  getCategory,
  isAvailable,
  needsFullPageLoad,
  runsInBrowser,
  toolPath,
  tools,
} from '@etb/registry';
import type { Metadata } from 'next';

import { ShareView, type ShareTool } from '../../components/ShareView';
import { SiteFrame } from '../../components/SiteFrame';

export const metadata: Metadata = {
  title: 'Open a shared file',
  robots: { index: false, follow: false },
};

/**
 * Tools a shared file can go to: open now, running in the browser (the static
 * site has no server path), taking files, and reached without a full page
 * load (the handoff lives in memory, so a cross-origin-isolated tool can't
 * receive it).
 */
function shareTools(): ShareTool[] {
  return tools
    .filter(
      (tool) =>
        isAvailable(tool) &&
        runsInBrowser(tool) &&
        tool.accepts &&
        !needsFullPageLoad(toolPath(tool)),
    )
    .map((tool) => ({
      id: tool.id,
      name: tool.name,
      href: toolPath(tool),
      accepts: tool.accepts ?? [],
      batch: tool.batch,
      category: getCategory(tool.category).name,
    }));
}

/**
 * Where Android's share sheet lands (the manifest's share_target): the
 * service worker keeps the files on this device, and this page hands them to
 * the tool picked (docs/01 → Mobile).
 */
export default function SharePage() {
  return (
    <SiteFrame>
      <div className="px-4 pt-6 pb-10 lg:px-10 lg:pt-15">
        <ShareView tools={shareTools()} />
      </div>
    </SiteFrame>
  );
}
