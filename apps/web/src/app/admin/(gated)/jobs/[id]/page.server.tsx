import { notFound } from 'next/navigation';

import { eq, jobs, uploads, users } from '@etb/db';
import { Button } from '@etb/ui';

import {
  AdminFrame,
  Facts,
  ReasonField,
  Section,
  took,
  when,
} from '../../../../../components/admin/AdminFrame';
import { requireAdmin } from '../../../../../server/admin';
import { db } from '../../../../../server/db';
import { cancelJobAsAdmin, retryJob } from '../../actions';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MESSAGES: Record<string, string> = {
  cancelled: 'Cancelled; its credits went back.',
  retried: 'Back in the queue.',
  reason: 'Give a reason of at least 3 characters.',
  ended: 'It had already ended.',
  input: 'Its input is gone, so it can’t run again.',
};

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-w-full overflow-x-auto rounded-control border border-border bg-surface p-3 font-mono text-12">
      {JSON.stringify(value ?? null, null, 2)}
    </pre>
  );
}

/**
 * docs/07 → Jobs → detail: the job's metadata, options, timings, attempts,
 * error, credits and worker. No file access: the keys are random and the
 * admin gets no link to either file.
 */
export default async function AdminJob({ params, searchParams }: Props) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const query = await searchParams;
  const [row] = await db()
    .select({ job: jobs, email: users.email })
    .from(jobs)
    .leftJoin(users, eq(users.id, jobs.userId))
    .where(eq(jobs.id, id));
  if (!row) notFound();
  const { job } = row;
  const [upload] = job.inputKey
    ? await db()
        .select({ deletedAt: uploads.deletedAt })
        .from(uploads)
        .where(eq(uploads.storageKey, job.inputKey))
    : [];
  const inputThere = Boolean(job.inputKey) && !upload?.deletedAt;
  const active = job.status === 'queued' || job.status === 'running';
  const message = [query.saved, query.error].find((value) => typeof value === 'string');

  return (
    <AdminFrame title={`Job ${job.id.slice(0, 8)}`} current="/admin/jobs">
      {typeof message === 'string' && MESSAGES[message] && (
        <p role="status" className="text-14">
          {MESSAGES[message]}
        </p>
      )}
      <Section title="Job">
        <Facts
          items={[
            [
              'Id',
              <span key="id" className="font-mono text-12">
                {job.id}
              </span>,
            ],
            ['Tool', job.toolId],
            [
              'Status',
              `${job.status}${job.stage ? ` · ${job.stage}` : ''} · ${String(job.progress)} %`,
            ],
            ['Source', job.source],
            [
              'User',
              <a
                key="user"
                href={`/admin/users/${job.userId}`}
                className="underline underline-offset-4"
              >
                {row.email ?? `deleted (${job.userId.slice(0, 8)})`}
              </a>,
            ],
            ['Paid by', job.funding === 'daily' ? 'a free daily job' : job.funding],
            [
              'Credits quoted / charged',
              `${String(job.creditsQuoted)} / ${String(job.creditsCharged)}`,
            ],
            ['Priority', job.priority],
          ]}
        />
      </Section>
      <Section title="Timings">
        <Facts
          items={[
            ['Created', when(job.createdAt)],
            ['Queued', when(job.queuedAt)],
            ['Started', when(job.startedAt)],
            ['Finished', when(job.finishedAt)],
            ['Waited', took(job.queuedAt, job.startedAt)],
            ['Ran', took(job.startedAt, job.finishedAt)],
            ['Attempts', job.attempts],
            ['Time limit', `${String(Math.round(job.timeoutSec / 60))} min`],
            ['Worker', job.workerId ?? '–'],
            ['Last heartbeat', when(job.heartbeatAt)],
            ['CPU seconds', job.cpuSeconds ?? '–'],
            ['GPU seconds', job.gpuSeconds ?? '–'],
          ]}
        />
      </Section>
      {(job.errorCode ?? job.errorDetail) && (
        <Section title="Error">
          <Facts
            items={[
              [
                'Code',
                <span key="code" className="font-mono text-12">
                  {job.errorCode ?? '–'}
                </span>,
              ],
              ['Detail', job.errorDetail ?? '–'],
            ]}
          />
        </Section>
      )}
      <Section title="Files">
        <Facts
          items={[
            ['Input', inputThere ? 'in storage' : 'deleted'],
            [
              'Output',
              job.outputKey ? 'in storage, deleted 60 min after the job' : 'none or deleted',
            ],
            ['Deleted at', when(job.filesDeletedAt)],
          ]}
        />
        <p className="text-14 text-text-muted">
          Admins never get users’ files (docs/07): neither file is linked here.
        </p>
      </Section>
      <Section title="Options">
        <Json value={job.options} />
      </Section>
      <Section title="The file, as the worker probed it">
        <Json value={job.inputMeta} />
      </Section>
      {job.outputMeta !== null && (
        <Section title="The result">
          <Json value={job.outputMeta} />
        </Section>
      )}
      {active && (
        <Section title="Cancel">
          <form action={cancelJobAsAdmin} className="flex max-w-md flex-col gap-3">
            <input type="hidden" name="jobId" value={job.id} />
            <ReasonField />
            <Button type="submit" variant="primary">
              Cancel and give the credits back
            </Button>
          </form>
        </Section>
      )}
      {!active && job.status !== 'succeeded' && (
        <Section title="Retry">
          {inputThere ? (
            <form action={retryJob} className="flex max-w-md flex-col gap-3">
              <input type="hidden" name="jobId" value={job.id} />
              <p className="text-14 text-text-muted">
                It runs again from the start, on us: no credits and no free job.
              </p>
              <ReasonField />
              <Button type="submit" variant="primary">
                Run it again
              </Button>
            </form>
          ) : (
            <p className="text-14 text-text-muted">
              Its input was deleted when it ended, so it can’t run again. The user uploads it again.
            </p>
          )}
        </Section>
      )}
    </AdminFrame>
  );
}
