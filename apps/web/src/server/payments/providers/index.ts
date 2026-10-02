/**
 * The payment providers behind the contract (../contract.ts). Each is off
 * until PAYMENTS_ENABLED, its admin switch and its `requiredEnv` all say on.
 */
import type { PaymentProvider } from '../contract';
import { click } from './click';
import { paddle } from './paddle';
import { payme } from './payme';

export const providers: readonly PaymentProvider[] = [paddle, click, payme];
