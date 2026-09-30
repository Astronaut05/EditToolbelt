import { defineTool } from '../../define';

export default defineTool({
  id: 'qr-code-generator',
  code: 'U01',
  slug: 'qr-code-generator',
  category: 'utility',
  name: 'QR Code Generator',
  tagline: 'Make QR codes for links, Wi-Fi and contacts that never expire and never track scans.',
  summary: 'Static codes, no expiry, no tracking',
  status: 'live',
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
    howTo: [
      'Pick what the code should hold: a link, text, Wi-Fi login, contact card, email, phone call or text message.',
      'Fill in the fields. The preview updates as you type.',
      'Set the colors, dot style and size, and add a logo if you want one.',
      'Download a PNG up to 4096 px or an SVG, then test it with your phone camera before you print.',
    ],
    faq: [
      {
        q: 'Do these QR codes expire?',
        a: 'No. The code holds your link or text itself, not a redirect through our server, so it works for as long as the link does, and nobody can see or count the scans.',
      },
      {
        q: 'How do I make a Wi-Fi QR code?',
        a: 'Pick Wi-Fi, enter the network name and password, and choose the security type: WPA or WPA2 for most home routers. Most phone cameras offer to join the network when they scan it.',
      },
      {
        q: 'What does error correction do?',
        a: 'It adds redundancy so a scratched or partly covered code still reads. L recovers about 7% of the code, M 15%, Q 25% and H 30%. Higher levels make the code denser; M suits most uses, and a logo needs H.',
      },
      {
        q: 'Should I download PNG or SVG?',
        a: 'SVG for print and design apps, since it stays sharp at any size. PNG for documents, slides and the web; pick 2048 px or more for print.',
      },
      {
        q: 'Why won\'t my colored QR code scan?',
        a: 'Scanners need strong contrast and usually dark dots on a light background. Keep the contrast above 4:1; the tool warns you when your colors fall below that or are inverted.',
      },
    ],
  },
  related: ['dpi-calculator', 'contrast-checker', 'color-picker-from-image'],
  willDo: [
    'Encode a URL, text, Wi-Fi login, vCard contact, email, phone number or SMS',
    'Choose error correction L, M, Q or H, with H set for you when you add a center logo',
    'Download PNG up to 4096 px or a clean SVG, with a warning if your colors may not scan',
  ],
});
