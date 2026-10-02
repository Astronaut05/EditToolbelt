/**
 * The production project on Railway (docs/01-architecture.md → Hosting):
 * Postgres 18, the web service and the worker, in EU West (Amsterdam).
 * Applied from CI with `railway config apply` (.github/workflows/railway.yml);
 * a change here is reviewed in its PR, where CI shows the plan.
 *
 * Secrets never appear here. Astro sets them as the project's shared
 * variables in Railway (docs/runbooks/production.md lists every name), and
 * the services reference them. SITE_URL comes from the environment that runs
 * the plan (the repository variable of that name), so no host is written here.
 */
import { defineRailway, github, postgres, project, service, type VariableValue } from 'railway/iac';

/** EU West (Amsterdam). */
const REGION = 'europe-west4-drams3a';
const REPO = 'Astronaut05/EditToolbelt';
const BUCKET = 'edittoolbelt-files';

export default defineRailway((ctx) => {
  if (!process.env.SITE_URL)
    throw new Error("SITE_URL: set it to the site's origin (the repository variable).");
  const site = new URL(process.env.SITE_URL);
  /** A project-wide (shared) variable, set by Astro in Railway. */
  const shared = (name: string) => ctx.shared[name] as VariableValue;
  const db = postgres('postgres', { region: REGION });

  // Both services: the database over the private network, storage, and email.
  const common = {
    APP_ENV: 'production',
    LOG_LEVEL: 'info',
    DATABASE_URL: db.env.DATABASE_URL,
    S3_ENDPOINT: shared('S3_ENDPOINT'),
    S3_REGION: 'auto',
    S3_BUCKET: BUCKET,
    S3_ACCESS_KEY_ID: shared('S3_ACCESS_KEY_ID'),
    S3_SECRET_ACCESS_KEY: shared('S3_SECRET_ACCESS_KEY'),
    // Sign-in links (web) and alerts (worker), sent from the site's own domain.
    SMTP_URL: shared('SMTP_URL'),
    MAIL_FROM: `EditToolbelt <no-reply@${site.host}>`,
  };

  const web = service('web', {
    // checkSuites: deploy a commit on main only after its GitHub checks pass.
    source: github(REPO, { branch: 'main', checkSuites: true }),
    build: {
      builder: 'DOCKERFILE',
      dockerfilePath: 'apps/web/Dockerfile',
      watchPatterns: [
        '/apps/web/**',
        '/packages/**',
        '/config/**',
        '/models.json',
        '/package.json',
        '/pnpm-lock.yaml',
        '/pnpm-workspace.yaml',
        '/tsconfig.base.json',
      ],
    },
    preDeploy: 'pnpm --filter @etb/db migrate',
    healthcheck: '/readyz',
    healthcheckTimeout: 300,
    regions: { [REGION]: 1 },
    // Only the custom domains: no Railway hostname, so Access can't be bypassed.
    domains: [
      { domain: site.host, port: 8080 },
      { domain: `www.${site.host}`, port: 8080 },
    ],
    deploy: { restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 10, drainingSeconds: 30 },
    env: {
      ...common,
      PORT: '8080',
      SITE_URL: site.origin,
      MODELS_BASE_URL: '/models',
      BETTER_AUTH_SECRET: shared('BETTER_AUTH_SECRET'),
      GOOGLE_CLIENT_ID: shared('GOOGLE_CLIENT_ID'),
      GOOGLE_CLIENT_SECRET: shared('GOOGLE_CLIENT_SECRET'),
      CF_ACCESS_TEAM_DOMAIN: shared('CF_ACCESS_TEAM_DOMAIN'),
      CF_ACCESS_AUD: shared('CF_ACCESS_AUD'),
    },
  });

  const worker = service('worker', {
    source: github(REPO, { branch: 'main', checkSuites: true, rootDirectory: 'apps/worker' }),
    build: {
      builder: 'DOCKERFILE',
      dockerfilePath: 'Dockerfile',
      watchPatterns: ['/apps/worker/**'],
    },
    regions: { [REGION]: 1 },
    // A job cut off by a deploy is requeued by the reaper (docs/01 → Queue).
    deploy: { restartPolicyType: 'ALWAYS', drainingSeconds: 60 },
    env: {
      ...common,
      // Two jobs at once. Each needs at most 10 GiB in and its output on the
      // container's own disk (100 GB on Railway's paid plans): no volume.
      WORKER_SLOTS: '2',
      // Alerts: Telegram first, email to ALERT_EMAIL as the backup (docs/07).
      ALERT_EMAIL: shared('ALERT_EMAIL'),
      TELEGRAM_BOT_TOKEN: shared('TELEGRAM_BOT_TOKEN'),
      TELEGRAM_CHAT_ID: shared('TELEGRAM_CHAT_ID'),
      // GPU jobs on Modal (ServerlessGpu).
      MODAL_TOKEN_ID: shared('MODAL_TOKEN_ID'),
      MODAL_TOKEN_SECRET: shared('MODAL_TOKEN_SECRET'),
    },
  });

  return project('edittoolbelt', { resources: [db, web, worker] });
});
