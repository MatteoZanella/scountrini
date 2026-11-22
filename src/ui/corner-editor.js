// Interactive quadrilateral editor: drag the 4 corners (or an edge midpoint
// to move a whole side). A magnifier shows the area under the finger.

const HIT_RADIUS = 34; // css px, touch friendly
const LOUPE_ZOOM = 3;
// AGESCI yellow over a dark halo: readable on white paper and on dark tables
const HANDLE = { color: '#fdc500', halo: 'rgba(20,12,36,0.85)' };

export class CornerEditor {
  #canvas;
  #loupe;
  #stage;
  #src = null;
  #display = null; // pre-scaled bitmap for fast redraws
  #pts = [];
  #scale = 1;
  #offset = { x: 0, y: 0 };
  #drag = null;
  #ro;
  #dpr = 1;

  constructor(canvas, loupe, stage) {
    this.#canvas = canvas;
    this.#loupe = loupe;
    this.#stage = stage;
    canvas.addEventListener('pointerdown', this.#onDown);
    canvas.addEventListener('pointermove', this.#onMove);
    canvas.addEventListener('pointerup', this.#onUp);
    canvas.addEventListener('pointercancel', this.#onUp);
    this.#ro = new ResizeObserver(() => this.#src && this.#layout());
    this.#ro.observe(stage);
  }

  setImage(src, corners) {
    this.#src = src;
    this.#pts = corners.map((p) => ({ ...p }));
    this.#layout();
  }

  get corners() {
    return this.#pts.map((p) => ({ x: p.x, y: p.y }));
  }

  set corners(c) {
    this.#pts = c.map((p) => ({ ...p }));
    this.#draw();
  }

  #layout() {
    const pad = 24;
    const W = this.#stage.clientWidth;
    const H = this.#stage.clientHeight;
    if (!W || !H) return;
    const s = Math.min((W - pad * 2) / this.#src.width, (H - pad * 2) / this.#src.height);
    this.#scale = s;
    const cw = Math.round(this.#src.width * s);
    const ch = Math.round(this.#src.height * s);
    this.#dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = this.#canvas;
    c.style.width = `${cw}px`;
    c.style.height = `${ch}px`;
    c.width = Math.round(cw * this.#dpr);
    c.height = Math.round(ch * this.#dpr);
    this.#offset = { x: (W - cw) / 2, y: (H - ch) / 2 };
    const d = document.createElement('canvas');
    d.width = c.width;
    d.height = c.height;
    const dctx = d.getContext('2d');
    dctx.imageSmoothingQuality = 'high';
    dctx.drawImage(this.#src, 0, 0, d.width, d.height);
    this.#display = d;
    this.#draw();
  }

  #toCss = (p) => ({ x: p.x * this.#scale, y: p.y * this.#scale });

  #handles() {
    const css = this.#pts.map(this.#toCss);
    const mids = css.map((p, i) => {
      const q = css[(i + 1) % 4];
      return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    });
    return { css, mids };
  }

  #draw() {
    const c = this.#canvas;
    if (!this.#display) return;
    const ctx = c.getContext('2d');
    const k = this.#dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(this.#display, 0, 0);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const { css, mids } = this.#handles();

    // Dim everything outside the selection
    ctx.beginPath();
    ctx.rect(0, 0, c.width / k, c.height / k);
    ctx.moveTo(css[0].x, css[0].y);
    for (let i = 3; i >= 0; i--) ctx.lineTo(css[i].x, css[i].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fill('evenodd');

    ctx.beginPath();
    css.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    // Two-tone outline: visible on white paper and on dark backgrounds alike
    ctx.lineWidth = 5;
    ctx.strokeStyle = HANDLE.halo;
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = HANDLE.color;
    ctx.stroke();

    for (const [i, m] of mids.entries()) {
      const horizontal = i % 2 === 0;
      ctx.beginPath();
      ctx.roundRect(
        m.x - (horizontal ? 14 : 4),
        m.y - (horizontal ? 4 : 14),
        horizontal ? 28 : 8,
        horizontal ? 8 : 28,
        4,
      );
      ctx.fillStyle = HANDLE.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = HANDLE.halo;
      ctx.stroke();
    }
    for (const [i, p] of css.entries()) {
      const active = this.#drag?.type === 'corner' && this.#drag.index === i;
      ctx.beginPath();
      ctx.arc(p.x, p.y, active ? 13 : 11, 0, Math.PI * 2);
      ctx.fillStyle = active ? HANDLE.color : 'rgba(255,255,255,0.95)';
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = HANDLE.halo;
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = HANDLE.color;
      ctx.stroke();
    }
  }

  #eventPoint(e) {
    const r = this.#canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  #onDown = (e) => {
    const p = this.#eventPoint(e);
    const { css, mids } = this.#handles();
    let best = null;
    css.forEach((q, i) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < HIT_RADIUS && (!best || d < best.d)) best = { type: 'corner', index: i, d };
    });
    if (!best) {
      mids.forEach((q, i) => {
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < HIT_RADIUS && (!best || d < best.d)) best = { type: 'edge', index: i, d };
      });
    }
    if (!best) return;
    e.preventDefault();
    this.#canvas.setPointerCapture(e.pointerId);
    this.#drag = { ...best, last: p };
    this.#draw();
    this.#updateLoupe(best.type === 'corner' ? this.#pts[best.index] : this.#midSource(best.index), p);
  };

  #midSource(i) {
    const a = this.#pts[i];
    const b = this.#pts[(i + 1) % 4];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  #clamp(p) {
    return {
      x: Math.max(0, Math.min(this.#src.width, p.x)),
      y: Math.max(0, Math.min(this.#src.height, p.y)),
    };
  }

  #onMove = (e) => {
    if (!this.#drag) return;
    const p = this.#eventPoint(e);
    const dx = (p.x - this.#drag.last.x) / this.#scale;
    const dy = (p.y - this.#drag.last.y) / this.#scale;
    this.#drag.last = p;
    const { type, index } = this.#drag;
    if (type === 'corner') {
      this.#pts[index] = this.#clamp({ x: this.#pts[index].x + dx, y: this.#pts[index].y + dy });
    } else {
      for (const j of [index, (index + 1) % 4]) {
        this.#pts[j] = this.#clamp({ x: this.#pts[j].x + dx, y: this.#pts[j].y + dy });
      }
    }
    this.#draw();
    this.#updateLoupe(type === 'corner' ? this.#pts[index] : this.#midSource(index), p);
  };

  #onUp = () => {
    this.#drag = null;
    this.#loupe.hidden = true;
    this.#draw();
  };

  #updateLoupe(srcPt, cssPt) {
    const L = this.#loupe;
    L.hidden = false;
    const size = L.width;
    const ctx = L.getContext('2d');
    const region = size / LOUPE_ZOOM / (this.#scale * this.#dpr);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(this.#src, srcPt.x - region / 2, srcPt.y - region / 2, region, region, 0, 0, size, size);
    // Selection edges in loupe coordinates
    const f = size / region;
    const toL = (p) => ({ x: (p.x - srcPt.x) * f + size / 2, y: (p.y - srcPt.y) * f + size / 2 });
    ctx.beginPath();
    this.#pts.map(toL).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.strokeStyle = HANDLE.halo;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = HANDLE.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(size / 2 - 12, size / 2);
    ctx.lineTo(size / 2 + 12, size / 2);
    ctx.moveTo(size / 2, size / 2 - 12);
    ctx.lineTo(size / 2, size / 2 + 12);
    ctx.stroke();
    // Keep the loupe away from the finger
    const leftHalf = cssPt.x + this.#offset.x < this.#stage.clientWidth / 2;
    L.classList.toggle('right', leftHalf);
  }
}
