import { defineTool } from '../../define';

export default defineTool({
  id: 'qr-code-generator',
  code: 'U01',
  slug: 'qr-code-generator',
  category: 'utility',
  name: 'QR Code Generator',
  tagline: 'Make QR codes for links, Wi-Fi and contacts that never expire and never track scans.',
  summary: 'Static codes, no expiry, no tracking',
  status: 'soon',
  wave: 1,
  runtime: 'client',
  engines: ['text'],
  ui: 'calculator',
  batch: false,
  cost: { kind: 'free' },
  surfaces: ['web', 'mobile'],
  seo: {
    title: 'QR Code Generator, Free and Never Expires | EditToolbelt',
    description:
      'Make QR codes for URLs, text, Wi-Fi, vCards, email, phone and SMS. Add a logo, set colors, and download PNG up to 4096 px or SVG. No expiry, no tracking.',
    h1: 'QR Code Generator',
    primaryQuery: 'qr code generator',
    secondaryQueries: ['free qr code generator no expiry', 'wifi qr code generator'],
  },
  related: ['dpi-calculator', 'contrast-checker', 'color-picker-from-image'],
  willDo: [
    'Encode a URL, text, Wi-Fi login, vCard contact, email, phone number or SMS',
    'Choose error correction L, M, Q or H, with H set for you when you add a center logo',
    'Download PNG up to 4096 px or a clean SVG, with a warning if your colors may not scan',
  ],
});
