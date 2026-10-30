// Copyright 2026 Kai Prince. SPDX-License-Identifier: Apache-2.0
// Same-origin presentation only. No messages, storage, graph or reader-state changes.
export function followHostTheme(view, document) {
  if (document.documentElement.dataset.colorScheme !== 'auto') return () => {};
  const bodies = [];
  let ancestor = view;
  while (ancestor.parent !== ancestor) {
    try {
      ancestor = ancestor.parent;
      const body = ancestor.document.body;
      if (body) bodies.push(body);
    } catch { break; } // Cross-origin embeds retain the operating-system fallback.
  }
  const update = () => {
    const host = bodies.find(body => body.classList.contains('quarto-dark') || body.classList.contains('quarto-light'));
    if (host) document.documentElement.dataset.hostColorScheme = host.classList.contains('quarto-dark') ? 'dark' : 'light';
    else delete document.documentElement.dataset.hostColorScheme;
  };
  const observer = new view.MutationObserver(update);
  const start = () => {
    update();
    for (const body of bodies) observer.observe(body, { attributes: true, attributeFilter: ['class'] });
  };
  start();
  const stop = () => observer.disconnect();
  view.addEventListener('pagehide', stop);
  view.addEventListener('pageshow', event => { if (event.persisted) start(); });
  return stop;
}
// Imported once by navigation or directly by a source report. Node tests do not
// install browser globals; no graph, reading-route or model runtime is required.
if (typeof window !== 'undefined' && typeof document !== 'undefined') followHostTheme(window, document);
