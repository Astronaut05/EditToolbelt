/**
 * Paddle.js, for Paddle's overlay checkout (contract.ts → Checkout) on
 * /credits/buy, which is also Paddle's default payment link (`?_ptxn=`).
 * Only that page loads it, and its CSP allows these origins only while
 * payments are on and Paddle's client token is set (src/proxy.server.ts); no
 * other page's does (docs/11 → Web app: "scripts from self + Paddle,
 * checkout route only"). Paddle fixes these
 * hosts (scripts/check-hosts.ts → THIRD_PARTY_APIS).
 */
export const PADDLE_JS_URL = 'https://cdn.paddle.com/paddle/v2/paddle.js';

/** What /credits/buy's CSP adds while Paddle is set up. */
export const PADDLE_CSP = {
  scripts: ['https://cdn.paddle.com'],
  styles: ['https://cdn.paddle.com'],
  frames: ['https://buy.paddle.com', 'https://sandbox-buy.paddle.com'],
  // Paddle.js's own calls (checkout service, pricing), live and sandbox.
  connect: ['https://*.paddle.com'],
} as const;
