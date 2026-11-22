// Tiny DOM toolkit: selectors, element builder, icons, toasts, dialogs.
// All user/OCR-provided text goes through textContent (never innerHTML).

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * h('button.btn.primary', { onclick, type: 'button' }, 'Testo', childNode)
 * Strings become text nodes; attributes starting with "on" become listeners.
 */
export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'class') el.className += ` ${v}`;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  if (cls) svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export function show(el, visible = true) {
  el.hidden = !visible;
}

// ---- Toasts ----
export function toast(message, { type = 'info', timeout = 3500, action } = {}) {
  const box = $('#toasts');
  const el = h(`div.toast.${type}`, { role: 'status' }, h('span', {}, message));
  if (action) {
    el.append(h('button.toast-action', { type: 'button', onclick: () => (action.run(), el.remove()) }, action.label));
  }
  box.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  if (timeout) {
    setTimeout(() => {
      el.classList.remove('in');
      setTimeout(() => el.remove(), 300);
    }, timeout);
  }
  return el;
}

// ---- Dialogs (native <dialog>) ----
/**
 * Opens the shared dialog and resolves to the value of the button that closed
 * it ('ok', 'cancel', or the `value` of any button placed in `body`: the
 * dialog is a <form method="dialog">). `ok: null` hides the OK button.
 */
export function openDialog({ title, body = '', ok = 'OK', cancel = 'Annulla', danger = false }) {
  const dlg = $('#dialog');
  $('#dialog-title', dlg).textContent = title;
  const bodyEl = $('#dialog-body', dlg);
  bodyEl.replaceChildren(...(body instanceof Node ? [body] : [h('p', {}, body)]));
  const okBtn = $('#dialog-ok', dlg);
  okBtn.textContent = ok ?? '';
  okBtn.classList.toggle('danger', danger);
  show(okBtn, ok !== null);
  const cancelBtn = $('#dialog-cancel', dlg);
  cancelBtn.textContent = cancel;
  show(cancelBtn, cancel !== null);
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true });
    dlg.returnValue = '';
    dlg.showModal();
  });
}

export const confirmDialog = async (opts) => (await openDialog(opts)) === 'ok';

// ---- Segmented controls ----
/** Renders single-choice buttons (optional `icon` per option) into `container`; returns { set(value) }. */
export function segmented(container, options, { value, onChange } = {}) {
  container.replaceChildren(
    ...options.map((o) => {
      const opt = typeof o === 'string' ? { value: o, label: o } : o;
      return h(
        'button',
        { type: 'button', role: 'radio', 'aria-label': opt.ariaLabel, dataset: { value: opt.value } },
        opt.icon ? icon(opt.icon) : null,
        opt.label,
      );
    }),
  );
  const set = (v) => {
    for (const b of container.children) {
      const on = b.dataset.value === v;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
  };
  container.onclick = (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b) return;
    set(b.dataset.value);
    onChange?.(b.dataset.value);
  };
  set(value);
  return { set };
}

/** Object URL that is revoked when replaced; avoids leaking blob URLs. */
export function objectUrlSlot() {
  let url = null;
  return {
    set(blob) {
      if (url) URL.revokeObjectURL(url);
      url = blob ? URL.createObjectURL(blob) : null;
      return url;
    },
  };
}

/** Copies text, falling back to a selectable field when the clipboard is blocked. */
export async function copyText(text, { title, success }) {
  try {
    await navigator.clipboard.writeText(text);
    toast(success, { type: 'success' });
  } catch {
    await confirmDialog({
      title,
      body: h('input.copy-field', { value: text, readonly: true, onfocus: (e) => e.target.select() }),
      cancel: null,
    });
  }
}
