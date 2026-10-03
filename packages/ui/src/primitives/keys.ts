import { useSyncExternalStore } from 'react';

/** Apple keyboards use ⌘ where others use Ctrl. */
export function isApple(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.userAgent);
}

const noSubscribe = () => () => undefined;
const modifierLabel = () => (isApple() ? '⌘' : 'Ctrl');

/** "⌘" on Apple devices, "Ctrl" elsewhere and in the prerendered page. */
export function useModifierLabel(): string {
  return useSyncExternalStore(noSubscribe, modifierLabel, () => 'Ctrl');
}

/**
 * The Latin letter a key press stands for, in lower case: `key` when it is
 * one, otherwise the key's place on the keyboard (`KeyK` → "k"), so letter
 * shortcuts also work with a Cyrillic layout. Empty for anything else.
 */
export function letterOf(event: Pick<KeyboardEvent, 'key' | 'code'>): string {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase();
  const match = /^Key([A-Z])$/.exec(event.code);
  return event.key.length === 1 && match?.[1] ? match[1].toLowerCase() : '';
}
