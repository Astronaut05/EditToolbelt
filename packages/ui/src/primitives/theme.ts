/**
 * Light/dark theme: follows the system unless the visitor picks one, which is
 * kept in localStorage (a strictly necessary preference, docs/08). The inline
 * script runs before first paint so there's no flash of the wrong theme.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'etb-theme';

/** Inline in <head>. Keep it tiny: its hash goes into the page's CSP. */
export const themeScript = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;
