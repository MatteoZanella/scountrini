// Camera capture for desktops. Phones use <input capture>, which opens the
// system camera app (autofocus, flash, full resolution); desktop browsers
// ignore `capture` and show a file picker, so there we film from the webcam.

import { h, icon, toast } from './dom.js';

/** True where <input capture> opens a camera: touch-first devices. */
export const hasSystemCamera = () => matchMedia('(pointer: coarse)').matches;

export const canUseWebcam = () => Boolean(navigator.mediaDevices?.getUserMedia);

/** Opens a full-screen webcam view. Resolves to a JPEG File, or null if closed. */
export async function captureFromWebcam() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 3840 }, height: { ideal: 2160 } },
      audio: false,
    });
  } catch (e) {
    toast(
      e.name === 'NotAllowedError'
        ? 'Permesso della fotocamera negato: abilitalo dalle impostazioni del browser'
        : 'Nessuna fotocamera disponibile: usa Galleria',
      { type: 'warn', timeout: 6000 },
    );
    return null;
  }

  const video = h('video.webcam-video', { autoplay: true, playsinline: true, muted: true });
  video.srcObject = stream;
  const shutter = h('button.btn.primary.block', { type: 'button' }, icon('camera'), 'Scatta');
  const closeBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Chiudi la fotocamera' }, icon('x'));
  const root = h(
    'div.scanner',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Fotocamera' },
    h(
      'header.sc-head',
      {},
      closeBtn,
      h('div.sc-title', {}, h('strong', {}, 'Fotocamera'), h('small', {}, 'Inquadra lo scontrino su un fondo scuro')),
    ),
    h('div.sc-stage', {}, video),
    h('footer.sc-foot', {}, h('div.sc-step', {}, shutter)),
  );
  document.body.append(root);
  document.body.classList.add('modal-open');
  shutter.focus();

  return new Promise((resolve) => {
    const finish = (file) => {
      stream.getTracks().forEach((t) => t.stop());
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
      root.remove();
      resolve(file);
    };
    const onKey = (e) => e.key === 'Escape' && finish(null);
    document.addEventListener('keydown', onKey);
    closeBtn.addEventListener('click', () => finish(null));
    shutter.addEventListener('click', () => {
      if (!video.videoWidth) return; // stream not ready yet
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      c.toBlob((blob) => finish(blob && new File([blob], 'webcam.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.95);
    });
  });
}
