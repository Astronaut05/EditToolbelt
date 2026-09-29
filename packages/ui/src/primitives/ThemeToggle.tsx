'use client';

import { useSyncExternalStore } from 'react';

import { SegmentedControl } from './SegmentedControl';
import { THEME_STORAGE_KEY, type ThemeChoice } from './theme';

const OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

const CHANGE = 'etb:theme';

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function ThemeToggle({ className }: { className?: string }) {
  const choice = useSyncExternalStore(subscribe, readChoice, () => 'system' as const);

  function apply(next: ThemeChoice) {
    const root = document.documentElement;
    if (next === 'system') delete root.dataset.theme;
    else root.dataset.theme = next;
    try {
      if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
    window.dispatchEvent(new Event(CHANGE));
  }

  return (
    <SegmentedControl
      label="Theme"
      options={OPTIONS}
      value={choice}
      onChange={apply}
      className={className}
    />
  );
}
