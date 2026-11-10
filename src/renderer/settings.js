(async () => {
  const api = window.snap;
  const $ = (id) => document.getElementById(id);
  const status = $('status');
  let { settings: S, platform } = await api.getSettings();
  const isMac = platform === 'darwin';

  const PRETTY = isMac
    ? { Command: '⌘', Control: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', CommandOrControl: '⌘' }
    : { Control: 'Ctrl', CommandOrControl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Super: 'Win' };
  const pretty = (acc) => (acc ? acc.split('+').map((p) => PRETTY[p] || p).join(isMac ? '' : ' + ') : 'None');

  function say(msg, err = false) {
    status.textContent = msg;
    status.className = err ? 'err' : '';
    clearTimeout(say.t);
    say.t = setTimeout(() => { status.textContent = ''; }, 3500);
  }

  async function update(patch) {
    const r = await api.setSettings(patch);
    S = r.settings;
    paint();
    if (r.failed && r.failed.length) say(`Couldn't register ${r.failed.map(pretty).join(', ')} — it may be used by another app.`, true);
    else say('Saved');
  }

  function paint() {
    $('hotkey').value = pretty(S.hotkey);
    $('altHotkey').value = pretty(S.altHotkey);
    $('saveDir').textContent = S.saveDir;
    $('saveDir').title = S.saveDir;
    $('filenamePattern').value = S.filenamePattern;
    $('format').value = S.format;
    $('exportScale').value = S.exportScale;
    $('autoSaveCopy').checked = !!S.autoSaveCopy;
    $('launchAtLogin').checked = !!S.launchAtLogin;
  }

  // ---- hotkey recorder
  const KEYMAP = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc', Enter: 'Return', '+': 'Plus' };
  function keyName(e) {
    if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
    if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
    if (/^F\d{1,2}$/.test(e.key)) return e.key;
    if (e.key === 'PrintScreen' || e.code === 'PrintScreen') return 'PrintScreen';
    if (KEYMAP[e.key]) return KEYMAP[e.key];
    if (['Meta', 'Control', 'Alt', 'Shift', 'OS'].includes(e.key)) return null;
    if (e.key.length === 1) return e.key.toUpperCase();
    return e.key;
  }

  for (const id of ['hotkey', 'altHotkey']) {
    const el = $(id);
    el.addEventListener('focus', () => { el.classList.add('rec'); el.value = 'Press keys…'; api.suspendHotkeys(true); });
    el.addEventListener('blur', () => { el.classList.remove('rec'); api.suspendHotkeys(false); paint(); });
    el.addEventListener('keydown', (e) => {
      e.preventDefault();
      if ((e.key === 'Backspace' || e.key === 'Delete') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        el.blur();
        update({ [id]: '' });
        return;
      }
      if (e.key === 'Escape') { el.blur(); return; }
      const key = keyName(e);
      if (!key) return;
      const mods = [];
      if (e.metaKey) mods.push(isMac ? 'Command' : 'Super');
      if (e.ctrlKey) mods.push('Control');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey) mods.push('Shift');
      const standalone = key === 'PrintScreen' || /^F\d{1,2}$/.test(key);
      if (!mods.length && !standalone) { el.value = 'Add a modifier'; return; }
      const acc = [...mods, key].join('+');
      el.blur();
      update({ [id]: acc });
    });
  }
  // PrintScreen often only fires keyup on Windows
  for (const id of ['hotkey', 'altHotkey']) {
    $(id).addEventListener('keyup', (e) => {
      if (e.key === 'PrintScreen' && document.activeElement === $(id)) {
        $(id).blur();
        update({ [id]: 'PrintScreen' });
      }
    });
  }

  $('choose').addEventListener('click', async () => {
    const d = await api.chooseDir();
    if (d) update({ saveDir: d });
  });
  $('open').addEventListener('click', () => api.openSaveDir());
  $('filenamePattern').addEventListener('change', (e) => update({ filenamePattern: e.target.value.trim() || 'Screenshot {YYYY}-{MM}-{DD} at {HH}.{mm}.{ss}' }));
  $('format').addEventListener('change', (e) => update({ format: e.target.value }));
  $('exportScale').addEventListener('change', (e) => update({ exportScale: e.target.value }));
  $('autoSaveCopy').addEventListener('change', (e) => update({ autoSaveCopy: e.target.checked }));
  $('launchAtLogin').addEventListener('change', (e) => update({ launchAtLogin: e.target.checked }));

  paint();
})();
