// Light/dark theme. The attribute is first set by the inline script in
// index.html (before the first paint); this keeps it in sync afterwards.

const COLORS = { light: '#f6f3ef', dark: '#14111b' }; // --bg of each theme

/** 'auto' follows the system; 'light' / 'dark' force a theme. */
export function applyTheme(theme) {
  const forced = theme === 'light' || theme === 'dark';
  if (forced) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  // Browser UI colour (status bar on Android, PWA title bar): one meta per scheme
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const scheme = meta.media.includes('dark') ? 'dark' : 'light';
    meta.content = COLORS[forced ? theme : scheme];
  }
}
