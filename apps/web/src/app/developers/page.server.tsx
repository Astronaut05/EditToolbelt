import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ENDPOINTS, SCOPES } from '@etb/core/api';

import { LegalPage } from '../../components/LegalPage';
import { SiteFrame } from '../../components/SiteFrame';
import { currentUser } from '../../server/account';
import { SCOPE_LABELS } from '../../server/api-keys';
import { serverEnv } from '../../server/env';

export const metadata: Metadata = {
  title: 'API for developers',
  description:
    'Run EditToolbelt’s server tools from scripts and apps: API keys, uploads straight to storage, jobs with live progress.',
};

export const dynamic = 'force-dynamic';

function Code({ children, label }: { children: string; label: string }) {
  return (
    <pre
      tabIndex={0}
      aria-label={label}
      className="max-w-full overflow-x-auto rounded-control border border-border bg-surface p-3 font-mono text-14 leading-normal"
    >
      <code>{children}</code>
    </pre>
  );
}

const Mono = ({ children }: { children: ReactNode }) => (
  <code className="font-mono text-14">{children}</code>
);

/** docs/06 → Basics: "a docs page at `/developers`", made from the same endpoint list as the OpenAPI document. */
export default async function DevelopersPage() {
  const api = new URL('/api/v1', serverEnv().SITE_URL).href;
  const signedIn = (await currentUser()) !== null;
  return (
    <SiteFrame signedIn={signedIn}>
      <LegalPage title="API for developers" label="API v1">
        <p>
          Everything our servers do on the site, a script or an app can do too: upload a file, get a
          price, run the tool, follow its progress and download the result. The full description is
          the{' '}
          <a href="/api/v1/openapi.json" className="underline underline-offset-4">
            OpenAPI document
          </a>{' '}
          (3.1); this page walks through it.
        </p>

        <h2 id="keys">API keys</h2>
        <p>
          Make a key in{' '}
          <a href="/account#api-keys" className="underline underline-offset-4">
            Account → API keys
          </a>{' '}
          and send it with every request as <Mono>Authorization: Bearer etb_live_…</Mono>. It acts
          as your account: it spends your free daily jobs and your credits. Keep it secret.
        </p>
        <p>
          The API answers any origin, but a file’s parts go straight to storage, which takes them
          only from this site, the Premiere panel and scripts that don’t run in a browser. So a
          script or a server can do everything; a page on another site can call the API with a key
          but can’t upload files. And anyone who can read that page could take the key.
        </p>
        <p>Each key can do only what you ticked when you made it:</p>
        <ul>
          {SCOPES.map((scope) => (
            <li key={scope}>
              <Mono>{scope}</Mono>: {SCOPE_LABELS[scope].toLowerCase()}.
            </li>
          ))}
        </ul>

        <h2 id="run">Run a tool, start to finish</h2>
        <p>
          With <Mono>curl</Mono> and <Mono>jq</Mono>, for a file of up to 8 MiB (one part). Bigger
          files go up in 8 MiB parts the same way, one URL per part.
        </p>
        <Code label="Set up">{`API=${api}
KEY=etb_live_…          # from Account → API keys
H="Authorization: Bearer $KEY"`}</Code>
        <p>1. Start the upload: the tool, the size in bytes and the type.</p>
        <Code label="Start the upload">{`curl -s -X POST "$API/uploads" -H "$H" -H 'Content-Type: application/json' \\
  -d "{\\"tool_id\\":\\"compress-video\\",\\"bytes\\":$(wc -c < clip.mp4),\\"mime\\":\\"video/mp4\\"}" > upload.json
UPLOAD=$(jq -r .upload_id upload.json)`}</Code>
        <p>
          2. Send the bytes straight to storage with the part’s URL, and keep the <Mono>ETag</Mono>{' '}
          it answers. The URL accepts exactly that part’s size and lasts 15 minutes.
        </p>
        <Code label="Send the part">{`ETAG=$(curl -s -X PUT --upload-file clip.mp4 "$(jq -r '.parts[0].url' upload.json)" -D - -o /dev/null \\
  | tr -d '\\r' | awk 'tolower($1)=="etag:" {print $2}')`}</Code>
        <p>3. Finish the upload. Our servers then check the file.</p>
        <Code label="Finish the upload">{`curl -s -X POST "$API/uploads/$UPLOAD/complete" -H "$H" -H 'Content-Type: application/json' \\
  -d "{\\"parts\\":[{\\"n\\":1,\\"etag\\":$ETAG}]}"`}</Code>
        <p>
          4. Ask for a price. Until the check is done the answer is{' '}
          <Mono>{'{"status":"probing"}'}</Mono> (202), so the loop asks again every second. The
          quote says what pays (<Mono>daily</Mono>: one of your free jobs today, or{' '}
          <Mono>credits</Mono>) and whether it can start.
        </p>
        <Code label="Get a quote">{`OPTIONS='{"mode":"size","targetMb":25}'
while :; do
  curl -s -X POST "$API/jobs/quote" -H "$H" -H 'Content-Type: application/json' \\
    -d "{\\"tool_id\\":\\"compress-video\\",\\"upload_id\\":\\"$UPLOAD\\",\\"options\\":$OPTIONS}" > quote.json
  jq -e '.status == "probing"' quote.json > /dev/null || break
  sleep 1
done
jq '{credits, funding, can_start}' quote.json`}</Code>
        <p id="idempotency">
          5. Start the job at that price, paid as quoted. If the price or what pays changed since
          (today&apos;s free jobs ran out, say), the answer is a 409: get a new quote. The{' '}
          <Mono>Idempotency-Key</Mono> makes a retry safe: the same key with the same body answers
          the same job (200 instead of 201). A key is for one request only: sent again with a
          different body, it gets <Mono>422 IDEMPOTENCY_KEY_REUSED</Mono>.
        </p>
        <Code label="Start the job">{`curl -s -X POST "$API/jobs" -H "$H" -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuidgen)" \\
  -d "{\\"tool_id\\":\\"compress-video\\",\\"upload_id\\":\\"$UPLOAD\\",\\"options\\":$OPTIONS,\\"quote_credits\\":$(jq .credits quote.json),\\"quote_funding\\":$(jq .funding quote.json)}" > job.json
JOB=$(jq -r .job.id job.json)`}</Code>
        <p>
          6. Follow it until it ends, then download. The link lasts 10 minutes (ask for the job
          again for a new one); the file is deleted an hour after the job ends. For live progress,
          read <Mono>/jobs/{'{id}'}/events</Mono> as a stream.
        </p>
        <Code label="Follow and download">{`until jq -e '.job.status | test("succeeded|failed|cancelled|expired")' job.json > /dev/null; do
  sleep 2; curl -s "$API/jobs/$JOB" -H "$H" > job.json; jq -r '"\\(.job.status) \\(.job.progress)%"' job.json
done
curl -s -o small.mp4 "$(jq -r .job.result.download_url job.json)"`}</Code>

        <h2 id="script">The whole thing as a script</h2>
        <p>
          <a href="/examples/run-tool.mjs" download className="underline underline-offset-4">
            run-tool.mjs
          </a>{' '}
          does all of the above for any server tool and any size of file: parts in parallel, URLs
          signed again when they run out, the price, progress, and the download. Node 20 or newer,
          no packages. An option written <Mono>@path</Mono> is a file that goes up as its own
          upload, like Burn Subtitles’ subtitle file; a list of them goes up in order, like Merge
          Videos’ other clips.
        </p>
        <Code label="Run the script">{`ETB_API=${api} ETB_KEY=etb_live_… \
  node run-tool.mjs compress-video clip.mov '{"mode":"size","targetMb":25}'

ETB_API=${api} ETB_KEY=etb_live_… \
  node run-tool.mjs burn-subtitles clip.mp4 '{"subtitles":"@clip.srt"}'

ETB_API=${api} ETB_KEY=etb_live_… \
  node run-tool.mjs merge-videos a.mp4 '{"clips":["@b.mp4","@c.mp4"]}'`}</Code>
        <p>
          Each tool’s options, with their defaults, are in <Mono>GET /tools/{'{id}'}</Mono> as JSON
          Schema.
        </p>

        <h2 id="connect">Apps that connect to an account</h2>
        <p>
          An app like the Premiere panel never asks for a password or a pasted key. It calls{' '}
          <Mono>POST /auth/device</Mono>, shows the short code and opens the link it gets. The
          person signs in, checks the code and approves. Meanwhile the app polls{' '}
          <Mono>POST /auth/device/token</Mono> every 5 seconds until it gets its own key.
        </p>

        <h2 id="errors">Errors and limits</h2>
        <p>
          Errors are <Mono>application/problem+json</Mono> (RFC 9457) with a stable{' '}
          <Mono>code</Mono> to branch on, such as <Mono>FILE_TOO_LARGE</Mono>,{' '}
          <Mono>QUOTA_EXCEEDED</Mono>, <Mono>INSUFFICIENT_CREDITS</Mono> or{' '}
          <Mono>RATE_LIMITED</Mono>, and a <Mono>detail</Mono> to show people. Every answer carries{' '}
          <Mono>RateLimit-Limit</Mono>, <Mono>RateLimit-Remaining</Mono> and{' '}
          <Mono>RateLimit-Reset</Mono>; limits count per key. A failed job gives its credits back by
          itself.
        </p>

        <h2 id="endpoints">Endpoints</h2>
        <div role="region" aria-label="Endpoints" tabIndex={0} className="overflow-x-auto">
          <table className="w-full border-collapse text-14">
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="py-2 pr-3">
                  Request
                </th>
                <th scope="col" className="py-2 pr-3">
                  Key needs
                </th>
                <th scope="col" className="py-2">
                  What it does
                </th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((endpoint) => (
                <tr key={endpoint.operationId} className="border-b border-border align-top">
                  <td className="py-2 pr-3 font-mono whitespace-nowrap">
                    {endpoint.method.toUpperCase()} {endpoint.path}
                  </td>
                  <td className="py-2 pr-3 font-mono whitespace-nowrap">
                    {endpoint.auth === 'public' ? 'no key' : endpoint.auth}
                  </td>
                  <td className="py-2">{endpoint.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 id="versions">Versions</h2>
        <p>
          This is v1. Tool ids and option names are part of it: a rename keeps the old name working
          for a version. New optional fields can appear at any time; anything removed or renamed
          comes as <Mono>/api/v2</Mono>, with v1 kept for at least 6 months after.
        </p>
      </LegalPage>
    </SiteFrame>
  );
}
