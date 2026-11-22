import { $, show } from './dom.js';

const overlay = $('#busy');
const text = $('#busy-text');
let depth = 0;

/** Runs `fn` behind a blocking overlay with a message. Nested calls are safe. */
export async function withBusy(message, fn) {
  depth++;
  text.textContent = message;
  show(overlay, true);
  try {
    return await fn((m) => (text.textContent = m));
  } finally {
    if (--depth === 0) show(overlay, false);
  }
}
