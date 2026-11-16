// Update check: asks GitHub once a day whether a newer release exists, then offers the download.
// This is SnapMark's only network request. It sends nothing about the user (a plain GET of the public
// "latest release" page) and can be turned off in Settings ("Check for updates").
const { app, net, shell, dialog } = require('electron');
const settings = require('./settings');

const REPO = 'azaanmunir/snapmark';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const DAY = 24 * 60 * 60 * 1000;

let hooks = { log: () => {}, notify: () => {}, refreshTrayMenu: () => {} };
let available = null; // { version, url }
let checking = false;

// "v1.2.10" > "v1.2.9"; pre-release tags (1.0.0-beta) are ignored
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('-')[0].split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

async function check({ manual = false } = {}) {
  if (checking) return available;
  checking = true;
  try {
    const res = await net.fetch(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SnapMark-update-check' } });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const rel = await res.json();
    settings.save({ lastUpdateCheck: Date.now() });
    if (rel.draft || rel.prerelease || !rel.tag_name) return null;
    const version = rel.tag_name.replace(/^v/, '');
    hooks.log('update check', { current: app.getVersion(), latest: version });
    if (!newer(version, app.getVersion())) {
      available = null;
      hooks.refreshTrayMenu();
      if (manual) dialog.showMessageBox({ type: 'info', message: 'SnapMark is up to date', detail: `You have the latest version (${app.getVersion()}).` });
      return null;
    }
    available = { version, url: rel.html_url || `https://github.com/${REPO}/releases/latest` };
    settings.save({ latestVersion: version, latestUrl: available.url }); // keeps the tray item after a restart
    hooks.refreshTrayMenu();
    if (manual) offer();
    else if (settings.load().notifiedVersion !== version) {
      settings.save({ notifiedVersion: version });
      hooks.notify(`SnapMark ${version} is available`, 'Click to download it (also in the menu bar / tray menu).', offer);
    }
    return available;
  } catch (e) {
    hooks.log('update check failed', String(e && e.message ? e.message : e));
    if (manual) dialog.showMessageBox({ type: 'warning', message: 'Couldn’t check for updates', detail: 'Check your internet connection and try again.' });
    return null;
  } finally {
    checking = false;
  }
}

async function offer() {
  if (!available) return;
  const isMac = process.platform === 'darwin';
  const how = isMac
    ? 'Download the new .dmg and drag SnapMark into Applications (replace the old one).\n'
      + 'Installed with Homebrew? Run: brew upgrade --cask snapmark\n\n'
      + 'If captures come out blank afterwards: System Settings → Privacy & Security → Screen Recording, '
      + 'remove SnapMark with “−”, then add it again with “+”.'
    : 'Download “SnapMark Setup” and run it. It installs over the old version and keeps your settings.';
  if (isMac) app.focus({ steal: true });
  const r = await dialog.showMessageBox({
    type: 'info',
    message: `SnapMark ${available.version} is available`,
    detail: `You have ${app.getVersion()}.\n\n${how}`,
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (r.response === 0) shell.openExternal(/^https:\/\/github\.com\//.test(available.url) ? available.url : `https://github.com/${REPO}/releases/latest`);
}

function init(h) {
  hooks = { ...hooks, ...h };
  const s0 = settings.load();
  if (s0.latestVersion && newer(s0.latestVersion, app.getVersion())) available = { version: s0.latestVersion, url: s0.latestUrl };
  const tick = () => {
    const s = settings.load();
    if (s.checkUpdates === false) return;
    if (Date.now() - (s.lastUpdateCheck || 0) > DAY) check();
  };
  setTimeout(tick, 20 * 1000); // not at boot: keep startup quiet
  setInterval(tick, 3 * 60 * 60 * 1000);
}

module.exports = { init, check, offer, state: () => available };
