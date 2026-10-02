'use client';

import { Button } from '@etb/ui';
import { Download } from 'lucide-react';
import { useSyncExternalStore } from 'react';

/** Chrome's install prompt event (not in the DOM typings). */
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

// Listened for as soon as this module loads: the browser fires it once, when the site can be installed.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as InstallPrompt;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const never = () => () => undefined;

/** iPhone and iPad Safari can't prompt: there, a line says how. Not once it's installed. */
function iosHint(): boolean {
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) && !standalone;
}

/**
 * "Install the app" (docs/12 → M8: install prompt UX): shown only when the
 * browser offers to install the site, in the footer, never as a pop-up. On
 * an iPhone, a line says how to add it to the Home Screen instead.
 */
export function InstallButton() {
  const available = useSyncExternalStore(
    subscribe,
    () => deferred !== null,
    () => false,
  );
  const ios = useSyncExternalStore(never, iosHint, () => false);
  if (!available && !ios) return null;
  return (
    <div className="mt-5">
      {available ? (
        <Button
          size="sm"
          onClick={() => {
            const prompt = deferred;
            if (!prompt) return;
            // The prompt can be used once; the button goes either way.
            deferred = null;
            notify();
            void prompt.prompt();
          }}
        >
          <Download size={16} strokeWidth={1.75} aria-hidden="true" />
          Install the app
        </Button>
      ) : (
        <p className="max-w-90 text-14 text-text-muted">
          To keep it on your Home Screen, tap Share, then Add to Home Screen.
        </p>
      )}
    </div>
  );
}
