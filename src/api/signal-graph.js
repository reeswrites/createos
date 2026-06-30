import { onReset } from '../runtime/reset-registry.js';
import { getLiveRoutes } from './route.js';
import { forEachLive } from '../runtime/keep-alive.js';
// signal-graph.js — read-only overlay of signal-bus routing
// Sources: audio.fft, hold('sensor:*'), hold('window:mouse:move'), video.signal(), camera streams
// Sinks: ThreeScene, Shader, GLShader, pipe()
// Routes stored in window.__ar_signalRoutes (array of { source, sink, label })

const _SVG_NS = 'http://www.w3.org/2000/svg';

function _buildGraph(routes, liveNodes) {
  // Collect unique sources + sinks
  const sources = [...new Set(routes.map((r) => r.source))];
  const sinks = [...new Set(routes.map((r) => r.sink))];

  // Auto-add live nodes not yet in routes
  for (const label of liveNodes) {
    if (!sources.includes(label) && !sinks.includes(label)) sources.push(label);
  }

  const W = 560,
    H = Math.max(220, Math.max(sources.length, sinks.length) * 60 + 40);
  const srcX = 80,
    sinkX = 460;
  const srcStep = sources.length > 1 ? (H - 80) / (sources.length - 1) : 0;
  const sinkStep = sinks.length > 1 ? (H - 80) / (sinks.length - 1) : 0;
  const srcY = (i) => 40 + i * srcStep;
  const sinkY = (i) => 40 + i * sinkStep;

  const nodeW = 110,
    nodeH = 28;
  let svg = `<svg xmlns="${_SVG_NS}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
    style="font-family:monospace;font-size:11px;background:#1a1a2e;border-radius:8px;">
    <defs>
      <marker id="arr" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0,8 3,0 6" fill="#4fc3f7"/>
      </marker>
    </defs>`;

  // Draw edges first (behind nodes)
  for (const r of routes) {
    const si = sources.indexOf(r.source);
    const ki = sinks.indexOf(r.sink);
    if (si < 0 || ki < 0) continue;
    const x1 = srcX + nodeW / 2,
      y1 = srcY(si) + nodeH / 2;
    const x2 = sinkX - nodeW / 2,
      y2 = sinkY(ki) + nodeH / 2;
    const cx = (x1 + x2) / 2;
    svg += `<path d="M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}"
      fill="none" stroke="#4fc3f7" stroke-width="1.5" opacity="0.7"
      marker-end="url(#arr)"/>`;
    if (r.label) {
      const mx = (x1 + x2) / 2,
        my = (y1 + y2) / 2 - 6;
      svg += `<text x="${mx}" y="${my}" text-anchor="middle" fill="#80deea" font-size="9">${_esc(r.label)}</text>`;
    }
  }

  // Source nodes
  for (let i = 0; i < sources.length; i++) {
    const x = srcX - nodeW / 2,
      y = srcY(i);
    svg += `<rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="4"
      fill="#0d47a1" stroke="#4fc3f7" stroke-width="1"/>
    <text x="${srcX}" y="${y + nodeH / 2 + 4}" text-anchor="middle" fill="#e3f2fd">${_esc(sources[i])}</text>`;
  }

  // Sink nodes
  for (let i = 0; i < sinks.length; i++) {
    const x = sinkX - nodeW / 2,
      y = sinkY(i);
    svg += `<rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="4"
      fill="#1b5e20" stroke="#66bb6a" stroke-width="1"/>
    <text x="${sinkX}" y="${y + nodeH / 2 + 4}" text-anchor="middle" fill="#e8f5e9">${_esc(sinks[i])}</text>`;
  }

  // Labels
  if (sources.length)
    svg += `<text x="${srcX}" y="20" text-anchor="middle" fill="#90caf9" font-size="10">SOURCES</text>`;
  if (sinks.length)
    svg += `<text x="${sinkX}" y="20" text-anchor="middle" fill="#a5d6a7" font-size="10">SINKS</text>`;

  if (!routes.length && !liveNodes.length) {
    svg += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="#546e7a" font-size="13">No signal routes registered</text>`;
  }

  svg += '</svg>';
  return { svg, width: W, height: H + 20 };
}

function _esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _detectLiveNodes() {
  // Prefer an explicit token.label (ADR 041) over the fragile constructor.name —
  // minify/rename can't relabel a graph node, and run-scoped tokens ({label})
  // carry a meaningful name where their constructor would just be 'Object'.
  const labels = [];
  forEachLive((obj) => {
    const label = obj?.label ?? obj?.constructor?.name;
    if (label) labels.push(label);
  });
  return [...new Set(labels)];
}

class SignalGraphAPI {
  constructor() {
    this._winId = null;
  }

  show() {
    // Auto-populate from live route() descriptors (no manual .route() calls needed)
    const autoRoutes = [];
    try {
      for (const r of getLiveRoutes()) {
        const d = r._descriptor?.();
        if (d) {
          const label = d.chain.map((t) => t.op).join('→') || undefined;
          for (const sink of d.sinks) autoRoutes.push({ source: d.source, sink, label });
        }
      }
    } catch (_) {}

    const routes = [...(window.__ar_signalRoutes ?? []), ...autoRoutes];
    const liveNodes = _detectLiveNodes();
    const { svg, width, height } = _buildGraph(routes, liveNodes);

    const html = `<div style="padding:10px;background:#1a1a2e;min-height:100%">${svg}</div>`;

    if (this._winId) {
      const win = document.getElementById(this._winId);
      if (win) {
        const body = win.querySelector('.wm-body');
        if (body) {
          body.innerHTML = html;
          return this;
        }
      }
    }

    const spawned = window.wm?.spawn('Signal Graph', {
      html,
      w: width + 20,
      h: height + 40,
    });
    if (spawned?.id) this._winId = spawned.id;
    return this;
  }

  // Manually register a route
  route(source, sink, label) {
    if (!window.__ar_signalRoutes) window.__ar_signalRoutes = [];
    window.__ar_signalRoutes.push({
      source: String(source),
      sink: String(sink),
      label: label ? String(label) : undefined,
    });
    return this;
  }

  // Clear all routes (called on reset)
  clear() {
    window.__ar_signalRoutes = [];
    return this;
  }
}

export const signalGraph = new SignalGraphAPI();

export function cleanupSignalGraph() {
  window.__ar_signalRoutes = [];
}

// Register teardown with the reset registry (ADR 008).
onReset(cleanupSignalGraph);
