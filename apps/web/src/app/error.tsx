'use client';

/**
 * Shown in place of a page whose code threw while it drew. Most often an open
 * tab asked for a part of the site that a new version has replaced, or the
 * connection dropped while a tool's part was loading: nothing a retry in
 * place can mend, so the way out is a full reload, which gets the current
 * version. The error's own text stays out of the page.
 *
 * Plain markup, no header or footer and nothing imported: this file is in
 * every page's first load, and what it replaces held the rest.
 */
export default function PageError() {
  return (
    <main className="px-4 pt-10 pb-10 lg:px-10 lg:pt-15">
      <p className="font-mono text-12 font-medium uppercase tracking-label text-text-muted">
        Error
      </p>
      <h1 className="mt-4.5 max-w-3xl text-46 leading-display-xl font-display tracking-display-xl lg:text-72">
        Something went wrong on this page
      </h1>
      <p className="mt-4.5 max-w-xl text-16.5 text-text-muted">
        The site may have been updated while this tab was open, or the connection dropped. Reload to
        get the current version. Files you added never left this device.
      </p>
      <div className="mt-7 flex flex-wrap items-center gap-5">
        <button
          type="button"
          onClick={() => {
            window.location.reload();
          }}
          className="inline-flex h-11 items-center rounded-control bg-accent px-5 font-display text-16 text-accent-contrast hover:opacity-90"
        >
          Reload
        </button>
        {/* A plain link: a full page load, not the router this page's code may have broken. */}
        <a href="/" className="text-14 underline underline-offset-4">
          EditToolbelt home
        </a>
      </div>
    </main>
  );
}
