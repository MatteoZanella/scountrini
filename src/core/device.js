// Best-effort device description (user can override it in Settings).

export async function guessDeviceName() {
  try {
    if (navigator.userAgentData?.getHighEntropyValues) {
      const v = await navigator.userAgentData.getHighEntropyValues(['model', 'platform']);
      const parts = [v.model, v.platform].filter(Boolean);
      if (parts.length) return parts.join(' · ');
    }
  } catch {
    /* not available */
  }
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  const android = /Android[^;]*;\s*([^;)]+?)(?:\sBuild|\))/.exec(ua);
  if (android && !/^(K|wv)$/.test(android[1].trim())) return `${android[1].trim()} · Android`;
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'PC Windows';
  if (/Macintosh/.test(ua)) return 'Mac';
  return 'Dispositivo';
}

export function isIOS() {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export const isAndroid = () => /Android/.test(navigator.userAgent);

export function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
