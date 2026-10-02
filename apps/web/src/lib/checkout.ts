/**
 * The website's own payment calls (docs/06: `/credits/checkout` is web only,
 * so these aren't in the public OpenAPI document): what /credits/buy sends
 * and what it and /credits/return get back. Shared by the routes and the
 * pages' client code; no server imports.
 */
import { z } from 'zod';

import { packs, type PackId } from '@etb/config/business';

import {
  PROVIDER_IDS,
  type Checkout,
  type Currency,
  type ProviderId,
  type PurchaseStatus,
} from '../server/payments/contract';

const PACK_IDS = packs.map((pack) => pack.id) as [PackId, ...PackId[]];

/** `POST /api/v1/credits/checkout`. */
export const CheckoutRequest = z.strictObject({
  pack_id: z.enum(PACK_IDS),
  provider: z.enum(PROVIDER_IDS as [ProviderId, ...ProviderId[]]),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequest>;

export interface CheckoutAnswer {
  purchase_id: string;
  checkout: Checkout;
}

/** `GET /api/v1/credits/purchases/:id`: one of the caller's purchases. */
export interface PurchaseView {
  id: string;
  status: PurchaseStatus;
  provider: ProviderId;
  pack_id: PackId;
  credits: number;
  amount_minor: number;
  currency: Currency;
  created_at: string;
}

/** Statuses after which nothing more happens on the return page. */
export const SETTLED: readonly PurchaseStatus[] = [
  'completed',
  'cancelled',
  'refunded',
  'partially_refunded',
  'chargeback',
];
