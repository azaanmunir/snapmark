// SnapMark capture overlay: one instance per display.
// Coordinates: everything is stored in DIP ("points") relative to this display.
// K = physical pixels per DIP (2 on Retina). The frozen screenshot `bmp` is IMGW x IMGH physical px.
(() => {
  const api = window.snap;
  const isMac = api.platform === 'darwin';
  const MODK = isMac ? '⌘' : 'Ctrl+';
  const SHIFTK = isMac ? '⇧' : 'Shift+';
  const $ = (id) => document.getElementById(id);
  const canvas = $('c');
  const ctx = canvas.getContext('2d');
  const elTools = $('tools');
  const elDock = $('dock');
  const elOpts = $('opts');
  const elActions = $('actions');
  const elBadge = $('badge');
  const elText = $('textEditor');
  const elToast = $('toast');

  let W = 0, H = 0, DPR = 1, K = 1, IMGW = 0, IMGH = 0;
  let bmp = null; // ImageBitmap of the frozen screen
  let rgba = null; // raw pixels for the color picker
  let busy = false;
  let nextId = 1;

  const PALETTE = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#0A84FF', '#5E5CE6', '#FF2D55', '#FFFFFF', '#1C1C1E'];

  const TOOLS = [
    { id: null, key: 'v', icon: 'move', label: 'Move / select' },
    '|',
    { id: 'pen', key: 'p', label: 'Pen' },
    { id: 'marker', key: 'm', label: 'Highlighter' },
    { id: 'line', key: 'l', label: 'Line' },
    { id: 'arrow', key: 'a', label: 'Arrow' },
    { id: 'rect', key: 'r', label: 'Rectangle' },
    { id: 'ellipse', key: 'e', label: 'Ellipse / circle' },
    { id: 'text', key: 't', label: 'Text' },
    { id: 'number', key: 'n', label: 'Step number' },
    { id: 'pointer', key: 'u', label: 'Cursor pointer' },
    '|',
    { id: 'blur', key: 'b', label: 'Blur / pixelate' },
    { id: 'spotlight', key: 'f', label: 'Spotlight' },
    { id: 'measure', key: 'd', label: 'Measure' },
    { id: 'eyedropper', key: 'i', label: 'Color picker' },
  ];

  // which option controls each tool shows
  const OPTS = {
    pen: ['color', 'width'],
    marker: ['color', 'width'],
    line: ['color', 'width'],
    arrow: ['color', 'width'],
    rect: ['color', 'width', 'radius', 'fill'],
    ellipse: ['color', 'width', 'fill'],
    text: ['color', 'size', 'fill'],
    number: ['color', 'size', 'labelBg', 'autoLabel'],
    pointer: ['pointerStyle', 'color', 'size', 'labelBg', 'autoLabel'],
    blur: ['blurStyle', 'width'],
    spotlight: ['radius'],
    measure: ['color'],
    eyedropper: ['pickNote'],
  };

  const S = {
    phase: 'idle', // idle | selecting | edit
    sel: null,
    tool: null,
    annos: [],
    draft: null,
    selectedId: null,
    undo: [],
    redo: [],
    mouse: { x: -1, y: -1 },
    drag: null,
    space: false,
    editing: null,
    clip: null,
    prefs: {},
  };

  if (location.hash === '#test') { window.__S = S; window.__T = { annoHandles: (a) => annoHandles(a), bbox: (a) => bbox(a) }; } // scripts/smoke-test.js

  // each sized tool remembers its own size
  const SIZEKEY = { text: 'fontSize', number: 'numberSize', pointer: 'pointerSize' };
  const SIZEDEF = { fontSize: 20, numberSize: 20, pointerSize: 22 };

  // ------------------------------------------------------------ helpers
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const snap = (v) => Math.round(v * K) / K; // snap to physical pixel grid
  const pt = (e) => ({ x: snap(clamp(e.clientX, 0, W)), y: snap(clamp(e.clientY, 0, H)) });
  const normRect = (x0, y0, x1, y1) => ({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });
  const inRect = (p, r, pad = 0) => r && p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
  const fmt = (v) => String(Math.round(v));
  const pxLabel = (dip) => (K === 1 ? `${fmt(dip)}` : `${fmt(dip * K)}`);
  const hex2 = (n) => n.toString(16).padStart(2, '0').toUpperCase();

  function contrast(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#111111' : '#FFFFFF';
  }

  function colorAt(p) {
    const px = clamp(Math.floor(p.x * K), 0, IMGW - 1);
    const py = clamp(Math.floor(p.y * K), 0, IMGH - 1);
    const i = (py * IMGW + px) * 4;
    return { r: rgba[i], g: rgba[i + 1], b: rgba[i + 2], hex: `#${hex2(rgba[i])}${hex2(rgba[i + 1])}${hex2(rgba[i + 2])}` };
  }

  function toast(msg) {
    elToast.textContent = msg;
    elToast.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => elToast.classList.remove('show'), 1500);
  }

  let prefTimer = 0;
  function setPref(key, val) {
    S.prefs[key] = val;
    if (S.editing) {
      const ea = S.editing.a;
      if (key === 'color') ea.color = val;
      if (key === SIZEKEY[ea.type]) ea.size = val;
      if (key === 'fill') ea.fill = val;
      if (key === 'labelBg') ea.labelBg = val;
      styleEditor();
    }
    clearTimeout(prefTimer);
    prefTimer = setTimeout(() => api.savePrefs({
      color: S.prefs.color, width: S.prefs.width, fontSize: S.prefs.fontSize, radius: S.prefs.radius,
      numberSize: S.prefs.numberSize, pointerSize: S.prefs.pointerSize,
      fill: S.prefs.fill, blurStyle: S.prefs.blurStyle, pointerStyle: S.prefs.pointerStyle, customColors: S.prefs.customColors,
      labelBg: S.prefs.labelBg, autoLabel: S.prefs.autoLabel,
    }), 300);
    applyPrefToSelected(key, val);
  }

  // ------------------------------------------------------------ init
  api.onInit(async (d) => {
    W = d.width; H = d.height; IMGW = d.imgW; IMGH = d.imgH;
    DPR = window.devicePixelRatio || d.scaleFactor || 1;
    S.prefs = { ...d.settings };
    if (!IMGW || !IMGH) {
      toast('Screen capture returned no image');
      setTimeout(() => api.cancel(), 1200);
      api.ready();
      return;
    }
    K = IMGW / W;
    const src = new Uint8Array(d.bitmap.buffer || d.bitmap, d.bitmap.byteOffset || 0, IMGW * IMGH * 4);
    rgba = new Uint8ClampedArray(IMGW * IMGH * 4);
    for (let i = 0; i < rgba.length; i += 4) { // BGRA -> RGBA
      rgba[i] = src[i + 2]; rgba[i + 1] = src[i + 1]; rgba[i + 2] = src[i]; rgba[i + 3] = 255;
    }
    bmp = await createImageBitmap(new ImageData(rgba, IMGW, IMGH));
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    if (d.cursor) S.mouse = { x: d.cursor.x, y: d.cursor.y };
    buildTools();
    buildActions();
    buildOpts();
    render();
    requestAnimationFrame(() => api.ready());
  });

  // ------------------------------------------------------------ toolbar DOM
  function btn({ icon, tip, onClick, cls = '', data = {} }) {
    const b = document.createElement('button');
    b.className = `btn ${cls}`;
    b.innerHTML = window.icon(icon);
    if (tip) b.dataset.tip = tip;
    for (const [k, v] of Object.entries(data)) b.dataset[k] = v;
    b.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
    return b;
  }
  function sep() {
    const s = document.createElement('div');
    s.className = 'sep';
    return s;
  }

  function buildTools() {
    elTools.innerHTML = '';
    for (const t of TOOLS) {
      if (t === '|') { elTools.appendChild(sep()); continue; }
      elTools.appendChild(btn({
        icon: t.icon || t.id, tip: `${t.label}  ${t.key.toUpperCase()}`, data: { tool: t.id || 'move' },
        onClick: () => setTool(t.id),
      }));
    }
    elTools.appendChild(sep());
    elTools.appendChild(btn({ icon: 'undo', tip: `Undo  ${MODK}Z`, data: { act: 'undo' }, onClick: undo }));
    elTools.appendChild(btn({ icon: 'redo', tip: `Redo  ${SHIFTK}${MODK}Z`, data: { act: 'redo' }, onClick: redo }));
    syncTools();
  }

  function syncTools() {
    for (const b of elTools.querySelectorAll('[data-tool]')) {
      const id = b.dataset.tool === 'move' ? null : b.dataset.tool;
      b.classList.toggle('active', id === S.tool);
    }
    const u = elTools.querySelector('[data-act="undo"]');
    const r = elTools.querySelector('[data-act="redo"]');
    if (u) u.disabled = !S.undo.length;
    if (r) r.disabled = !S.redo.length;
  }

  function buildActions() {
    elActions.innerHTML = '';
    elActions.appendChild(btn({ icon: 'pin', tip: `Pin on screen  ${MODK}P`, onClick: () => finish('pin') }));
    elActions.appendChild(btn({ icon: 'quicksave', tip: `Quick save to folder  ${SHIFTK}${MODK}S`, onClick: () => finish('quicksave') }));
    elActions.appendChild(btn({ icon: 'save', tip: `Save as…  ${MODK}S`, onClick: () => finish('save') }));
    elActions.appendChild(sep());
    elActions.appendChild(btn({ icon: 'cut', tip: `Cut  ${MODK}X  (selected shape, else copy & close)`, onClick: cut }));
    elActions.appendChild(btn({ icon: 'copy', tip: `Copy  ${MODK}C / Enter`, cls: 'primary', onClick: () => finish('copy') }));
    elActions.appendChild(btn({ icon: 'close', tip: 'Close  Esc', onClick: () => api.cancel() }));
  }

  function optTool() {
    if (S.tool) return S.tool;
    const a = selectedAnno();
    return a ? a.type : null;
  }

  function buildOpts() {
    elOpts.innerHTML = '';
    const t = optTool();
    const list = OPTS[t] || [];
    const P = S.prefs;
    for (const o of list) {
      if (o === 'color') {
        const all = [...PALETTE, ...(P.customColors || [])].filter((c, i, arr) => arr.indexOf(c) === i).slice(0, 14);
        for (const c of all) {
          const s = document.createElement('button');
          s.className = `swatch${c.toUpperCase() === String(P.color).toUpperCase() ? ' active' : ''}`;
          s.style.background = c;
          s.dataset.tip = c;
          s.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
          s.addEventListener('click', () => { setPref('color', c); buildOpts(); });
          elOpts.appendChild(s);
        }
        const custom = document.createElement('label');
        custom.className = 'swatch custom';
        custom.dataset.tip = 'Custom color';
        const inp = document.createElement('input');
        inp.type = 'color';
        inp.value = /^#[0-9a-f]{6}$/i.test(P.color) ? P.color : '#ff3b30';
        inp.addEventListener('input', () => setPref('color', inp.value.toUpperCase()));
        inp.addEventListener('change', () => {
          const c = inp.value.toUpperCase();
          if (!PALETTE.includes(c)) setPref('customColors', [c, ...(P.customColors || []).filter((x) => x !== c)].slice(0, 5));
          buildOpts();
        });
        custom.appendChild(inp);
        elOpts.appendChild(custom);
        const hx = document.createElement('button');
        hx.className = 'hex';
        hx.textContent = String(P.color).toUpperCase();
        hx.dataset.tip = 'Copy HEX';
        hx.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
        hx.addEventListener('click', () => { api.copyText(String(P.color).toUpperCase()); toast(`Copied ${String(P.color).toUpperCase()}`); });
        elOpts.appendChild(hx);
        elOpts.appendChild(sep());
      } else if (o === 'width' || o === 'size' || o === 'radius') {
        const key = o === 'size' ? SIZEKEY[t] : o;
        if (P[key] == null) P[key] = SIZEDEF[key];
        const label = { width: t === 'blur' ? 'Strength' : 'Stroke', size: 'Size', radius: 'Radius' }[o];
        const [min, max] = { width: [1, 24], size: [10, 72], radius: [0, 40] }[o];
        const wrap = document.createElement('label');
        wrap.className = 'ctl';
        wrap.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="1"><span class="val"></span>`;
        const r = wrap.querySelector('input');
        const v = wrap.querySelector('.val');
        r.value = P[key];
        v.textContent = P[key];
        r.addEventListener('pointerdown', (e) => e.stopPropagation());
        r.addEventListener('input', () => { v.textContent = r.value; setPref(key, Number(r.value)); });
        elOpts.appendChild(wrap);
      } else if (o === 'fill' || o === 'labelBg' || o === 'autoLabel') {
        const on = o === 'fill' ? !!P.fill : P[o] !== false;
        const b = document.createElement('button');
        b.className = `toggle${on ? ' on' : ''}`;
        b.textContent = { fill: t === 'text' ? 'Background' : 'Filled', labelBg: 'Label background', autoLabel: 'Add label on click' }[o];
        if (o === 'autoLabel') b.dataset.tip = 'Type a label right after placing · click it again to edit';
        b.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
        b.addEventListener('click', () => { setPref(o, !on); buildOpts(); });
        elOpts.appendChild(b);
      } else if (o === 'blurStyle' || o === 'pointerStyle') {
        const choices = o === 'blurStyle'
          ? [['pixelate', 'Pixelate'], ['blur', 'Blur']]
          : [['mac', 'Mac'], ['classic', 'Classic'], ['color', 'Color'], ['click', 'Click']];
        const seg = document.createElement('div');
        seg.className = 'seg';
        for (const [val, lab] of choices) {
          const b = document.createElement('button');
          b.textContent = lab;
          b.className = P[o] === val ? 'on' : '';
          b.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
          b.addEventListener('click', () => { setPref(o, val); buildOpts(); });
          seg.appendChild(b);
        }
        elOpts.appendChild(seg);
      } else if (o === 'pickNote') {
        const n = document.createElement('span');
        n.className = 'note';
        n.textContent = 'Click a pixel to copy its HEX and use it as the drawing color  ·  Shift+click copies rgb()';
        elOpts.appendChild(n);
      }
    }
    if (canEditSelected(selectedAnno())) {
      elOpts.appendChild(btn({ icon: 'trash', tip: 'Delete  ⌫', onClick: deleteSelected }));
    }
    layout();
  }

  function setTool(id) {
    commitText();
    S.tool = S.tool === id ? null : id;
    if (S.tool && !(LABELED.includes(S.tool) && (selectedAnno() || {}).type === S.tool)) S.selectedId = null;
    syncTools();
    buildOpts();
    updateCursor(S.mouse);
    render();
  }

  // ------------------------------------------------------------ layout of bars / badge
  function layout() {
    const s = S.sel;
    const edit = S.phase === 'edit' && s && s.w > 0 && s.h > 0;
    document.body.classList.toggle('has-selection', !!(s && s.w > 0));
    elTools.hidden = !edit;
    elDock.hidden = !edit;
    if (!edit) return;
    const gap = 8;
    const tb = elTools.getBoundingClientRect();
    let tx = s.x + s.w + gap;
    elTools.classList.remove('left');
    if (tx + tb.width > W - 4) {
      tx = s.x - tb.width - gap;
      elTools.classList.add('left');
      if (tx < 4) { tx = s.x + s.w - tb.width - gap; elTools.classList.remove('left'); }
    }
    const ty = clamp(s.y, 4, Math.max(4, H - tb.height - 4));
    elTools.style.left = `${tx}px`;
    elTools.style.top = `${ty}px`;

    elDock.style.maxWidth = `${W - 8}px`;
    const db = elDock.getBoundingClientRect();
    let dy = s.y + s.h + gap;
    elDock.classList.remove('above');
    if (dy + db.height > H - 4) {
      dy = s.y - db.height - gap;
      elDock.classList.add('above');
      if (dy < 4) { dy = s.y + s.h - db.height - gap; elDock.classList.remove('above'); }
    }
    let dx = clamp(s.x + s.w - db.width, 4, Math.max(4, W - db.width - 4));
    const t = { x: tx, y: ty, w: tb.width, h: tb.height };
    const overlaps = (x, y) => x < t.x + t.w + 4 && x + db.width > t.x - 4 && y < t.y + t.h + 4 && y + db.height > t.y - 4;
    if (overlaps(dx, dy)) {
      // try: left of the tool column, then above the selection, then below the tool column
      const left = t.x - db.width - gap;
      if (left >= 4 && !overlaps(left, dy)) dx = left;
      else if (s.y - db.height - gap >= 4 && !overlaps(dx, s.y - db.height - gap)) { dy = s.y - db.height - gap; elDock.classList.add('above'); }
      else if (t.y + t.h + gap + db.height <= H - 4) dy = t.y + t.h + gap;
    }
    elDock.style.left = `${dx}px`;
    elDock.style.top = `${dy}px`;
  }

  function updateBadge() {
    const s = S.sel;
    if (!s || s.w < 1 || s.h < 1) { elBadge.hidden = true; return; }
    elBadge.hidden = false;
    elBadge.innerHTML = K === 1
      ? `${fmt(s.w)} × ${fmt(s.h)} px`
      : `${pxLabel(s.w)} × ${pxLabel(s.h)} px<span>${fmt(s.w)} × ${fmt(s.h)} pt @${+K.toFixed(2)}x</span>`;
    const bh = 22;
    const top = s.y - bh - 6 >= 0 ? s.y - bh - 6 : s.y + 6;
    elBadge.style.left = `${clamp(s.x, 4, W - 200)}px`;
    elBadge.style.top = `${top}px`;
  }

  // ------------------------------------------------------------ annotations: geometry
  function selectedAnno() {
    return S.selectedId == null ? null : S.annos.find((a) => a.id === S.selectedId) || null;
  }

  function textMetrics(a) {
    ctx.save();
    ctx.font = textFont(a.size);
    const lines = (a.text || ' ').split('\n');
    const w = Math.max(8, ...lines.map((l) => ctx.measureText(l || ' ').width));
    ctx.restore();
    const lh = a.size * 1.25;
    const pad = a.fill ? a.size * 0.4 : 0;
    return { lines, w, lh, h: lines.length * lh, pad };
  }

  function bbox(a) {
    switch (a.type) {
      case 'pen':
      case 'marker': {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y] of a.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        const m = (a.type === 'marker' ? a.width * 3 : a.width) / 2;
        return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
      }
      case 'line': case 'arrow': case 'measure':
        return normRect(a.x1, a.y1, a.x2, a.y2);
      case 'text': {
        const m = textMetrics(a);
        return { x: a.x - m.pad, y: a.y - m.pad * 0.6, w: m.w + m.pad * 2, h: m.h + m.pad * 1.2 };
      }
      case 'number': {
        const r = a.size * 0.72;
        return withLabel(a, { x: a.x - r, y: a.y - r, w: r * 2, h: r * 2 });
      }
      case 'pointer': {
        const s = a.size / 20;
        const ring = a.style === 'click' ? 22 * s : 0;
        return withLabel(a, { x: a.x - ring, y: a.y - ring, w: 13 * s + ring, h: 20 * s + ring });
      }
      default:
        return { x: a.x, y: a.y, w: a.w, h: a.h };
    }
  }

  // Step numbers and pointers can carry a text label (rendered like a text annotation beside them)
  const LABELED = ['text', 'number', 'pointer'];
  function labelInfo(a, text = a.label) {
    const bg = a.labelBg !== false;
    if (a.type === 'number') {
      const r = a.size * 0.72;
      const size = Math.max(11, Math.round(a.size * 0.8));
      const pad = bg ? size * 0.4 : 0;
      return { type: 'text', x: a.x + r + 6 + pad, y: a.y - (size * 1.25) / 2, size, color: a.color, fill: bg, text: text || '' };
    }
    const s = a.size / 20;
    const size = Math.max(11, Math.round(a.size * 0.62));
    const pad = bg ? size * 0.4 : 0;
    return { type: 'text', x: a.x + 15 * s + 4 + pad, y: a.y + 13 * s, size, color: a.color, fill: bg, text: text || '' };
  }
  function withLabel(a, b) {
    if (!a.label) return b;
    const l = bbox(labelInfo(a));
    const x0 = Math.min(b.x, l.x), y0 = Math.min(b.y, l.y);
    return { x: x0, y: y0, w: Math.max(b.x + b.w, l.x + l.w) - x0, h: Math.max(b.y + b.h, l.y + l.h) - y0 };
  }

  function distSeg(p, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((p.x - x1) * dx + (p.y - y1) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(p.x - (x1 + t * dx), p.y - (y1 + t * dy));
  }

  function hit(a, p) {
    const tol = 6;
    if (a.type === 'line' || a.type === 'arrow' || a.type === 'measure') {
      return distSeg(p, a.x1, a.y1, a.x2, a.y2) <= Math.max(tol, a.width / 2 + 4);
    }
    if (a.type === 'pen' || a.type === 'marker') {
      const w = (a.type === 'marker' ? a.width * 3 : a.width) / 2 + 4;
      if (a.pts.length === 1) return Math.hypot(p.x - a.pts[0][0], p.y - a.pts[0][1]) <= w;
      for (let i = 1; i < a.pts.length; i++) {
        if (distSeg(p, a.pts[i - 1][0], a.pts[i - 1][1], a.pts[i][0], a.pts[i][1]) <= w) return true;
      }
      return false;
    }
    if ((a.type === 'rect' || a.type === 'ellipse') && !a.fill) {
      const b = bbox(a);
      const inner = { x: b.x + a.width + tol, y: b.y + a.width + tol, w: b.w - 2 * (a.width + tol), h: b.h - 2 * (a.width + tol) };
      return inRect(p, b, tol) && !(inner.w > 0 && inner.h > 0 && inRect(p, inner));
    }
    return inRect(p, bbox(a), 2);
  }

  function annoAt(p) {
    for (let i = S.annos.length - 1; i >= 0; i--) if (hit(S.annos[i], p)) return S.annos[i];
    return null;
  }

  function moveAnno(a, dx, dy) {
    if (a.pts) a.pts = a.pts.map(([x, y]) => [x + dx, y + dy]);
    else if (a.x1 !== undefined) { a.x1 += dx; a.y1 += dy; a.x2 += dx; a.y2 += dy; } else { a.x += dx; a.y += dy; }
  }

  function applyPrefToSelected(key, val) {
    const a = selectedAnno();
    if (!canEditSelected(a)) return;
    const map = {
      color: ['pen', 'marker', 'line', 'arrow', 'rect', 'ellipse', 'text', 'number', 'pointer', 'measure'],
      width: ['pen', 'marker', 'line', 'arrow', 'rect', 'ellipse', 'blur'],
      fontSize: ['text'],
      numberSize: ['number'],
      pointerSize: ['pointer'],
      labelBg: ['number', 'pointer'],
      fill: ['rect', 'ellipse', 'text'],
      radius: ['rect', 'spotlight'],
      blurStyle: ['blur'],
      pointerStyle: ['pointer'],
    };
    if (!map[key] || !map[key].includes(a.type)) return;
    // coalesce slider drags into a single undo step
    const now = Date.now();
    const lp = applyPrefToSelected.last;
    if (!lp || lp.key !== key || lp.id !== a.id || now - lp.t > 800) pushUndo();
    applyPrefToSelected.last = { key, id: a.id, t: now };
    const field = { fontSize: 'size', numberSize: 'size', pointerSize: 'size', blurStyle: 'style', pointerStyle: 'style' }[key] || key;
    a[field] = val;
    render();
  }

  // ------------------------------------------------------------ annotations: drawing (shared with export)
  function textFont(size) {
    return `600 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif`;
  }

  function strokePts(c, pts) {
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 1) c.lineTo(pts[0][0] + 0.01, pts[0][1]);
    else if (pts.length === 2) c.lineTo(pts[1][0], pts[1][1]);
    else {
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2;
        const my = (pts[i][1] + pts[i + 1][1]) / 2;
        c.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      const l = pts[pts.length - 1];
      c.lineTo(l[0], l[1]);
    }
    c.stroke();
  }

  function drawArrow(c, a) {
    const { x1, y1, x2, y2 } = a;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1) return;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const head = Math.min(len * 0.6, Math.max(12, a.width * 3.6));
    const hw = head * 0.48;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.lineWidth = a.width;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2 - cos * head * 0.8, y2 - sin * head * 0.8);
    c.stroke();
    c.beginPath();
    c.moveTo(x2, y2);
    c.lineTo(x2 - cos * head + sin * hw, y2 - sin * head - cos * hw);
    c.lineTo(x2 - cos * head - sin * hw, y2 - sin * head + cos * hw);
    c.closePath();
    c.lineWidth = Math.max(1, a.width * 0.35);
    c.fill();
    c.stroke();
  }

  const CURSOR = [[0, 0], [0, 17], [4.2, 13.2], [7, 19.5], [9.8, 18.3], [7.1, 12.3], [12.6, 12.3]];
  function drawPointer(c, a) {
    const s = a.size / 20;
    c.save();
    c.translate(a.x, a.y);
    if (a.style === 'click') {
      c.strokeStyle = a.color;
      for (const [r, al] of [[10, 0.9], [18, 0.45]]) {
        c.globalAlpha = al;
        c.lineWidth = 2.2 * s;
        c.beginPath();
        c.arc(0, 0, r * s, 0, Math.PI * 2);
        c.stroke();
      }
      c.globalAlpha = 1;
    }
    const fill = { mac: '#000000', classic: '#FFFFFF' }[a.style] || a.color;
    const stroke = a.style === 'classic' ? '#000000' : '#FFFFFF';
    c.scale(s, s);
    c.beginPath();
    CURSOR.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.lineJoin = 'round';
    c.shadowColor = 'rgba(0,0,0,0.35)';
    c.shadowBlur = 4;
    c.shadowOffsetY = 1;
    c.fillStyle = fill;
    c.fill();
    c.shadowColor = 'transparent';
    c.strokeStyle = stroke;
    c.lineWidth = 1.4;
    c.stroke();
    c.restore();
  }

  function drawText(c, a) {
    if (!a.text) return;
    const m = textMetrics(a);
    c.save();
    c.font = textFont(a.size);
    c.textBaseline = 'top';
    if (a.fill) {
      c.fillStyle = a.color;
      c.beginPath();
      c.roundRect(a.x - m.pad, a.y - m.pad * 0.6, m.w + m.pad * 2, m.h + m.pad * 1.2, Math.min(a.size * 0.35, 10));
      c.fill();
      c.fillStyle = contrast(a.color);
    } else {
      c.fillStyle = a.color;
    }
    const off = (m.lh - a.size) / 2;
    m.lines.forEach((l, i) => c.fillText(l, a.x, a.y + off + i * m.lh));
    c.restore();
  }

  function drawNumber(c, a) {
    const r = a.size * 0.72;
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.3)';
    c.shadowBlur = 4;
    c.shadowOffsetY = 1;
    c.fillStyle = a.color;
    c.beginPath();
    c.arc(a.x, a.y, r, 0, Math.PI * 2);
    c.fill();
    c.shadowColor = 'transparent';
    c.lineWidth = Math.max(1.5, r * 0.1);
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.stroke();
    c.fillStyle = contrast(a.color);
    c.font = `700 ${Math.round(a.size * (String(a.n).length > 1 ? 0.78 : 0.92))}px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(a.n), a.x, a.y + a.size * 0.04);
    c.restore();
  }

  function drawBlur(c, a) {
    const r = { x: a.x, y: a.y, w: a.w, h: a.h };
    if (r.w < 1 || r.h < 1) return;
    c.save();
    c.beginPath();
    c.rect(r.x, r.y, r.w, r.h);
    c.clip();
    const strength = 3 + a.width * 1.5;
    if (a.style === 'blur') {
      const scale = c.getTransform().a;
      const m = strength * 2;
      c.filter = `blur(${strength * scale}px)`;
      const tr = c.getTransform();
      c.setTransform(1, 0, 0, 1, 0, 0);
      // draw in device space so the filter radius is predictable
      c.drawImage(bmp, (r.x - m) * K, (r.y - m) * K, (r.w + 2 * m) * K, (r.h + 2 * m) * K,
        tr.a * (r.x - m) + tr.e, tr.d * (r.y - m) + tr.f, tr.a * (r.w + 2 * m), tr.d * (r.h + 2 * m));
      c.filter = 'none';
    } else {
      const block = Math.max(3, strength);
      const tw = Math.max(1, Math.round(r.w / block));
      const th = Math.max(1, Math.round(r.h / block));
      const t = new OffscreenCanvas(tw, th);
      const tc = t.getContext('2d');
      tc.drawImage(bmp, r.x * K, r.y * K, r.w * K, r.h * K, 0, 0, tw, th);
      c.imageSmoothingEnabled = false;
      c.drawImage(t, 0, 0, tw, th, r.x, r.y, r.w, r.h);
    }
    c.restore();
  }

  function drawMeasure(c, a) {
    const dx = a.x2 - a.x1, dy = a.y2 - a.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const nx = -dy / len, ny = dx / len;
    c.save();
    c.strokeStyle = a.color;
    c.fillStyle = a.color;
    c.lineWidth = 1.5;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(a.x1, a.y1); c.lineTo(a.x2, a.y2);
    for (const [x, y] of [[a.x1, a.y1], [a.x2, a.y2]]) { c.moveTo(x + nx * 6, y + ny * 6); c.lineTo(x - nx * 6, y - ny * 6); }
    c.stroke();
    let label = K === 1 ? `${fmt(len)} px` : `${fmt(len * K)} px · ${fmt(len)} pt`;
    if (Math.abs(dx) > 2 && Math.abs(dy) > 2) label += `  (${pxLabel(Math.abs(dx))} × ${pxLabel(Math.abs(dy))})`;
    c.font = '600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    const tw = c.measureText(label).width;
    const mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2;
    const off = 14;
    const lx = mx + nx * off - tw / 2 - 6, ly = my + ny * off - 9;
    c.beginPath();
    c.roundRect(lx, ly, tw + 12, 18, 5);
    c.fill();
    c.fillStyle = contrast(a.color);
    c.textBaseline = 'middle';
    c.fillText(label, lx + 6, ly + 9.5);
    c.restore();
  }

  function drawAnno(c, a) {
    c.save();
    c.strokeStyle = a.color;
    c.fillStyle = a.color;
    c.lineWidth = a.width;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    switch (a.type) {
      case 'pen': strokePts(c, a.pts); break;
      case 'marker':
        c.globalAlpha = 0.38;
        c.lineWidth = a.width * 3;
        c.lineCap = 'butt';
        strokePts(c, a.pts);
        break;
      case 'line':
        c.beginPath(); c.moveTo(a.x1, a.y1); c.lineTo(a.x2, a.y2); c.stroke();
        break;
      case 'arrow': drawArrow(c, a); break;
      case 'rect': {
        if (a.w < 1 || a.h < 1) break;
        const rr = Math.min(a.radius || 0, a.w / 2, a.h / 2);
        c.beginPath();
        if (a.fill) { c.roundRect(a.x, a.y, a.w, a.h, rr); c.fill(); } else {
          const h = a.width / 2; // keep stroke inside the drawn box
          c.roundRect(a.x + h, a.y + h, Math.max(0, a.w - a.width), Math.max(0, a.h - a.width), Math.max(0, rr - h));
          c.stroke();
        }
        break;
      }
      case 'ellipse': {
        if (a.w < 1 || a.h < 1) break;
        c.beginPath();
        const h = a.fill ? 0 : a.width / 2;
        c.ellipse(a.x + a.w / 2, a.y + a.h / 2, Math.max(0.5, a.w / 2 - h), Math.max(0.5, a.h / 2 - h), 0, 0, Math.PI * 2);
        if (a.fill) c.fill(); else c.stroke();
        break;
      }
      case 'text': drawText(c, a); break;
      case 'number': drawNumber(c, a); if (a.label) drawText(c, labelInfo(a)); break;
      case 'pointer': drawPointer(c, a); if (a.label) drawText(c, labelInfo(a)); break;
      case 'blur': drawBlur(c, a); break;
      case 'measure': drawMeasure(c, a); break;
      default: break;
    }
    c.restore();
  }

  function drawAnnos(c, list) {
    const spots = [];
    for (const a of list) (a.type === 'spotlight' ? spots.push(a) : drawAnno(c, a));
    if (!spots.length) return;
    const tr = c.getTransform();
    const off = new OffscreenCanvas(c.canvas.width, c.canvas.height);
    const o = off.getContext('2d');
    o.fillStyle = 'rgba(0,0,0,0.6)';
    o.fillRect(0, 0, off.width, off.height);
    o.setTransform(tr);
    o.globalCompositeOperation = 'destination-out';
    o.fillStyle = '#000';
    for (const s of spots) {
      if (s.w < 1 || s.h < 1) continue;
      o.beginPath();
      o.roundRect(s.x, s.y, s.w, s.h, Math.min(s.radius || 0, s.w / 2, s.h / 2));
      o.fill();
    }
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(off, 0, 0);
    c.restore();
    // thin outline so the focus area reads clearly
    c.save();
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.lineWidth = 1;
    for (const s of spots) {
      if (s.w < 1 || s.h < 1) continue;
      c.beginPath();
      c.roundRect(s.x, s.y, s.w, s.h, Math.min(s.radius || 0, s.w / 2, s.h / 2));
      c.stroke();
    }
    c.restore();
  }

  function visibleAnnos() {
    if (S.editing && S.editing.field === 'label') {
      const ed = S.editing.a;
      const list = S.annos.map((a) => (a.id === ed.id ? { ...ed, label: '' } : a));
      return S.draft ? [...list, S.draft] : list;
    }
    const hide = S.editing && !S.editing.isNew ? S.editing.a.id : null;
    const list = hide == null ? S.annos : S.annos.filter((a) => a.id !== hide);
    return S.draft ? [...list, S.draft] : list;
  }

  // ------------------------------------------------------------ screen render
  let raf = 0;
  function requestRender() {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); });
  }

  function render() {
    if (!bmp) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bmp, 0, 0, W, H);
    const s = S.sel;
    const has = s && s.w > 0 && s.h > 0;
    if (has) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(s.x, s.y, s.w, s.h);
      ctx.clip();
      drawAnnos(ctx, visibleAnnos());
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    if (has) ctx.rect(s.x, s.y, s.w, s.h);
    ctx.fill('evenodd');
    if (S.phase === 'idle') drawCrosshair();
    if (has) drawFrame(s);
    const a = selectedAnno();
    if (canEditSelected(a) && !S.editing) drawAnnoBox(a);
    if (showLoupe()) drawLoupe();
    updateBadge();
  }

  function drawCrosshair() {
    const { x, y } = S.mouse;
    if (x < 0) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(10,132,255,0.75)';
    ctx.lineWidth = 1 / DPR;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5 / DPR); ctx.lineTo(W, y + 0.5 / DPR);
    ctx.moveTo(x + 0.5 / DPR, 0); ctx.lineTo(x + 0.5 / DPR, H);
    ctx.stroke();
    ctx.restore();
  }

  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  function handlePos(s, h) {
    const x = h.includes('w') ? s.x : h.includes('e') ? s.x + s.w : s.x + s.w / 2;
    const y = h.includes('n') ? s.y : h.includes('s') ? s.y + s.h : s.y + s.h / 2;
    return { x, y };
  }

  function drawFrame(s) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeRect(s.x - 0.5, s.y - 0.5, s.w + 1, s.h + 1);
    ctx.strokeStyle = '#fff';
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(s.x - 0.5, s.y - 0.5, s.w + 1, s.h + 1);
    ctx.setLineDash([]);
    if (S.phase === 'edit') {
      for (const h of HANDLES) {
        const p = handlePos(s, h);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgba(10,132,255,1)';
        ctx.beginPath();
        ctx.rect(p.x - 3.5, p.y - 3.5, 7, 7);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawAnnoBox(a) {
    const kind = handleKind(a);
    ctx.save();
    ctx.strokeStyle = '#0A84FF';
    ctx.lineWidth = 1;
    if (kind !== 'line') {
      const b = kind === 'box' ? { x: a.x, y: a.y, w: a.w, h: a.h } : bbox(a);
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(b.x - 0.5, b.y - 0.5, b.w + 1, b.h + 1);
      ctx.setLineDash([]);
    }
    for (const h of annoHandles(a)) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      if (kind === 'line') ctx.arc(h.x, h.y, 4.5, 0, Math.PI * 2);
      else ctx.rect(h.x - 3.5, h.y - 3.5, 7, 7);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- editing existing shapes: which handles a shape has, and resizing
  function canEditSelected(a) {
    if (!a || S.phase !== 'edit') return false;
    return !S.tool || (LABELED.includes(S.tool) && a.type === S.tool);
  }

  function handleKind(a) {
    if (['rect', 'ellipse', 'blur', 'spotlight'].includes(a.type)) return 'box';
    if (['line', 'arrow', 'measure'].includes(a.type)) return 'line';
    if (['text', 'number', 'pointer'].includes(a.type)) return 'scale';
    return 'none';
  }

  const OPP = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' };
  function cornerOf(b, h) {
    return { x: h.includes('w') ? b.x : b.x + b.w, y: h.includes('n') ? b.y : b.y + b.h };
  }

  function annoHandles(a) {
    const kind = handleKind(a);
    if (kind === 'line') return [{ id: 'p1', x: a.x1, y: a.y1 }, { id: 'p2', x: a.x2, y: a.y2 }];
    if (kind === 'box') return HANDLES.map((h) => ({ id: h, ...handlePos({ x: a.x, y: a.y, w: a.w, h: a.h }, h) }));
    if (kind === 'scale') {
      const b = bbox(a);
      return ['nw', 'ne', 'se', 'sw'].map((h) => ({ id: h, ...cornerOf(b, h) }));
    }
    return [];
  }

  function annoHandleAt(p) {
    const a = selectedAnno();
    if (!canEditSelected(a) || S.editing) return null;
    for (const h of annoHandles(a)) if (Math.abs(p.x - h.x) <= 6 && Math.abs(p.y - h.y) <= 6) return h.id;
    return null;
  }

  function resizeAnno(a, st, h, p0, p, e) {
    const dx = p.x - p0.x, dy = p.y - p0.y;
    const kind = handleKind(a);
    if (kind === 'line') {
      const [fx, fy, mx, my] = h === 'p1' ? ['x2', 'y2', 'x1', 'y1'] : ['x1', 'y1', 'x2', 'y2'];
      let x = st[mx] + dx, y = st[my] + dy;
      if (e.shiftKey) [x, y] = snap45(st[fx], st[fy], x, y);
      a[mx] = x; a[my] = y;
    } else if (kind === 'box') {
      let x0 = st.x, y0 = st.y, x1 = st.x + st.w, y1 = st.y + st.h;
      if (h.includes('w')) x0 += dx;
      if (h.includes('e')) x1 += dx;
      if (h.includes('n')) y0 += dy;
      if (h.includes('s')) y1 += dy;
      if (e.shiftKey && h.length === 2) { // keep aspect ratio
        const ratio = st.w / Math.max(1, st.h);
        const w = Math.abs(x1 - x0), hh = w / ratio;
        if (h.includes('n')) y0 = y1 - hh * Math.sign(y1 - y0 || 1); else y1 = y0 + hh * Math.sign(y1 - y0 || 1);
      }
      Object.assign(a, normRect(x0, y0, x1, y1));
    } else if (kind === 'scale') {
      const b0 = bbox(st);
      const anchor = cornerOf(b0, OPP[h]);
      const c0 = cornerOf(b0, h);
      const d0 = Math.hypot(c0.x - anchor.x, c0.y - anchor.y) || 1;
      const d1 = Math.hypot(c0.x + dx - anchor.x, c0.y + dy - anchor.y);
      const min = a.type === 'pointer' ? 8 : 6;
      a.size = clamp(Math.round(st.size * (d1 / d0) * 2) / 2, min, 400);
      a.x = st.x; a.y = st.y;
      const b1 = bbox(a);
      const anchor1 = cornerOf(b1, OPP[h]);
      a.x += anchor.x - anchor1.x;
      a.y += anchor.y - anchor1.y;
    }
  }

  function showLoupe() {
    if (S.mouse.x < 0) return false;
    if (S.phase === 'idle' || S.phase === 'selecting') return true;
    if (S.drag && S.drag.kind === 'resize') return true;
    return S.tool === 'eyedropper' && inRect(S.mouse, S.sel);
  }

  function drawLoupe() {
    const { x, y } = S.mouse;
    const N = 15, Z = 8, size = N * Z, info = 40;
    let lx = x + 22, ly = y + 22;
    if (lx + size + 4 > W) lx = x - 22 - size;
    if (ly + size + info + 8 > H) ly = y - 22 - size - info;
    const px = Math.floor(x * K), py = Math.floor(y * K);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.roundRect(lx, ly, size, size, 8);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bmp, px - (N >> 1), py - (N >> 1), N, N, lx, ly, size, size);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < N; i++) {
      ctx.moveTo(lx + i * Z, ly); ctx.lineTo(lx + i * Z, ly + size);
      ctx.moveTo(lx, ly + i * Z); ctx.lineTo(lx + size, ly + i * Z);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(10,132,255,0.18)';
    ctx.fillRect(lx + (N >> 1) * Z, ly, Z, size);
    ctx.fillRect(lx, ly + (N >> 1) * Z, size, Z);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#000';
    ctx.strokeRect(lx + (N >> 1) * Z, ly + (N >> 1) * Z, Z, Z);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(lx + (N >> 1) * Z + 1, ly + (N >> 1) * Z + 1, Z - 2, Z - 2);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(lx + 0.5, ly + 0.5, size - 1, size - 1, 8);
    ctx.stroke();
    const c = colorAt(S.mouse);
    ctx.fillStyle = 'rgba(18,18,20,0.94)';
    ctx.beginPath();
    ctx.roundRect(lx, ly + size + 6, size, info, 7);
    ctx.fill();
    ctx.fillStyle = c.hex;
    ctx.beginPath();
    ctx.roundRect(lx + 8, ly + size + 14, 14, 14, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.hex, lx + 28, ly + size + 21);
    ctx.fillStyle = '#9a9aa2';
    ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillText(`${px}, ${py} px`, lx + 8, ly + size + 37);
    ctx.textAlign = 'right';
    ctx.fillText('C', lx + size - 8, ly + size + 21);
    ctx.restore();
  }

  // ------------------------------------------------------------ undo
  function pushUndo() {
    S.undo.push(JSON.stringify(S.annos));
    if (S.undo.length > 200) S.undo.shift();
    S.redo = [];
    syncTools();
  }
  function undo() {
    commitText();
    if (!S.undo.length) return;
    S.redo.push(JSON.stringify(S.annos));
    S.annos = JSON.parse(S.undo.pop());
    S.selectedId = null;
    syncTools(); buildOpts(); render();
  }
  function redo() {
    if (!S.redo.length) return;
    S.undo.push(JSON.stringify(S.annos));
    S.annos = JSON.parse(S.redo.pop());
    S.selectedId = null;
    syncTools(); buildOpts(); render();
  }

  // ------------------------------------------------------------ selection hit-testing
  function handleAt(p) {
    const s = S.sel;
    if (!s || S.phase !== 'edit') return null;
    for (const h of HANDLES) {
      const hp = handlePos(s, h);
      if (Math.abs(p.x - hp.x) <= 7 && Math.abs(p.y - hp.y) <= 7) return h;
    }
    if (S.tool) return null; // edges only grab when not drawing
    const e = 4;
    const inY = p.y > s.y && p.y < s.y + s.h, inX = p.x > s.x && p.x < s.x + s.w;
    if (inY && Math.abs(p.x - s.x) <= e) return 'w';
    if (inY && Math.abs(p.x - (s.x + s.w)) <= e) return 'e';
    if (inX && Math.abs(p.y - s.y) <= e) return 'n';
    if (inX && Math.abs(p.y - (s.y + s.h)) <= e) return 's';
    return null;
  }

  const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
  function updateCursor(p) {
    let c = 'crosshair';
    if (S.phase === 'edit') {
      const ah = annoHandleAt(p);
      const h = handleAt(p);
      if (ah) c = ah === 'p1' || ah === 'p2' ? 'move' : CURSORS[ah];
      else if (h) c = CURSORS[h];
      else if (LABELED.includes(S.tool) && S.annos.some((a) => a.type === S.tool && hit(a, p))) c = 'move';
      else if (!S.tool) c = annoAt(p) ? 'move' : inRect(p, S.sel) ? 'move' : 'crosshair';
      else if (S.tool === 'text') c = inRect(p, S.sel) ? 'text' : 'default';
      else c = inRect(p, S.sel) ? 'crosshair' : 'default';
    }
    if (canvas.style.cursor !== c) canvas.style.cursor = c;
  }

  // ------------------------------------------------------------ pointer input
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    if (!bmp || busy) return;
    if (e.button === 2) return onRightClick();
    if (e.button !== 0) return;
    e.preventDefault(); // keep focus where it is (text editor)
    if (S.editing) {
      const passThrough = S.editing.field === 'label' || !elText.value.trim();
      commitText();
      if (!passThrough) return;
    }
    canvas.setPointerCapture(e.pointerId);
    const p = pt(e);
    S.mouse = p;
    if (S.phase === 'idle') return startNewSelection(p);
    if (S.phase !== 'edit') return;
    const ah = annoHandleAt(p);
    if (ah) {
      const a = selectedAnno();
      S.drag = { kind: 'annoresize', id: a.id, h: ah, start: JSON.parse(JSON.stringify(a)), p0: p, moved: false };
      return;
    }
    const h = handleAt(p);
    if (h) {
      S.drag = { kind: 'resize', h, start: { ...S.sel }, p0: p };
      document.body.classList.add('dragging');
      return;
    }
    const inside = inRect(p, S.sel);
    if (!S.tool) {
      const a = annoAt(p);
      if (a) {
        S.selectedId = a.id;
        loadPrefsFrom(a);
        buildOpts();
        S.drag = { kind: 'moveanno', id: a.id, last: p, moved: false };
        render();
        return;
      }
      if (S.selectedId != null) { S.selectedId = null; buildOpts(); }
      if (inside) {
        S.drag = { kind: 'movesel', last: p };
        document.body.classList.add('dragging');
        return;
      }
      return startNewSelection(p);
    }
    if (!inside) return;
    startDraw(S.tool, p, e);
  });

  function startNewSelection(p) {
    S.drag = { kind: 'newsel', ox: p.x, oy: p.y, prev: S.sel ? { ...S.sel } : null, prevPhase: S.phase };
    S.phase = 'selecting';
    S.sel = { x: p.x, y: p.y, w: 0, h: 0 };
    layout();
    render();
  }

  function loadPrefsFrom(a) {
    if (a.color && a.type !== 'blur' && a.type !== 'spotlight') S.prefs.color = a.color;
    if (a.width != null && !['text', 'number', 'pointer', 'measure'].includes(a.type)) S.prefs.width = a.width;
    if (SIZEKEY[a.type]) S.prefs[SIZEKEY[a.type]] = a.size;
    if (a.fill != null) S.prefs.fill = a.fill;
    if (a.type === 'rect' || a.type === 'spotlight') S.prefs.radius = a.radius;
    if (a.type === 'blur') S.prefs.blurStyle = a.style;
    if (a.type === 'pointer') S.prefs.pointerStyle = a.style;
    if (a.type === 'number' || a.type === 'pointer') S.prefs.labelBg = a.labelBg !== false;
  }

  window.addEventListener('pointermove', (e) => {
    if (!bmp) return;
    const p = pt(e);
    const prev = S.mouse;
    S.mouse = p;
    const d = S.drag;
    if (!d) {
      updateCursor(p);
      if (showLoupe() || S.phase === 'idle' || (S.tool === 'eyedropper')) requestRender();
      return;
    }
    if (d.kind === 'newsel') {
      if (S.space) { d.ox += p.x - prev.x; d.oy += p.y - prev.y; }
      let x0 = d.ox, y0 = d.oy, x1 = p.x, y1 = p.y;
      if (e.shiftKey) {
        const m = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        x1 = x0 + Math.sign(x1 - x0 || 1) * m;
        y1 = y0 + Math.sign(y1 - y0 || 1) * m;
      }
      if (e.altKey) { x0 = 2 * d.ox - x1; y0 = 2 * d.oy - y1; }
      const r = normRect(clamp(x0, 0, W), clamp(y0, 0, H), clamp(x1, 0, W), clamp(y1, 0, H));
      S.sel = r;
    } else if (d.kind === 'movesel') {
      const s = S.sel;
      s.x = clamp(s.x + (p.x - d.last.x), 0, W - s.w);
      s.y = clamp(s.y + (p.y - d.last.y), 0, H - s.h);
      d.last = p;
    } else if (d.kind === 'resize') {
      const st = d.start, dx = p.x - d.p0.x, dy = p.y - d.p0.y;
      let x0 = st.x, y0 = st.y, x1 = st.x + st.w, y1 = st.y + st.h;
      if (d.h.includes('w')) x0 += dx;
      if (d.h.includes('e')) x1 += dx;
      if (d.h.includes('n')) y0 += dy;
      if (d.h.includes('s')) y1 += dy;
      S.sel = normRect(clamp(x0, 0, W), clamp(y0, 0, H), clamp(x1, 0, W), clamp(y1, 0, H));
    } else if (d.kind === 'moveanno') {
      const a = S.annos.find((x) => x.id === d.id);
      if (a) {
        if (!d.moved) { pushUndo(); d.moved = true; document.body.classList.add('dragging'); }
        moveAnno(a, p.x - d.last.x, p.y - d.last.y);
      }
      d.last = p;
    } else if (d.kind === 'annoresize') {
      const a = S.annos.find((x) => x.id === d.id);
      if (a) {
        if (!d.moved) { pushUndo(); d.moved = true; document.body.classList.add('dragging'); }
        resizeAnno(a, d.start, d.h, d.p0, p, e);
      }
    } else if (d.kind === 'draw') {
      updateDraw(p, e);
    }
    requestRender();
  });

  window.addEventListener('pointerup', (e) => {
    const d = S.drag;
    if (!d) return;
    S.drag = null;
    document.body.classList.remove('dragging');
    if (d.kind === 'newsel') {
      if (!S.sel || S.sel.w < 3 || S.sel.h < 3) {
        // a click: keep the previous selection if there was one, else grab the whole display
        S.sel = d.prev && d.prevPhase === 'edit' ? d.prev : { x: 0, y: 0, w: W, h: H };
      }
      S.phase = 'edit';
    } else if (d.kind === 'draw') {
      finishDraw();
    } else if (d.kind === 'moveanno' && !d.moved && d.editOnClick) {
      const a = S.annos.find((x) => x.id === d.id);
      if (a && d.wasSelected) (a.type === 'text' ? openTextEditor(a, false) : openLabelEditor(a));
    } else if (d.kind === 'annoresize' && d.moved) {
      const a = S.annos.find((x) => x.id === d.id);
      if (a) loadPrefsFrom(a);
      buildOpts(); // reflect the new size in the slider
    }
    updateCursor(pt(e));
    layout();
    render();
  });

  canvas.addEventListener('dblclick', (e) => {
    if (S.phase !== 'edit' || S.tool) return;
    const p = pt(e);
    const a = annoAt(p);
    if (a && a.type === 'text') { openTextEditor(a, false); return; }
    if (a && (a.type === 'number' || a.type === 'pointer')) { openLabelEditor(a); return; }
    if (!a && inRect(p, S.sel)) finish('copy');
  });

  function onRightClick() {
    if (S.editing) return commitText();
    if (S.phase === 'edit' && S.tool) return setTool(null);
    if (S.phase === 'edit') {
      S.phase = 'idle';
      S.sel = null;
      S.selectedId = null;
      layout();
      render();
      return;
    }
    api.cancel();
  }

  // ------------------------------------------------------------ drawing tools
  function nextNumber() {
    return S.annos.reduce((m, a) => (a.type === 'number' ? Math.max(m, a.n) : m), 0) + 1;
  }

  function startDraw(t, p, e) {
    const P = S.prefs;
    const base = { id: nextId++, color: P.color };
    if (t === 'eyedropper') {
      const c = colorAt(p);
      const val = e.shiftKey ? `rgb(${c.r}, ${c.g}, ${c.b})` : c.hex;
      api.copyText(val);
      setPref('color', c.hex);
      buildOpts();
      toast(`Copied ${val}`);
      return;
    }
    if (t === 'text') {
      const hitText = S.annos.slice().reverse().find((a) => a.type === 'text' && hit(a, p));
      if (hitText) {
        // click = select (2nd click edits), drag = move
        const wasSelected = S.selectedId === hitText.id;
        S.selectedId = hitText.id;
        loadPrefsFrom(hitText);
        buildOpts();
        S.drag = { kind: 'moveanno', id: hitText.id, last: p, moved: false, editOnClick: true, wasSelected };
        render();
        return;
      }
      if (S.selectedId != null) { S.selectedId = null; buildOpts(); }
      openTextEditor({ ...base, type: 'text', x: p.x, y: p.y - P.fontSize * 0.6, text: '', size: P.fontSize, fill: !!P.fill }, true);
      return;
    }
    if (t === 'number' || t === 'pointer') {
      const hitA = S.annos.slice().reverse().find((a) => a.type === t && hit(a, p));
      if (hitA) { // click = select (2nd click edits its label), drag = move
        const wasSelected = S.selectedId === hitA.id;
        S.selectedId = hitA.id;
        loadPrefsFrom(hitA);
        buildOpts();
        S.drag = { kind: 'moveanno', id: hitA.id, last: p, moved: false, editOnClick: true, wasSelected };
        render();
        return;
      }
      pushUndo();
      const a = t === 'number'
        ? { ...base, type: 'number', x: p.x, y: p.y, n: nextNumber(), size: P.numberSize || SIZEDEF.numberSize, labelBg: P.labelBg !== false }
        : { ...base, type: 'pointer', x: p.x, y: p.y, size: P.pointerSize || SIZEDEF.pointerSize, style: P.pointerStyle, labelBg: P.labelBg !== false };
      S.annos.push(a);
      S.selectedId = a.id;
      buildOpts();
      if (P.autoLabel !== false) openLabelEditor(a);
      render();
      return;
    }
    let a;
    if (t === 'pen' || t === 'marker') a = { ...base, type: t, pts: [[p.x, p.y]], width: P.width };
    else if (t === 'line' || t === 'arrow' || t === 'measure') a = { ...base, type: t, x1: p.x, y1: p.y, x2: p.x, y2: p.y, width: P.width };
    else a = { ...base, type: t, x: p.x, y: p.y, w: 0, h: 0, width: P.width, fill: !!P.fill, radius: P.radius, style: P.blurStyle };
    S.draft = a;
    S.drag = { kind: 'draw', ox: p.x, oy: p.y };
    document.body.classList.add('dragging');
  }

  function snap45(x0, y0, x1, y1) {
    const ang = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(x1 - x0, y1 - y0);
    return [x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len];
  }

  function updateDraw(p, e) {
    const a = S.draft, d = S.drag;
    if (!a) return;
    if (a.pts) {
      if (e.shiftKey) { a.pts = [a.pts[0], [p.x, p.y]]; return; }
      const last = a.pts[a.pts.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) >= 0.75) a.pts.push([p.x, p.y]);
    } else if (a.x1 !== undefined) {
      let x = p.x, y = p.y;
      if (e.shiftKey) [x, y] = snap45(a.x1, a.y1, x, y);
      a.x2 = x; a.y2 = y;
    } else {
      let x0 = d.ox, y0 = d.oy, x1 = p.x, y1 = p.y;
      if (e.shiftKey) {
        const m = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        x1 = x0 + Math.sign(x1 - x0 || 1) * m;
        y1 = y0 + Math.sign(y1 - y0 || 1) * m;
      }
      if (e.altKey) { x0 = 2 * d.ox - x1; y0 = 2 * d.oy - y1; }
      Object.assign(a, normRect(x0, y0, x1, y1));
    }
  }

  function finishDraw() {
    const a = S.draft;
    S.draft = null;
    if (!a) return;
    if (a.x1 !== undefined && Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 2) return render();
    if (a.w !== undefined && (a.w < 2 || a.h < 2)) return render();
    pushUndo();
    S.annos.push(a);
    render();
  }

  // ------------------------------------------------------------ text editing
  function openTextEditor(a, isNew) {
    commitText();
    S.editing = { a: { ...a }, isNew };
    S.selectedId = isNew ? null : a.id;
    elText.value = a.text || '';
    elText.hidden = false;
    styleEditor();
    buildOpts();
    render();
    setTimeout(() => elText.focus(), 0);
  }

  function openLabelEditor(a) {
    commitText();
    S.editing = { a: { ...a }, isNew: false, field: 'label' };
    S.selectedId = a.id;
    elText.value = a.label || '';
    elText.hidden = false;
    styleEditor();
    buildOpts();
    render();
    setTimeout(() => elText.focus(), 0);
  }

  // the text-like object the editor is showing (a text annotation, or a number/pointer label)
  function editorAnno() {
    const ed = S.editing;
    return ed.field === 'label' ? labelInfo(ed.a, elText.value) : { ...ed.a, text: elText.value };
  }

  function styleEditor() {
    if (!S.editing) return;
    const a = editorAnno();
    const m = textMetrics({ ...a, text: a.text || ' ' });
    elText.style.font = textFont(a.size);
    elText.style.lineHeight = '1.25';
    elText.style.color = a.fill ? contrast(a.color) : a.color;
    elText.style.background = a.fill ? a.color : 'transparent';
    elText.style.padding = a.fill ? `${m.pad * 0.6}px ${m.pad}px` : '0';
    elText.style.left = `${a.x - m.pad - 1}px`;
    elText.style.top = `${a.y - m.pad * 0.6 - 1}px`;
    autosizeText();
  }

  function autosizeText() {
    if (!S.editing) return;
    const a = { ...editorAnno(), text: elText.value || ' ' };
    const m = textMetrics(a);
    elText.style.width = `${m.w + m.pad * 2 + a.size * 0.6 + 2}px`;
    elText.style.height = `${m.h + m.pad * 1.2 + 2}px`;
  }

  function commitText() {
    const ed = S.editing;
    if (!ed) return;
    S.editing = null;
    const text = elText.value.replace(/\s+$/, '');
    elText.hidden = true;
    elText.blur();
    S.selectedId = null;
    if (ed.field === 'label') {
      const idx = S.annos.findIndex((x) => x.id === ed.a.id);
      if (idx >= 0) {
        const cur = S.annos[idx];
        const next = { ...cur, color: ed.a.color, size: ed.a.size, labelBg: ed.a.labelBg };
        if (text) next.label = text; else delete next.label;
        if (JSON.stringify(next) !== JSON.stringify(cur)) { pushUndo(); S.annos[idx] = next; }
        S.selectedId = cur.id;
      }
      buildOpts();
      render();
      return;
    }
    if (ed.isNew) {
      if (text) { pushUndo(); S.annos.push({ ...ed.a, text }); S.selectedId = ed.a.id; }
    } else {
      const idx = S.annos.findIndex((x) => x.id === ed.a.id);
      if (idx >= 0) {
        const cur = S.annos[idx];
        const next = { ...cur, text, color: ed.a.color, size: ed.a.size, fill: ed.a.fill };
        if (JSON.stringify(next) !== JSON.stringify(cur)) {
          pushUndo();
          if (text) S.annos[idx] = next; else S.annos.splice(idx, 1);
        }
        if (text) S.selectedId = cur.id;
      }
    }
    buildOpts();
    render();
  }

  elText.addEventListener('input', autosizeText);
  elText.addEventListener('pointerdown', (e) => e.stopPropagation());
  elText.addEventListener('blur', () => setTimeout(commitText, 0));
  elText.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (e.key === 'Escape' || (e.key === 'Enter' && mod)) { e.preventDefault(); commitText(); return; }
    if (!mod) return;
    const k = e.key.toLowerCase();
    const hasSel = elText.selectionStart !== elText.selectionEnd;
    if (k === 's') { e.preventDefault(); commitText(); finish(e.shiftKey ? 'quicksave' : 'save'); }
    else if (k === 'c' && !hasSel) { e.preventDefault(); commitText(); finish('copy'); }
    else if (k === 'p') { e.preventDefault(); commitText(); finish('pin'); }
  });

  // ------------------------------------------------------------ actions
  function deleteSelected() {
    const a = selectedAnno();
    if (!a) return;
    pushUndo();
    S.annos = S.annos.filter((x) => x.id !== a.id);
    S.selectedId = null;
    buildOpts();
    render();
  }

  function cut() {
    const a = selectedAnno();
    if (a) {
      S.clip = JSON.parse(JSON.stringify(a));
      deleteSelected();
      toast('Shape cut — paste with ' + MODK + 'V');
      return;
    }
    finish('copy');
  }

  function paste() {
    if (!S.clip) return;
    pushUndo();
    const a = JSON.parse(JSON.stringify(S.clip));
    a.id = nextId++;
    moveAnno(a, 12, 12);
    S.clip = JSON.parse(JSON.stringify(a));
    S.annos.push(a);
    S.selectedId = a.id;
    S.tool = null;
    syncTools(); buildOpts(); render();
  }

  function duplicate() {
    const a = selectedAnno();
    if (!a) return;
    S.clip = JSON.parse(JSON.stringify(a));
    paste();
  }

  async function exportPNG() {
    const s = S.sel;
    const scale = S.prefs.exportScale === '1x' ? 1 : K;
    const cw = Math.max(1, Math.round(s.w * scale));
    const ch = Math.max(1, Math.round(s.h * scale));
    const off = new OffscreenCanvas(cw, ch);
    const c = off.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.setTransform(scale, 0, 0, scale, -s.x * scale, -s.y * scale);
    c.drawImage(bmp, s.x * K, s.y * K, s.w * K, s.h * K, s.x, s.y, s.w, s.h);
    c.save();
    c.beginPath();
    c.rect(s.x, s.y, s.w, s.h);
    c.clip();
    drawAnnos(c, S.annos);
    c.restore();
    const blob = await off.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function finish(action) {
    if (busy || !S.sel || S.sel.w < 1 || S.sel.h < 1) return;
    commitText();
    busy = true;
    try {
      const png = await exportPNG();
      const res = await api.finish({ action, png, rect: { ...S.sel } });
      if (res && res.canceled) layout();
    } catch (err) {
      toast(`Failed: ${err.message || err}`);
    } finally {
      busy = false;
    }
  }

  // ------------------------------------------------------------ keyboard
  window.addEventListener('keydown', (e) => {
    if (!bmp || S.editing) return;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === ' ') { S.space = true; e.preventDefault(); return; }
    if (k === 'Escape') { e.preventDefault(); api.cancel(); return; }

    if (!mod && k === 'c' && S.phase !== 'selecting') {
      const c = colorAt(S.mouse);
      const val = e.shiftKey ? `rgb(${c.r}, ${c.g}, ${c.b})` : c.hex;
      api.copyText(val);
      toast(`Copied ${val}`);
      return;
    }

    if (S.phase !== 'edit') {
      if (mod && k === 'a') { S.sel = { x: 0, y: 0, w: W, h: H }; S.phase = 'edit'; layout(); render(); }
      return;
    }

    if (mod) {
      e.preventDefault();
      if (k === 'c') return finish('copy');
      if (k === 's') return finish(e.shiftKey ? 'quicksave' : 'save');
      if (k === 'x') return cut();
      if (k === 'v') return paste();
      if (k === 'd') return duplicate();
      if (k === 'z') return e.shiftKey ? redo() : undo();
      if (k === 'y') return redo();
      if (k === 'p') return finish('pin');
      if (k === 'a') { S.sel = { x: 0, y: 0, w: W, h: H }; layout(); render(); }
      if (k === 'w') api.cancel();
      return;
    }

    if (k === 'Enter') return finish('copy');
    if (k === 'Delete' || k === 'Backspace') return deleteSelected();

    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[k]) {
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) / K; // 1 physical px per tap
      const [dx, dy] = arrows[k].map((v) => v * step);
      const a = selectedAnno();
      if (a) { pushUndo(); moveAnno(a, dx, dy); } else if (e.altKey) {
        S.sel.w = clamp(S.sel.w + dx, 1, W - S.sel.x);
        S.sel.h = clamp(S.sel.h + dy, 1, H - S.sel.y);
      } else {
        S.sel.x = clamp(S.sel.x + dx, 0, W - S.sel.w);
        S.sel.y = clamp(S.sel.y + dy, 0, H - S.sel.h);
      }
      layout();
      render();
      return;
    }

    const t = TOOLS.find((x) => x !== '|' && x.key === k);
    if (t) {
      if (t.id === null) setTool(null);
      else if (S.tool !== t.id) setTool(t.id);
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') S.space = false;
  });

  window.addEventListener('blur', () => { S.space = false; });
})();
