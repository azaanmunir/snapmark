// Floating "pinned" screenshot: drag to move, wheel/pinch to zoom, right-click for menu.
(() => {
  const api = window.snap;
  const isMac = api.platform === 'darwin';
  const img = document.getElementById('img');
  const hud = document.getElementById('hud');
  let drag = null;

  function show(msg) {
    hud.textContent = msg;
    hud.classList.add('show');
    clearTimeout(show.t);
    show.t = setTimeout(() => hud.classList.remove('show'), 1100);
  }

  api.onPinInit(({ png }) => {
    img.src = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
  });
  api.onPinZoomed((z) => {
    img.classList.toggle('pixelated', z >= 2);
    show(`${Math.round(z * 100)}%`);
  });
  api.onPinToast(show);

  window.addEventListener('focus', () => document.body.classList.add('focused'));
  window.addEventListener('blur', () => document.body.classList.remove('focused'));

  window.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.screenX, y: e.screenY };
    document.body.classList.add('dragging');
    document.body.setPointerCapture(e.pointerId);
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.screenX - drag.x, dy = e.screenY - drag.y;
    if (dx || dy) api.pinMove(dx, dy);
    drag = { x: e.screenX, y: e.screenY };
  });
  window.addEventListener('pointerup', () => { drag = null; document.body.classList.remove('dragging'); });
  window.addEventListener('dblclick', () => api.pinZoom(0));
  window.addEventListener('contextmenu', (e) => { e.preventDefault(); api.pinMenu(); });

  window.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.altKey) { api.pinOpacity(e.deltaY > 0 ? -0.05 : 0.05); return; }
    const f = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    api.pinZoom(f, e.clientX, e.clientY);
  }, { passive: false });

  const run = async (a) => { const msg = await api.pinAction(a); if (msg) show(msg); };

  window.addEventListener('keydown', (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'Escape' || (mod && k === 'w')) return run('close');
    if (mod && k === 'c') return run('copy');
    if (mod && k === 'x') return run('cut');
    if (mod && k === 's') return run(e.shiftKey ? 'quicksave' : 'save');
    if (k === '=' || k === '+') return api.pinZoom(1.25);
    if (k === '-') return api.pinZoom(0.8);
    if (k === '0') return api.pinZoom(0);
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[k]) {
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1;
      api.pinMove(arrows[k][0] * s, arrows[k][1] * s);
    }
  });
})();
