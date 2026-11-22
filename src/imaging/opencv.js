// Lazy loader for OpenCV.js (≈10 MB, served from /vendor and cached by the
// service worker) plus the shared jscanify instance that depends on it.

import jscanify from 'jscanify/client';

const SRC = `${import.meta.env.BASE_URL}vendor/opencv.js`;
let cvPromise = null;
let scanner = null;

export function loadOpenCV() {
  if (cvPromise) return cvPromise;
  cvPromise = new Promise((resolve, reject) => {
    let settled = false;
    const ready = () => {
      if (settled) return;
      settled = true;
      // The Emscripten module is a thenable resolving to itself: resolving a
      // promise with it would loop forever. Drop `then` once it is ready.
      if (typeof window.cv.then === 'function') delete window.cv.then;
      resolve(window.cv);
    };
    const waitRuntime = () => {
      const cv = window.cv;
      if (!cv) return reject(new Error('OpenCV non disponibile'));
      if (cv.Mat) return ready();
      // Never `await cv`: the Emscripten module is a thenable that resolves to
      // itself, which would loop forever.
      if (typeof cv.then === 'function') {
        cv.then((mod) => {
          window.cv = mod;
          ready();
        });
      } else {
        cv.onRuntimeInitialized = ready;
      }
      const poll = setInterval(() => window.cv?.Mat && (clearInterval(poll), ready()), 250);
      setTimeout(() => clearInterval(poll), 90_000);
    };
    if (window.cv) return waitRuntime();
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = waitRuntime;
    s.onerror = () => {
      cvPromise = null;
      reject(new Error('Impossibile caricare OpenCV: serve la rete al primo utilizzo'));
    };
    document.head.appendChild(s);
  });
  return cvPromise;
}

export async function getScanner() {
  await loadOpenCV();
  scanner ||= new jscanify();
  return scanner;
}

/** Runs `fn` and deletes every Mat registered through `track`, even on error. */
export function withMats(fn) {
  const mats = [];
  const track = (m) => (mats.push(m), m);
  try {
    return fn(track);
  } finally {
    for (const m of mats) {
      try {
        m.delete();
      } catch {
        /* already freed */
      }
    }
  }
}
