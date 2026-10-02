/**
 * The GPU's spend and budget for the admin (docs/05 → GPU costs and the
 * daily budget). The worker enforces the budget (apps/worker/src/etb_worker
 * /gpu/budget.py); this reads the same numbers the same way: today is the UTC
 * day; spent is each job's recorded cost plus its call in flight so far, at
 * its rate; committed counts every running GPU job at its worst case instead
 * (its time limit plus the longest idle window), and GPU jobs start only
 * while committed is under the budget.
 */
import { creditNetUsd, gpuBudget as budgetConfig } from '@etb/config/business';
import { sql } from '@etb/db';
import { z } from 'zod';

import { db } from './db';

export interface GpuToday {
  spentUsd: number;
  committedUsd: number;
  budgetUsd: number;
  jobs: number;
}

export async function gpuToday(): Promise<GpuToday> {
  const result = await db().execute<{
    spent: string;
    committed: string;
    budget: string | null;
    jobs: string;
  }>(sql`
    select
      coalesce(sum(coalesce(gpu_cost_usd, 0) + case
        when status = 'running' and gpu_call_at is not null
          then greatest(extract(epoch from now() - gpu_call_at), 0) * gpu_rate_usd
        else 0 end), 0) as spent,
      coalesce(sum(coalesce(gpu_cost_usd, 0) + case
        when status = 'running'
          then (timeout_sec + ${budgetConfig.worstCaseIdleSec}) * gpu_rate_usd
        else 0 end), 0) as committed,
      (select daily_usd from gpu_budget where id = 1) as budget,
      count(*) as jobs
    from jobs
    where gpu_rate_usd is not null and started_at >= date_trunc('day', now(), 'UTC')
  `);
  const row = result.rows[0];
  return {
    spentUsd: Number(row?.spent ?? 0),
    committedUsd: Number(row?.committed ?? 0),
    budgetUsd:
      row?.budget === null || row?.budget === undefined
        ? budgetConfig.defaultDailyUsd
        : Number(row.budget),
    jobs: Number(row?.jobs ?? 0),
  };
}

/** Whether GPU jobs start now, as the admin reads it. */
export function gpuStarting(today: GpuToday): string {
  if (today.committedUsd < today.budgetUsd) return 'Yes';
  if (today.spentUsd >= today.budgetUsd) return 'No: budget reached';
  return 'Not until a running GPU job ends: at their time limits they could reach the budget';
}

/**
 * The admin's daily budget field: dollars, from 0 to 1,000. A blank field is
 * refused, never read as $0 (which would stop every GPU job).
 */
export const dailyBudgetUsd = z
  .string()
  .trim()
  .min(1)
  .transform(Number)
  .pipe(z.number().min(0).max(1000));

export interface ToolCost {
  toolId: string;
  jobs: number;
  gpuSeconds: number;
  costUsd: number;
  /** What free jobs (the daily allowance, a free price) cost: its own line (docs/05). */
  freeCostUsd: number;
  credits: number;
  /** The credits at what one really brings in on the pack worst for us (config/business.ts). */
  creditsUsd: number;
  /** Credits' worth over the cost of the jobs they paid for; null without paid jobs. */
  margin: number | null;
}

/** GPU cost against credits by tool, over the last `days` days. */
export async function gpuCostByTool(days = 7): Promise<ToolCost[]> {
  const result = await db().execute<{
    tool_id: string;
    jobs: string;
    gpu_seconds: string;
    cost: string;
    free_cost: string;
    paid_cost: string;
    credits: string;
  }>(sql`
    select tool_id, count(*) as jobs,
           coalesce(sum(gpu_seconds), 0) as gpu_seconds,
           coalesce(sum(gpu_cost_usd), 0) as cost,
           coalesce(sum(gpu_cost_usd) filter (where funding <> 'credits'), 0) as free_cost,
           coalesce(sum(gpu_cost_usd) filter (where funding = 'credits'), 0) as paid_cost,
           coalesce(sum(credits_charged), 0) as credits
    from jobs
    where gpu_rate_usd is not null
      and started_at >= now() - make_interval(days => ${days})
    group by tool_id
    order by cost desc, tool_id
  `);
  return result.rows.map((row) => {
    const credits = Number(row.credits);
    const paidCost = Number(row.paid_cost);
    const creditsUsd = credits * creditNetUsd;
    return {
      toolId: row.tool_id,
      jobs: Number(row.jobs),
      gpuSeconds: Number(row.gpu_seconds),
      costUsd: Number(row.cost),
      freeCostUsd: Number(row.free_cost),
      credits,
      creditsUsd,
      margin: paidCost > 0 ? creditsUsd / paidCost : null,
    };
  });
}

/** Dollars as the admin reads them: cents, or a tenth of a cent under a dollar. */
export function usd(value: number): string {
  return value < 1 && value > 0 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`;
}
