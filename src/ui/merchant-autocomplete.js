// Suggestions for the merchant field, fuzzy-matched against the shops saved
// on this device. Stays hidden when nothing matches or the text is already
// a saved name, so typing a new shop is never in the way.

import autocomplete from 'autocompleter';
import Fuse from 'fuse.js';
import { h } from './dom.js';

const MAX = 6;

/** Bolds the characters Fuse matched, so it is clear why a name is suggested. */
function highlight(name, indices = []) {
  const parts = [];
  let at = 0;
  for (const [from, to] of indices) {
    if (from > at) parts.push(name.slice(at, from));
    parts.push(h('strong', {}, name.slice(from, to + 1)));
    at = to + 1;
  }
  parts.push(name.slice(at));
  return parts;
}

/**
 * @param {HTMLInputElement} input
 * @param {() => string[]} getNames saved merchants, most recent first
 */
export function attachMerchantAutocomplete(input, getNames) {
  let names = null;
  let fuse = null;

  autocomplete({
    input,
    minLength: 2, // one letter matches almost everything
    className: 'suggest',
    disableAutoSelect: true, // Enter keeps what was typed: it may be a new shop
    fetch(text, update) {
      const list = getNames();
      if (list !== names) {
        names = list;
        fuse = new Fuse(list, { threshold: 0.4, ignoreLocation: true, includeMatches: true });
      }
      const typed = text.trim().toLowerCase();
      const hits = fuse
        .search(text.trim(), { limit: MAX + 1 })
        .filter((r) => r.item.toLowerCase() !== typed)
        .slice(0, MAX);
      update(hits.map((r) => ({ label: r.item, indices: r.matches?.[0]?.indices })));
    },
    render(item) {
      return h('div', {}, ...highlight(item.label, item.indices));
    },
    customize(_input, _rect, container, maxHeight) {
      // Never taller than ~5 rows, nor past the screen (or the keyboard) edge
      container.style.maxHeight = `${Math.min(maxHeight - 8, 5 * 48)}px`;
    },
    onSelect(item) {
      input.value = item.label;
      input.dispatchEvent(new Event('input', { bubbles: true })); // the library ignores it: no reopen
    },
  });
}
