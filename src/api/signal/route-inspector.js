// route-inspector.js — Tier 2 live chain inspector (ADR 063).
//
// `route(...).inspect()` opens a WM window rendering THAT route's chain as role-tagged
// nodes with LIVE per-stage values and active-stage lighting, RAF-updated, read-only.
// The source of truth is the live route object (_src / _chain / _sinks / _taps) — not
// parsed text — because it is a runtime view (a scoped, per-chain sibling of the whole-
// graph signalGraph.show()). Per-stage values come from route._eval instrumentation,
// recorded only while the route is being inspected (route._inspecting). See ADR 063.

// Method op-name → role. Bridges (amplitude/brightness/motion/fft) fold into the source
// label, not _chain, so they surface as part of the 'source' node. Unknown ops → 'opaque'
// (rendered muted, still positioned + valued — honest about shape, not invisible).
const ROLE = {
  scale: 'transform',
  clamp: 'transform',
  norm: 'transform',
  invert: 'transform',
  get: 'transform',
  filter: 'transform',
  threshold: 'transform',
  gate: 'transform',
  smooth: 'transform',
  debounce: 'transform',
  strobe: 'transform',
  speed: 'transform',
  mask: 'transform',
  mix: 'combinator',
};
export const roleOf = (op) => ROLE[op] ?? 'opaque';

const ROLE_COLOR = {
  source: '#4fc3f7',
  transform: '#c792ea',
  combinator: '#ffb74d',
  sink: '#81c784',
  listener: '#9e9e9e',
  opaque: '#777',
};

export function fmtVal(v) {
  if (v === undefined || v === null) return '–';
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'object') return '▮'; // frame / payload object — no scalar
  return String(v).slice(0, 12);
}

function makeNode(role, label) {
  const el = document.createElement('div');
  el.className = 'ar-ri-node';
  el.style.cssText =
    'display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 10px;' +
    `border:1px solid ${ROLE_COLOR[role]};border-radius:6px;background:#1c1c28;min-width:54px;` +
    'transition:box-shadow .12s,background .12s;';
  if (role === 'opaque') el.style.opacity = '0.6';
  const name = document.createElement('div');
  name.textContent = label;
  name.style.cssText = `color:${ROLE_COLOR[role]};font-size:12px;font-weight:bold;`;
  const roleTag = document.createElement('div');
  roleTag.textContent = role;
  roleTag.style.cssText = 'color:#666;font-size:9px;text-transform:uppercase;letter-spacing:.5px;';
  const val = document.createElement('div');
  val.className = 'ar-ri-val';
  val.textContent = '–';
  val.style.cssText = 'color:#ddd;font-size:11px;font-family:monospace;';
  el.append(name, roleTag, val);
  return { el, val, role };
}

function arrow() {
  const a = document.createElement('div');
  a.textContent = '→';
  a.style.cssText = 'color:#555;align-self:center;';
  return a;
}

// Build the node row + return refs aligned to value sources. Each ref reads its live
// value/timestamp from the route each frame.
function buildFlow(route) {
  const flow = document.createElement('div');
  flow.style.cssText = 'display:flex;flex-wrap:wrap;align-items:stretch;gap:6px;';
  const refs = []; // { node, read: () => ({v, at}) }
  const now = () => performance.now();

  const srcNode = makeNode('source', route._src?.label ?? 'source');
  flow.append(srcNode.el);
  refs.push({ node: srcNode, read: () => ({ v: route._srcV, at: route._srcAt }) });

  route._chain.forEach((t) => {
    flow.append(arrow());
    const node = makeNode(roleOf(t.name), t.name);
    flow.append(node.el);
    refs.push({ node, read: () => ({ v: t._v, at: t._at }) });
  });

  for (const s of route._sinks) {
    if (s.label === 'inspect') continue; // the internal driver sink is not shown
    flow.append(arrow());
    const node = makeNode('sink', s.label ?? 'sink');
    flow.append(node.el);
    refs.push({ node, read: () => ({ v: route._outV, at: route._outAt }) });
  }

  return { flow, refs, now };
}

/**
 * Open the live inspector for a route. `ownsRoute` = inspect created the driver, so
 * closing the window tears the whole route down; otherwise it only stops inspecting.
 */
export function openRouteInspector(route, { title = 'Route', ownsRoute = false } = {}) {
  const winId = window.wm?.spawn?.(title, { w: 540, h: 150 }); // spawn returns the string id
  const win = winId && document.getElementById(winId);
  if (!win) {
    route._inspecting = false;
    return route;
  }
  const body = win.querySelector('.wm-body');
  body.style.cssText = 'background:#12121c;padding:12px;overflow:auto;';

  const banner = document.createElement('div');
  banner.style.cssText = 'color:#888;font-size:10px;font-family:monospace;margin-bottom:8px;';
  banner.textContent = 'live';
  body.append(banner);

  const { flow, refs, now } = buildFlow(route);
  body.append(flow);

  let raf = null;
  const tick = () => {
    if (route._destroyed) {
      banner.textContent = 'stopped';
      banner.style.color = '#e57373';
      raf = null;
      return; // freeze last values
    }
    const t = now();
    for (const { node, read } of refs) {
      const { v, at } = read();
      node.val.textContent = fmtVal(v);
      const active = at != null && t - at < 200;
      node.el.style.boxShadow = active ? `0 0 8px ${ROLE_COLOR[node.role]}` : 'none';
      node.el.style.background = active ? '#26263a' : '#1c1c28';
    }
    raf = requestAnimationFrame(tick);
  };
  tick();

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    route._inspecting = false;
    if (ownsRoute) route._destroy?.();
  };
  window.wm?.window?.(winId)?.onDispose?.(stop);
  return route;
}
