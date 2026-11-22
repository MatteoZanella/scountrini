// Extra ways to bring photos in besides camera and gallery: the clipboard
// (button, Ctrl/⌘+V) and drag and drop of image files onto the window.

import { h, icon } from './dom.js';

const isImage = (f) => f && f.type.startsWith('image/');
const isEditable = (el) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/** True where the async Clipboard API can read images (Chromium, Safari, Firefox ≥ 127). */
export const canReadClipboardImages = () => Boolean(navigator.clipboard?.read);

/**
 * Reads images from the clipboard (asks for permission where the browser
 * requires it). Resolves to File objects, possibly none.
 */
export async function readClipboardImages() {
  const files = [];
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (!type) continue;
    const blob = await item.getType(type);
    const ext = type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    files.push(new File([blob], `appunti-${files.length + 1}.${ext}`, { type, lastModified: Date.now() }));
  }
  return files;
}

const imageFiles = (dataTransfer) => [...(dataTransfer?.files || [])].filter(isImage);
const carriesFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

/**
 * Wires paste and drag-and-drop. `isActive()` decides whether photos are
 * accepted right now (e.g. only on the "Nuovo" view with no dialog open);
 * `onFiles(files, origin)` receives the images ('clipboard' or 'gallery' for dropped files).
 */
export function initPhotoIntake({ isActive, onFiles }) {
  document.addEventListener('paste', (e) => {
    if (!isActive() || isEditable(e.target)) return;
    const files = imageFiles(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    onFiles(files, 'clipboard');
  });

  const overlay = h(
    'div.drop-overlay',
    { hidden: true, 'aria-hidden': 'true' },
    h('div', {}, icon('image'), h('span', {}, 'Rilascia per aggiungere la foto')),
  );
  document.body.append(overlay);
  let depth = 0; // dragenter/leave fire for every child element
  const hide = () => {
    depth = 0;
    overlay.hidden = true;
  };

  document.addEventListener('dragenter', (e) => {
    if (!carriesFiles(e) || !isActive()) return;
    depth++;
    overlay.hidden = false;
  });
  document.addEventListener('dragleave', () => {
    if (depth && --depth === 0) overlay.hidden = true;
  });
  document.addEventListener('dragover', (e) => {
    if (!carriesFiles(e) || !isActive()) return;
    e.preventDefault(); // allows dropping
    e.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('drop', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault(); // never let the browser navigate to the file
    hide();
    if (!isActive()) return;
    const files = imageFiles(e.dataTransfer);
    if (files.length) onFiles(files, 'gallery');
  });
}
