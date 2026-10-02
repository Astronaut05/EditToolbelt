/**
 * The payment providers this build has (contract.ts). Paddle, Click and Payme
 * each live in their own file here; until they're merged the list is empty
 * and every payment path stays off.
 */
import type { PaymentProvider } from '../contract';

export const providers: readonly PaymentProvider[] = [];
