// ── "New Sensor Monitor" toolbar dropdown ─────────────────────────────────────
// Extracted from app.js window.onload. Receives the shared onload ctx: { spawnOffset }.
export function initSensorDropdown(ctx) {
  const { spawnOffset } = ctx;
  const btn = document.getElementById('newSensorBtn');
  const drop = document.getElementById('sensorDropdown');
  if (!btn || !drop) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    drop.classList.toggle('open');
  });

  drop.addEventListener('click', (e) => {
    e.stopPropagation();
    const li = e.target.closest('li[data-source]');
    if (!li) return;
    const source = li.dataset.source;
    const titles = {
      motion: 'Motion Sensor',
      gamepad: 'Gamepad',
      geo: 'Geolocation',
      battery: 'Battery',
    };
    const desk = document.getElementById('desktop');
    const dw = desk.offsetWidth,
      dh = desk.offsetHeight;
    const offset = spawnOffset(8);
    window.wm.spawn(titles[source] ?? 'Sensor', {
      type: 'sensor',
      source,
      w: 280,
      h: 300,
      x: Math.round((dw - 280) / 2) + offset,
      y: Math.round((dh - 300) / 2) + offset,
    });
    drop.classList.remove('open');
  });

  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target)) drop.classList.remove('open');
  });

  // Probe sensor availability and hide items that have no real data.
  // DeviceMotionEvent exists on desktop but fires null values — detect by
  // listening to the first event or timing out after 600ms with no real data.
  const hideSensor = (source) => {
    const li = drop.querySelector(`li[data-source="${source}"]`);
    if (li) li.style.display = 'none';
    const visible = [...drop.querySelectorAll('li[data-source]')].filter(
      (l) => l.style.display !== 'none',
    );
    if (visible.length === 0) btn.style.display = 'none';
  };

  // Motion: probe first event; hide if all accelerometer values are null.
  if (!window.DeviceMotionEvent) {
    hideSensor('motion');
  } else {
    let probed = false;
    const onMotion = (e) => {
      if (probed) return;
      probed = true;
      window.removeEventListener('devicemotion', onMotion);
      const a = e.accelerationIncludingGravity;
      if (a == null || (a.x == null && a.y == null && a.z == null)) hideSensor('motion');
    };
    window.addEventListener('devicemotion', onMotion);
    setTimeout(() => {
      if (probed) return;
      probed = true;
      window.removeEventListener('devicemotion', onMotion);
      hideSensor('motion'); // never fired → no sensor
    }, 800);
  }

  // Battery: hide if API absent or promise rejects.
  if (!navigator.getBattery) {
    hideSensor('battery');
  } else {
    navigator.getBattery().catch(() => hideSensor('battery'));
  }
}
