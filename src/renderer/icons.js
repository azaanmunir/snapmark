// Inline SVG icons (24x24, stroke = currentColor). Shared by overlay + pin.
window.ICONS = {
  move: '<path d="M12 2v20M2 12h20"/><path d="m9 5 3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>',
  pen: '<path d="M21.17 6.81a2.82 2.82 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
  marker: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  line: '<path d="M5 19 19 5"/>',
  arrow: '<path d="M5 19 19 5"/><path d="M9 5h10v10"/>',
  rect: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/>',
  ellipse: '<circle cx="12" cy="12" r="8.5"/>',
  text: '<path d="M5 7V5h14v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
  number: '<circle cx="12" cy="12" r="9"/><path d="M10.5 9.5 12.5 8v8.5"/>',
  pointer: '<path d="M5.5 3.5v15.2l4-3.8 2.8 6.1 2.5-1.1-2.8-6h5.6z"/>',
  blur: '<rect x="4" y="4" width="4" height="4" rx=".5"/><rect x="12" y="4" width="4" height="4" rx=".5"/><rect x="8" y="8" width="4" height="4" rx=".5"/><rect x="16" y="8" width="4" height="4" rx=".5"/><rect x="4" y="12" width="4" height="4" rx=".5"/><rect x="12" y="12" width="4" height="4" rx=".5"/><rect x="8" y="16" width="4" height="4" rx=".5"/><rect x="16" y="16" width="4" height="4" rx=".5"/>',
  spotlight: '<circle cx="12" cy="12" r="3.5"/><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>',
  measure: '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2"/>',
  eyedropper: '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
  cut: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
  save: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  quicksave: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10v6M15 13l-3 3-3-3"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  fill: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 14 14 4M4 20 20 4M10 20 20 10" opacity=".7"/>',
};

window.icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${window.ICONS[name] || ''}</svg>`;
