// sensor-window.js — RAF gauge/bar renderer for a sensor window (motion / gamepad /
// geo / battery). Extracted from wm.js (ADR: extract embedded renderers). Leaf: reads
// only globals (window.sensors, window.__ar_battery_last, navigator.getBattery) and
// draws into a canvas it owns. wm injects an onDispose callback so teardown joins the
// window's dispose accumulator without this module importing wm.
//
//   buildSensorWindow(win, body, opts, { onDispose })

export function buildSensorWindow(win, body, opts = {}, { onDispose } = {}) {
  const source = opts.source || 'motion'; // 'motion' | 'gamepad' | 'geo' | 'battery'
  body.style.cssText += 'flex-direction:column;padding:0;overflow:hidden;background:#0d0d1a;';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'flex:1;width:100%;min-height:0;display:block;';
  body.appendChild(canvas);

  new ResizeObserver(() => {
    canvas.width = canvas.offsetWidth * devicePixelRatio;
    canvas.height = canvas.offsetHeight * devicePixelRatio;
  }).observe(canvas);

  const dpr = () => devicePixelRatio;
  let rafId;

  function _gauge(ctx, cx, cy, r, value, min, max, label, color) {
    const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const startA = Math.PI * 0.75,
      endA = Math.PI * 2.25;
    const angle = startA + pct * (endA - startA);
    ctx.save();
    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = r * 0.22;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.78, startA, endA);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.78, startA, angle);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.round(r * 0.34)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(value.toFixed(value < 100 ? 1 : 0), cx, cy - r * 0.08);
    ctx.fillStyle = '#6c7086';
    ctx.font = `${Math.round(r * 0.22)}px sans-serif`;
    ctx.fillText(label, cx, cy + r * 0.35);
    ctx.restore();
  }

  function _bar(ctx, x, y, w, h, value, min, max, label, color) {
    const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y + h * (1 - pct), w, h * pct);
    ctx.fillStyle = '#6c7086';
    ctx.font = `${Math.round(h * 0.09)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + h + h * 0.12);
  }

  function draw() {
    rafId = requestAnimationFrame(draw);
    const W = canvas.width,
      H = canvas.height;
    if (!W || !H) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, W, H);

    const sensors = window.sensors;

    if (source === 'motion') {
      const m = sensors?.motion?.() ?? {
        ax: 0,
        ay: 0,
        az: 0,
        alpha: 0,
        beta: 0,
        gamma: 0,
        magnitude: 0,
      };
      const cols = ['#f38ba8', '#a6e3a1', '#89b4fa', '#fab387', '#cba6f7', '#f9e2af'];
      const fields = [
        { v: m.ax ?? 0, mn: -20, mx: 20, lbl: 'ax (m/s²)' },
        { v: m.ay ?? 0, mn: -20, mx: 20, lbl: 'ay (m/s²)' },
        { v: m.az ?? 0, mn: -20, mx: 20, lbl: 'az (m/s²)' },
        { v: m.alpha ?? 0, mn: 0, mx: 360, lbl: 'α (yaw)' },
        { v: m.beta ?? 0, mn: -180, mx: 180, lbl: 'β (pitch)' },
        { v: m.gamma ?? 0, mn: -90, mx: 90, lbl: 'γ (roll)' },
      ];
      const n = fields.length;
      const colW = W / n;
      const barW = colW * 0.5;
      const barH = H * 0.78;
      const barY = H * 0.06;
      fields.forEach(({ v, mn, mx, lbl }, i) => {
        _bar(
          ctx,
          colW * i + (colW - barW) / 2,
          barY,
          barW,
          barH,
          v,
          mn,
          mx,
          lbl,
          cols[i % cols.length],
        );
      });
    } else if (source === 'gamepad') {
      const pad = sensors?.gamepad?.(0) ?? {};
      const axes = [0, 1, 2, 3].map((i) => pad.axis?.(i) ?? 0);
      const btns = [0, 1, 2, 3].map((i) => pad.pressed?.(i) ?? false);
      const n = axes.length;
      const r = Math.min(W / (n * 2.4), H * 0.34);
      const cols = ['#89b4fa', '#a6e3a1', '#f38ba8', '#fab387'];
      axes.forEach((v, i) => {
        _gauge(ctx, (W * (i + 0.5)) / n, H * 0.42, r, v, -1, 1, `axis ${i}`, cols[i]);
      });
      btns.forEach((pressed, i) => {
        const bx = (W * (i + 0.5)) / n;
        ctx.beginPath();
        ctx.arc(bx, H * 0.82, r * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = pressed ? '#a6e3a1' : '#1e1e2e';
        ctx.fill();
        ctx.fillStyle = '#6c7086';
        ctx.font = `${Math.round(r * 0.22)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`btn${i}`, bx, H * 0.82);
      });
    } else if (source === 'geo') {
      const geo = sensors?.geo?.() ?? {};
      const lines = [
        `lat:  ${geo.lat?.toFixed(5) ?? '—'}`,
        `lon:  ${geo.lon?.toFixed(5) ?? '—'}`,
        `alt:  ${geo.altitude != null ? geo.altitude.toFixed(1) + ' m' : '—'}`,
        `spd:  ${geo.speed != null ? geo.speed.toFixed(1) + ' m/s' : '—'}`,
        `hdg:  ${geo.heading != null ? geo.heading.toFixed(0) + '°' : '—'}`,
        `acc:  ${geo.accuracy != null ? '±' + geo.accuracy.toFixed(0) + ' m' : '—'}`,
        !geo.ready ? '⟳ acquiring…' : geo.error ? `⚠ ${geo.error}` : '✓ ready',
      ];
      const fs = Math.min(H * 0.1, W * 0.06, 18 * dpr());
      ctx.fillStyle = '#cdd6f4';
      ctx.font = `${fs}px monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      lines.forEach((l, i) => ctx.fillText(l, W * 0.08, H * 0.1 + i * fs * 1.5));
    } else if (source === 'battery') {
      const bat = window.__ar_battery_last ?? {};
      const pct = bat.level ?? 0;
      const charging = bat.charging ?? false;
      const bw = W * 0.55,
        bh = H * 0.34;
      const bx = (W - bw) / 2,
        by = (H - bh) / 2;
      ctx.strokeStyle = '#cdd6f4';
      ctx.lineWidth = 2 * dpr();
      ctx.strokeRect(bx, by, bw, bh);
      const tipW = bw * 0.06,
        tipH = bh * 0.35;
      ctx.fillStyle = '#cdd6f4';
      ctx.fillRect(bx + bw, by + (bh - tipH) / 2, tipW, tipH);
      const fill = bw * pct;
      ctx.fillStyle = charging ? '#a6e3a1' : pct < 0.2 ? '#f38ba8' : '#89b4fa';
      ctx.fillRect(bx, by, fill, bh);
      const fs = Math.min(bh * 0.42, 18 * dpr());
      ctx.fillStyle = '#cdd6f4';
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(pct * 100)}%${charging ? ' ⚡' : ''}`, W / 2, H / 2);
      if (bat.timeToFull > 0) {
        ctx.font = `${fs * 0.55}px sans-serif`;
        ctx.fillText(`~${Math.round(bat.timeToFull / 60)} min to full`, W / 2, H / 2 + fs * 0.9);
      } else if (bat.timeToEmpty > 0 && bat.timeToEmpty !== Infinity) {
        ctx.font = `${fs * 0.55}px sans-serif`;
        ctx.fillText(`~${Math.round(bat.timeToEmpty / 60)} min left`, W / 2, H / 2 + fs * 0.9);
      }
    }
  }

  rafId = requestAnimationFrame(draw);
  onDispose?.(() => cancelAnimationFrame(rafId));

  // For battery: subscribe to bus event to cache latest reading for the RAF draw loop
  if (source === 'battery') {
    if (!navigator.getBattery) return;
    navigator
      .getBattery()
      .then((b) => {
        const update = () => {
          window.__ar_battery_last = {
            level: b.level,
            charging: b.charging,
            timeToFull: b.chargingTime,
            timeToEmpty: b.dischargingTime,
          };
        };
        update();
        b.addEventListener('levelchange', update);
        b.addEventListener('chargingchange', update);
        // Cleanup on window close
        onDispose?.(() => {
          b.removeEventListener('levelchange', update);
          b.removeEventListener('chargingchange', update);
        });
      })
      .catch(() => {});
  }
}
