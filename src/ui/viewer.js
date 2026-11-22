// Full-screen image viewer: tap to toggle fit / 100% zoom.

import { $, show, objectUrlSlot } from './dom.js';

const root = $('#viewer');
const img = $('#viewer-img');
const body = $('#viewer-body');
const url = objectUrlSlot();

function close() {
  show(root, false);
  document.body.classList.remove('modal-open');
  img.removeAttribute('src');
  url.set(null);
}

body.addEventListener('click', (e) => {
  const zoomed = body.classList.toggle('zoomed');
  if (zoomed) {
    // Keep the tapped point under the finger after zooming
    const r = img.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    requestAnimationFrame(() => {
      body.scrollLeft = fx * img.scrollWidth - body.clientWidth / 2;
      body.scrollTop = fy * img.scrollHeight - body.clientHeight / 2;
    });
  }
});
$('#viewer-close').addEventListener('click', close);
addEventListener('keydown', (e) => e.key === 'Escape' && !root.hidden && close());

export function openViewer(blob, title = 'Anteprima') {
  $('#viewer-title').textContent = title;
  body.classList.remove('zoomed');
  img.src = url.set(blob);
  show(root, true);
  document.body.classList.add('modal-open');
}
