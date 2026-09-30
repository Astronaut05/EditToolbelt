import { afterEach, describe, expect, it } from 'vitest';

import {
  conversions,
  getTool,
  hubOrder,
  isAvailable,
  isListed,
  maintenanceMessage,
  setToolFlags,
  statusOf,
  tools,
  toolsInCategory,
} from './index';
import { buildSearchIndex } from './search';

afterEach(() => {
  setToolFlags(new Map());
});

describe('runtime overrides (tool_flags)', () => {
  it('answers with the code default when nothing is set', () => {
    const trim = getTool('trim-video');
    expect(statusOf(trim)).toBe(trim.status);
    expect(maintenanceMessage(trim)).toBeNull();
  });

  it('lets an override change what every helper sees', () => {
    setToolFlags(
      new Map([
        ['trim-video', { status: 'disabled', maintenanceMessage: null }],
        ['crop-image', { maintenanceMessage: 'Back in an hour' }],
      ]),
    );
    const trim = getTool('trim-video');
    expect(isListed(trim)).toBe(false);
    expect(isAvailable(trim)).toBe(false);
    expect(toolsInCategory('video').map((t) => t.id)).not.toContain('trim-video');
    expect(maintenanceMessage(getTool('crop-image'))).toBe('Back in an hour');
    // No status in the override: the default stands.
    expect(statusOf(getTool('crop-image'))).toBe(getTool('crop-image').status);
    const index = buildSearchIndex(tools, conversions);
    expect(index.some((entry) => entry.path === '/trim-video')).toBe(false);
  });

  it('sends a tool set back to soon to the end of its hub', () => {
    setToolFlags(new Map([['trim-video', { status: 'soon' }]]));
    const order = hubOrder(toolsInCategory('video')).map((t) => t.id);
    const firstSoon = order.findIndex((id) => statusOf(getTool(id)) === 'soon');
    expect(order.indexOf('trim-video')).toBeGreaterThanOrEqual(firstSoon);
  });
});
