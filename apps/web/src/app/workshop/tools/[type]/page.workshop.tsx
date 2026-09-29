import { SiteFrame } from '../../../../components/SiteFrame';
import { DEMO_TYPES, type DemoType } from '../../../../workshop/demoTypes';
import { ToolDemo } from '../../../../workshop/ToolDemo';

export const dynamicParams = false;
export function generateStaticParams() {
  return DEMO_TYPES.map((type) => ({ type }));
}

/** ToolShell for each ui type with the dummy engine (workshop builds only). */
export default async function ToolDemoPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  return (
    <SiteFrame footer={false}>
      <ToolDemo type={type as DemoType} />
    </SiteFrame>
  );
}
