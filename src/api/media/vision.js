import {
  FilesetResolver,
  ObjectDetector,
  GestureRecognizer,
  FaceLandmarker,
  PoseLandmarker,
} from '@mediapipe/tasks-vision';
import { onReset } from '../../runtime/reset-registry.js';
import { notify, subscribe } from '../../events/index.js';
import { acquireCameraRunScoped } from './media-lease.js';

const WASM_CDN = 'https://unpkg.com/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models';

const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [0, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [0, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [5, 9],
  [9, 13],
  [13, 17],
];

const POSE_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 7],
  [0, 4],
  [4, 5],
  [5, 6],
  [6, 8],
  [9, 10],
  [11, 12],
  [11, 13],
  [13, 15],
  [15, 17],
  [15, 19],
  [17, 19],
  [12, 14],
  [14, 16],
  [16, 18],
  [16, 20],
  [18, 20],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [24, 26],
  [25, 27],
  [26, 28],
  [27, 29],
  [28, 30],
  [29, 31],
  [30, 32],
  [27, 31],
  [28, 32],
];

function toTurtle(px, py, vw, vh, cw, ch) {
  const cx = (px / vw) * cw - cw / 2;
  const cy = ch / 2 - (py / vh) * ch;
  return { cx, cy };
}

function classifyExpression(blendshapes) {
  if (!blendshapes?.length) return null;
  const bs = {};
  for (const { categoryName, score } of blendshapes[0].categories) {
    bs[categoryName] = score;
  }
  const smile = ((bs.mouthSmileLeft ?? 0) + (bs.mouthSmileRight ?? 0)) / 2;
  const frown = ((bs.mouthFrownLeft ?? 0) + (bs.mouthFrownRight ?? 0)) / 2;
  const jaw = bs.jawOpen ?? 0;
  const brow = bs.browInnerUp ?? 0;
  if (smile > 0.4) return 'smile';
  if (brow > 0.5 && jaw > 0.3) return 'surprise';
  if (frown > 0.3) return 'frown';
  if (jaw > 0.5) return 'mouth_open';
  return 'neutral';
}

// ── Gaze (ADR 034) ────────────────────────────────────────────────────────────
// Two tiers on one object:
//   • direction (x/y in −1..1, blink/wink) — from blendshapes, no calibration
//   • screen point (vx/vy viewport px)      — from a calibration regression
// A browser cannot know the camera↔screen geometry, so the screen point is
// recovered by fitting head-pose-stabilized iris features → viewport px during
// an interactive calibration pass.

// Iris landmark groups in the 478-point mesh.
const LEFT_IRIS = [468, 469, 470, 471, 472];
const RIGHT_IRIS = [473, 474, 475, 476, 477];
// Eye-corner anchors used to normalize iris offset (scale/position invariance).
const LEFT_EYE = { outer: 33, inner: 133, top: 159, bottom: 145 };
const RIGHT_EYE = { outer: 263, inner: 362, top: 386, bottom: 374 };

const GAZE_CALIB_KEY = 'vl_gaze_calib';

let _calib = null; // { wX:[…], wY:[…] } active regression weights
let _calibDeviceId = null; // resolved camera deviceId for the current key
let _calibMap = _loadCalibMap();
let _gazeWarned = false; // route-level warn-once handled in route.js; this is for region handlers

function _loadCalibMap() {
  try {
    return JSON.parse(localStorage.getItem(GAZE_CALIB_KEY) || '{}');
  } catch {
    return {};
  }
}
function _calibKey(deviceId) {
  return `${deviceId || 'default'}@${screen.width}x${screen.height}`;
}

function _avgPoint(lm, idxs) {
  let x = 0,
    y = 0;
  for (const i of idxs) {
    x += lm[i].x;
    y += lm[i].y;
  }
  return { x: x / idxs.length, y: y / idxs.length };
}

// Iris position within an eye socket, normalized to [-1,1]ish on both axes.
function _eyeGaze(lm, iris, eye) {
  const c = _avgPoint(lm, iris);
  const ox = lm[eye.outer].x,
    ix = lm[eye.inner].x;
  const ty = lm[eye.top].y,
    by = lm[eye.bottom].y;
  const w = ix - ox || 1e-6;
  const h = by - ty || 1e-6;
  return {
    x: ((c.x - ox) / w) * 2 - 1, // -1 outer … +1 inner
    y: ((c.y - ty) / h) * 2 - 1, // -1 top … +1 bottom
  };
}

// Head yaw/pitch (radians) from MediaPipe's column-major 4×4 transform matrix.
// Forward axis = third column (m[8],m[9],m[10]).
function _headPose(matrix) {
  if (!matrix?.data) return { yaw: 0, pitch: 0 };
  const m = matrix.data;
  const fx = m[8],
    fy = m[9],
    fz = m[10];
  return {
    yaw: Math.atan2(fx, fz),
    pitch: Math.atan2(-fy, Math.hypot(fx, fz)),
  };
}

// Feature vector fed to the calibration regression — degree-2 in iris offset
// plus head pose, so the fit can absorb moderate head movement.
function _gazeFeatures(lm, matrix) {
  const l = _eyeGaze(lm, LEFT_IRIS, LEFT_EYE);
  const r = _eyeGaze(lm, RIGHT_IRIS, RIGHT_EYE);
  const gx = (l.x + r.x) / 2;
  const gy = (l.y + r.y) / 2;
  const { yaw, pitch } = _headPose(matrix);
  return [1, gx, gy, gx * gx, gy * gy, gx * gy, yaw, pitch, gx * yaw, gy * pitch];
}

function _applyCalib(feat) {
  if (!_calib) return { vx: null, vy: null };
  const dot = (w) => feat.reduce((s, f, i) => s + f * w[i], 0);
  const vx = dot(_calib.wX),
    vy = dot(_calib.wY);
  return {
    vx: Math.max(0, Math.min(window.innerWidth, vx)),
    vy: Math.max(0, Math.min(window.innerHeight, vy)),
  };
}

// Ridge least squares: solve (FᵀF + λI) w = FᵀY for each output column.
function _fitRidge(features, targets, lambda = 1e-3) {
  const n = features.length,
    d = features[0].length;
  // Normal equation accumulators.
  const A = Array.from({ length: d }, () => new Float64Array(d));
  const bx = new Float64Array(d),
    by = new Float64Array(d);
  for (let s = 0; s < n; s++) {
    const f = features[s],
      tx = targets[s][0],
      ty = targets[s][1];
    for (let i = 0; i < d; i++) {
      bx[i] += f[i] * tx;
      by[i] += f[i] * ty;
      for (let j = 0; j < d; j++) A[i][j] += f[i] * f[j];
    }
  }
  for (let i = 0; i < d; i++) A[i][i] += lambda;
  return { wX: _solve(A, bx), wY: _solve(A, by) };
}

// Gaussian elimination with partial pivoting. A: d×d (mutated), b: length d.
function _solve(A, b) {
  const d = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < d; col++) {
    let piv = col;
    for (let r = col + 1; r < d; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const diag = M[col][col] || 1e-9;
    for (let r = 0; r < d; r++) {
      if (r === col) continue;
      const factor = M[r][col] / diag;
      for (let c = col; c <= d; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row, i) => row[d] / (M[i][i] || 1e-9));
}

function deriveGaze(blendshapes, matrix, landmarks) {
  if (!blendshapes?.length) return null;
  const bs = {};
  for (const { categoryName, score } of blendshapes[0].categories) bs[categoryName] = score;

  const x =
    ((bs.eyeLookOutRight ?? 0) -
      (bs.eyeLookInRight ?? 0) +
      ((bs.eyeLookInLeft ?? 0) - (bs.eyeLookOutLeft ?? 0))) /
    2; // +right
  const y =
    ((bs.eyeLookUpLeft ?? 0) +
      (bs.eyeLookUpRight ?? 0) -
      ((bs.eyeLookDownLeft ?? 0) + (bs.eyeLookDownRight ?? 0))) /
    2; // +up
  const blinkL = bs.eyeBlinkLeft ?? 0;
  const blinkR = bs.eyeBlinkRight ?? 0;
  const blink = (blinkL + blinkR) / 2;
  const leftClosed = blinkL > 0.5;
  const rightClosed = blinkR > 0.5;

  const dir =
    Math.abs(x) < 0.15 && Math.abs(y) < 0.15
      ? 'center'
      : Math.abs(x) > Math.abs(y)
        ? x > 0
          ? 'right'
          : 'left'
        : y > 0
          ? 'up'
          : 'down';

  let vx = null,
    vy = null,
    feat = null;
  if (landmarks?.length >= 478) {
    feat = _gazeFeatures(landmarks, matrix);
    ({ vx, vy } = _applyCalib(feat));
  }
  return { x, y, dir, blink, leftClosed, rightClosed, vx, vy, _feat: feat };
}

function _defaultCtx() {
  return document.getElementById('turtle')?.getContext('2d') ?? null;
}

function _applyMirror(ctx, mirror) {
  if (mirror === 'auto' ? _cameraFlipped : mirror) {
    ctx.translate(ctx.canvas.width, 0);
    ctx.scale(-1, 1);
  }
}

// Track camera flip state persistently (not run-scoped).
let _cameraFlipped = false;
subscribe(
  'camera:flip',
  ({ mirrored }) => {
    _cameraFlipped = !!mirrored;
  },
  { persistent: true },
);

const _cache = { objects: [], hands: [], face: null, pose: null, gaze: null };

// Self-driving handMask RAF cancels (ADR 054) — cleared by stopVision on reset.
// These are INPUTS to a masked shader, so they never join keep-alive.
const _maskLoops = [];

const _gestureHandlers = [];
const _expressionHandlers = [];
const _gazeDirHandlers = []; // { dir, fn, prev }
const _gazeRegionHandlers = []; // { target, fn, prev }  (target = el | {x,y,w,h})
const _blinkHandlers = []; // { fn, prev }
const _winkHandlers = []; // { eye, fn, prev }
let _prevDir = null; // for gaze:look edge

let _initPromise = null;
let _ready = false;
let _running = false;
let _rafId = null;
let _cameraLeased = false; // guard: acquire once per run start
let _videoSource = null; // custom source override (video/canvas el)
let _lastDetectionTime = 0;
const DETECTION_INTERVAL_MS = 100;

let _objectDetector = null;
let _gestureRecognizer = null;
let _faceLandmarker = null;

// Hands: MediaPipe's GestureRecognizer defaults to numHands:1 — bump via
// vision.configure({ hands }). Applied live via setOptions even after the
// app-boot preload built the recognizer, so it works any time (not first-run-wins).
let _handsConfig = { numHands: 1 };

// Pose: lazy init, configurable before first use.
let _poseLandmarker = null;
let _initPosePromise = null;
let _poseConfig = { model: 'lite', numPoses: 1 };

async function _init() {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const wasmFileset = await FilesetResolver.forVisionTasks(WASM_CDN);
    [_objectDetector, _gestureRecognizer, _faceLandmarker] = await Promise.all([
      ObjectDetector.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath: `${MODEL_BASE}/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        scoreThreshold: 0.5,
      }),
      GestureRecognizer.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath: `${MODEL_BASE}/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task`,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: _handsConfig.numHands ?? 1,
      }),
      FaceLandmarker.createFromOptions(wasmFileset, {
        baseOptions: {
          modelAssetPath: `${MODEL_BASE}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        outputFaceBlendshapes: true,
        // Head pose matrix (ADR 034) — stabilizes gaze features against head movement.
        outputFacialTransformationMatrixes: true,
      }),
    ]);
    _ready = true;
  })();
  return _initPromise;
}

async function _initPose() {
  if (_initPosePromise) return _initPosePromise;
  _initPosePromise = (async () => {
    const wasmFileset = await FilesetResolver.forVisionTasks(WASM_CDN);
    const modelName =
      _poseConfig.model === 'heavy'
        ? 'pose_landmarker_heavy'
        : _poseConfig.model === 'full'
          ? 'pose_landmarker_full'
          : 'pose_landmarker_lite';
    _poseLandmarker = await PoseLandmarker.createFromOptions(wasmFileset, {
      baseOptions: {
        modelAssetPath: `${MODEL_BASE}/pose_landmarker/${modelName}/float16/1/${modelName}.task`,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: _poseConfig.numPoses ?? 1,
    });
  })();
  return _initPosePromise;
}

function _loop() {
  if (!_running) return;
  _rafId = requestAnimationFrame(_loop);

  const video = _videoSource ?? window.__ar_video;
  if (!video) return;
  if (video instanceof HTMLVideoElement && video.readyState < video.HAVE_CURRENT_DATA) return;

  const now = performance.now();
  if (now - _lastDetectionTime < DETECTION_INTERVAL_MS) return;
  _lastDetectionTime = now;

  const vw = video instanceof HTMLVideoElement ? video.videoWidth || 600 : video.width || 600;
  const vh = video instanceof HTMLVideoElement ? video.videoHeight || 600 : video.height || 600;
  const canvasEl = document.getElementById('turtle');
  const cw = canvasEl?.width ?? 600;
  const ch = canvasEl?.height ?? 600;

  try {
    if (_objectDetector) {
      const r = _objectDetector.detectForVideo(video, now);
      _cache.objects = (r.detections ?? []).map((d) => {
        const bb = d.boundingBox;
        const px = bb.originX + bb.width / 2;
        const py = bb.originY + bb.height / 2;
        return {
          label: d.categories[0]?.categoryName ?? 'unknown',
          confidence: d.categories[0]?.score ?? 0,
          bbox: {
            x: bb.originX / vw,
            y: bb.originY / vh,
            width: bb.width / vw,
            height: bb.height / vh,
          },
          ...toTurtle(px, py, vw, vh, cw, ch),
        };
      });
      for (const obj of _cache.objects) {
        notify('gesture:object', { label: obj.label, confidence: obj.confidence, bbox: obj.bbox });
      }
    }
  } catch (_) {}

  try {
    if (_gestureRecognizer) {
      const r = _gestureRecognizer.recognizeForVideo(video, now);
      _cache.hands = (r.gestures ?? []).map((g, i) => {
        const lm = r.landmarks?.[i] ?? [];
        let cx = 0,
          cy = 0;
        if (lm.length) {
          const wrist = lm[0];
          ({ cx, cy } = toTurtle(wrist.x * vw, wrist.y * vh, vw, vh, cw, ch));
        }
        return {
          gesture: g[0]?.categoryName ?? 'None',
          confidence: g[0]?.score ?? 0,
          handedness: r.handedness?.[i]?.[0]?.categoryName ?? null, // 'Left' | 'Right'
          cx,
          cy,
          landmarks: lm,
        };
      });
    }
  } catch (_) {}

  try {
    if (_faceLandmarker) {
      const r = _faceLandmarker.detectForVideo(video, now);
      if (r.faceLandmarks?.length) {
        const lm = r.faceLandmarks[0];
        const avgX = lm.reduce((s, p) => s + p.x, 0) / lm.length;
        const avgY = lm.reduce((s, p) => s + p.y, 0) / lm.length;
        const { cx, cy } = toTurtle(avgX * vw, avgY * vh, vw, vh, cw, ch);
        const gaze = deriveGaze(r.faceBlendshapes, r.facialTransformationMatrixes?.[0], lm);
        _cache.face = {
          expression: classifyExpression(r.faceBlendshapes),
          cx,
          cy,
          landmarks: lm,
          gaze,
        };
        _cache.gaze = gaze;
        _resolveCalibLazy();
        notify('gesture:face', { expression: _cache.face.expression, cx, cy, landmarks: lm });
        if (gaze) _notifyGaze(gaze);
      } else {
        _cache.face = null;
        _cache.gaze = null;
      }
    }
  } catch (_) {}

  try {
    if (_poseLandmarker) {
      const r = _poseLandmarker.detectForVideo(video, now);
      if (r.landmarks?.length) {
        _cache.pose = { landmarks: r.landmarks[0] };
        notify('gesture:pose', { landmarks: r.landmarks[0] });
      } else {
        _cache.pose = null;
      }
    }
  } catch (_) {}

  // Edge-triggered gesture handlers
  const g = _cache.hands[0]?.gesture;
  const currGesture = !g || g === 'None' ? null : g;
  for (const h of _gestureHandlers) {
    const active = currGesture === h.gesture;
    if (active && !h.prev) {
      notify('gesture:detected', {
        type: currGesture,
        hand: _cache.hands[0],
        confidence: _cache.hands[0]?.confidence ?? 0,
      });
      h.fn();
    }
    h.prev = active;
  }

  // Edge-triggered expression handlers
  const currExpr = _cache.face?.expression ?? null;
  for (const h of _expressionHandlers) {
    const active = currExpr === h.expr;
    if (active && !h.prev) {
      const face = _cache.face;
      if (currExpr === 'smile') {
        notify('gesture:smile', {
          confidence: face?.confidence ?? 0,
          cx: face?.cx ?? 0,
          cy: face?.cy ?? 0,
        });
      }
      notify('gesture:expression', {
        expression: currExpr,
        confidence: face?.confidence ?? 0,
        cx: face?.cx ?? 0,
        cy: face?.cy ?? 0,
      });
      h.fn();
    }
    h.prev = active;
  }
}

// Resolve which stored calibration applies, once the camera deviceId is known.
function _resolveCalibLazy() {
  if (_calib) return;
  const dev = _activeDeviceId();
  if (dev === _calibDeviceId) return; // already tried this device
  _calibDeviceId = dev;
  const entry = _calibMap[_calibKey(dev)];
  if (entry) _calib = entry;
}

function _activeDeviceId() {
  const video = _videoSource ?? window.__ar_video;
  const track = video?.srcObject?.getVideoTracks?.()[0];
  return track?.getSettings?.().deviceId || 'default';
}

// Fire all gaze events + edge handlers for one detection cycle.
function _notifyGaze(g) {
  notify('gaze:move', { vx: g.vx, vy: g.vy, x: g.x, y: g.y, dir: g.dir });

  if (g.dir !== _prevDir) {
    notify('gaze:look', { dir: g.dir });
    _prevDir = g.dir;
  }
  for (const h of _gazeDirHandlers) {
    const active = g.dir === h.dir;
    if (active && !h.prev) h.fn();
    h.prev = active;
  }

  // Blink (both eyes) — edge on rising.
  const bothClosed = g.leftClosed && g.rightClosed;
  for (const h of _blinkHandlers) {
    if (bothClosed && !h.prev) {
      notify('gaze:blink', {});
      h.fn();
    }
    h.prev = bothClosed;
  }

  // Wink (one eye closed, the other open) — edge on rising, per eye.
  const winkL = g.leftClosed && !g.rightClosed;
  const winkR = g.rightClosed && !g.leftClosed;
  for (const h of _winkHandlers) {
    const active = h.eye === 'left' ? winkL : winkR;
    if (active && !h.prev) {
      notify('gaze:wink', { eye: h.eye });
      h.fn();
    }
    h.prev = active;
  }

  // Region gaze (needs calibration — vx/vy). No-op + warn once if uncalibrated.
  if (_gazeRegionHandlers.length) {
    if (g.vx == null) {
      if (!_gazeWarned) {
        console.warn(
          'vision.onGaze(region): gaze not calibrated — call vision.calibrate() or click the gaze chip',
        );
        _gazeWarned = true;
      }
    } else {
      for (const h of _gazeRegionHandlers) {
        const inside = _inRect(g.vx, g.vy, h.target);
        if (inside && !h.prev) {
          notify('gaze:enter', { target: h.label });
          h.fn(true);
        } else if (!inside && h.prev) {
          notify('gaze:leave', { target: h.label });
          h.fn(false);
        }
        h.prev = inside;
      }
    }
  }
}

// Hit-test a viewport point against an element or a {x,y,w,h} viewport rect.
function _inRect(vx, vy, target) {
  let r;
  if (target && typeof target.getBoundingClientRect === 'function') {
    const b = target.getBoundingClientRect();
    r = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
  } else if (target) {
    r = { left: target.x, top: target.y, right: target.x + target.w, bottom: target.y + target.h };
  } else return false;
  return vx >= r.left && vx <= r.right && vy >= r.top && vy <= r.bottom;
}

function _ensureStarted() {
  if (_running) return;
  if (!_cameraLeased && !_videoSource) {
    acquireCameraRunScoped();
    _cameraLeased = true;
  }
  _running = true;
  if (_ready) {
    _loop();
  } else {
    _init().then(() => {
      if (_running) _loop();
    });
  }
}

function _ensurePoseStarted() {
  _ensureStarted();
  if (!_poseLandmarker && !_initPosePromise) {
    _initPose();
  }
}

export function preloadVision() {
  _init();
}

export function stopVision() {
  _running = false;
  _cameraLeased = false; // allow re-acquire on next run
  _videoSource = null;
  if (_rafId) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  _cache.objects = [];
  _cache.hands = [];
  _cache.face = null;
  _cache.pose = null;
  _cache.gaze = null;
  _lastDetectionTime = 0;
  _gestureHandlers.length = 0;
  _expressionHandlers.length = 0;
  _gazeDirHandlers.length = 0;
  _gazeRegionHandlers.length = 0;
  _blinkHandlers.length = 0;
  _winkHandlers.length = 0;
  _prevDir = null;
  for (const cancel of _maskLoops.splice(0)) cancel(); // stop handMask RAFs (ADR 054)
  // Calibration model + persisted map survive reset (not run artifacts).
}

// Grid of viewport target points for an N-point calibration.
function _calibTargets(points) {
  const mx = window.innerWidth * 0.1,
    my = window.innerHeight * 0.1;
  const W = window.innerWidth - 2 * mx,
    H = window.innerHeight - 2 * my;
  const at = (fx, fy) => ({ x: mx + fx * W, y: my + fy * H });
  if (points <= 5) return [at(0.5, 0.5), at(0, 0), at(1, 0), at(0, 1), at(1, 1)];
  const cols = points >= 13 ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1];
  const out = [];
  for (const fy of [0, 0.5, 1]) for (const fx of cols) out.push(at(fx, fy));
  return out;
}

// Interactive calibration pass. Renders a fullscreen dot overlay, samples
// head-pose-stabilized iris features at each point, fits the regression, and
// persists it device-locally. Driven by RAF + performance.now (no harness timers).
function _runCalibration({ points = 9, dwell = 1100, settle = 500 } = {}) {
  _ensureStarted();
  const targets = _calibTargets(points);
  const overlay = document.createElement('div');
  overlay.className = 'ar-gaze-calib';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '99999',
    background: 'rgba(0,0,0,0.92)',
    cursor: 'none',
  });
  const dot = document.createElement('div');
  Object.assign(dot.style, {
    position: 'fixed',
    width: '22px',
    height: '22px',
    marginLeft: '-11px',
    marginTop: '-11px',
    borderRadius: '50%',
    background: '#0ff',
    boxShadow: '0 0 18px #0ff',
    transition: 'opacity .15s',
  });
  const hint = document.createElement('div');
  Object.assign(hint.style, {
    position: 'fixed',
    left: '0',
    right: '0',
    bottom: '6%',
    textAlign: 'center',
    color: '#8ff',
    font: '14px system-ui',
    opacity: '0.8',
  });
  hint.textContent = 'Follow the dot with your eyes — keep your head still';
  overlay.append(dot, hint);
  document.body.appendChild(overlay);

  const feats = [],
    tgts = [];
  return new Promise((resolve) => {
    let i = 0,
      phaseStart = performance.now(),
      sampling = false;
    const place = () => {
      const t = targets[i];
      dot.style.left = t.x + 'px';
      dot.style.top = t.y + 'px';
      dot.style.opacity = '1';
      dot.animate?.([{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }], { duration: 400 });
    };
    place();
    const step = () => {
      const now = performance.now();
      const el = now - phaseStart;
      if (!sampling && el >= settle) sampling = true;
      if (sampling) {
        const f = _cache.gaze?._feat;
        if (f) {
          feats.push(f);
          tgts.push([targets[i].x, targets[i].y]);
        }
      }
      if (el >= dwell) {
        i++;
        if (i >= targets.length) {
          finish();
          return;
        }
        phaseStart = now;
        sampling = false;
        place();
      }
      requestAnimationFrame(step);
    };
    const finish = () => {
      overlay.remove();
      if (feats.length >= targets.length * 3) {
        _calib = _fitRidge(feats, tgts);
        const dev = _activeDeviceId();
        _calibDeviceId = dev;
        _calibMap[_calibKey(dev)] = { wX: [..._calib.wX], wY: [..._calib.wY] };
        try {
          localStorage.setItem(GAZE_CALIB_KEY, JSON.stringify(_calibMap));
        } catch {}
        _gazeWarned = false;
        _removeGazeChip();
      }
      resolve(!!_calib);
    };
    requestAnimationFrame(step);
  });
}

// Dormant calibration chip — the zero-code entry point (decision: chip + calibrate()).
// Appears when a calibration-dependent gaze API is touched while uncalibrated; the
// click is the opt-in gesture. Removes itself once calibrated.
let _gazeChip = null;
function _ensureGazeChip() {
  if (_calib || _gazeChip) return;
  const chip = document.createElement('button');
  chip.className = 'ar-gaze-chip';
  chip.textContent = '🎯 Calibrate gaze';
  Object.assign(chip.style, {
    position: 'fixed',
    right: '14px',
    bottom: '14px',
    zIndex: '9998',
    padding: '7px 12px',
    borderRadius: '14px',
    border: '1px solid #0ff8',
    background: '#012',
    color: '#8ff',
    font: '13px system-ui',
    cursor: 'pointer',
  });
  chip.onclick = async () => {
    chip.disabled = true;
    await _runCalibration();
    _removeGazeChip();
  };
  _gazeChip = chip;
  document.body.appendChild(chip);
}
function _removeGazeChip() {
  _gazeChip?.remove();
  _gazeChip = null;
}

export const vision = {
  configure(opts = {}) {
    if (opts.pose && !_initPosePromise) {
      Object.assign(_poseConfig, opts.pose);
    }
    if (opts.hands) {
      Object.assign(_handsConfig, opts.hands);
      // The GestureRecognizer is built at app-boot preload (numHands:1), so the
      // pre-init guard never wins from user code. MediaPipe tasks accept live
      // setOptions — push numHands onto the already-built recognizer too.
      if (_gestureRecognizer) {
        _gestureRecognizer.setOptions({ numHands: _handsConfig.numHands ?? 1 });
      }
    }
    return this;
  },

  // Use a custom HTMLVideoElement or HTMLCanvasElement instead of the webcam.
  // Pass null to revert to webcam. Must be called before other vision methods.
  source(el) {
    _videoSource = el ?? null;
    _ensureStarted();
    return this;
  },

  objects() {
    _ensureStarted();
    return _cache.objects;
  },
  nearest(label) {
    _ensureStarted();
    const list = label ? _cache.objects.filter((o) => o.label === label) : _cache.objects;
    if (!list.length) return null;
    return list.reduce((best, o) => (o.confidence > best.confidence ? o : best));
  },
  all(label) {
    _ensureStarted();
    return _cache.objects.filter((o) => o.label === label);
  },
  count(label) {
    _ensureStarted();
    return _cache.objects.filter((o) => o.label === label).length;
  },
  any(label) {
    _ensureStarted();
    return _cache.objects.some((o) => o.label === label);
  },

  hands() {
    _ensureStarted();
    return _cache.hands;
  },
  gesture() {
    _ensureStarted();
    if (!_cache.hands.length) return null;
    const g = _cache.hands[0].gesture;
    return g === 'None' ? null : g;
  },

  // Ready-to-use dynamic mask driven by hand tracking (ADR 054). Returns a
  // white-on-black canvas (luminance-native, so `.mask()`'s default channel reads
  // it) that self-redraws every frame from vision.hands(), unioning all hands.
  // Drop straight into a masked layer: `shader.mask(vision.handMask())`.
  //   landmark : landmark index or array of indices to place blobs at (default 8,
  //              the index fingertip). See MediaPipe hand landmark map.
  //   radius   : blob radius, normalized to min(w,h) (default 0.12)
  //   shape    : 'circle' | 'square'
  //   smoothing: 0 (raw, jittery) … 1 (heavy lag). Exponential per-landmark lerp.
  //   mirror   : 'auto' | bool — align with the selfie-mirrored camera view.
  // Self-driving (run-scoped RAF, stopped on reset); NOT a keep-alive output —
  // the masked shader it feeds is what holds the run alive.
  handMask({
    landmark = 8,
    radius = 0.12,
    shape = 'circle',
    smoothing = 0.3,
    mirror = 'auto',
    w = 512,
    h = 512,
  } = {}) {
    _ensureStarted();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const rpx = radius * Math.min(w, h);
    const idxs = Array.isArray(landmark) ? landmark : [landmark];
    const smoothed = new Map(); // 'hand:landmark' → { x, y } (normalized)
    let rafId = null;
    const draw = () => {
      if (!window.__ar_paused && ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, w, h);
        ctx.save();
        _applyMirror(ctx, mirror);
        ctx.fillStyle = 'white';
        _cache.hands.forEach((hand, hi) => {
          const lm = hand.landmarks;
          if (!lm?.length) return;
          for (const li of idxs) {
            const p = lm[li];
            if (!p) continue;
            const key = hi + ':' + li;
            const prev = smoothed.get(key);
            const sx = prev ? prev.x * smoothing + p.x * (1 - smoothing) : p.x;
            const sy = prev ? prev.y * smoothing + p.y * (1 - smoothing) : p.y;
            smoothed.set(key, { x: sx, y: sy });
            const cx = sx * w,
              cy = sy * h;
            if (shape === 'square') ctx.fillRect(cx - rpx, cy - rpx, rpx * 2, rpx * 2);
            else {
              ctx.beginPath();
              ctx.arc(cx, cy, rpx, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        });
        ctx.restore();
      }
      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);
    _maskLoops.push(() => cancelAnimationFrame(rafId));
    return canvas;
  },

  face() {
    _ensureStarted();
    return _cache.face;
  },
  expression() {
    _ensureStarted();
    return _cache.face?.expression ?? null;
  },

  pose() {
    _ensurePoseStarted();
    return _cache.pose;
  },

  // ── Gaze (ADR 034) ─────────────────────────────────────────────────────────
  gaze() {
    _ensureStarted();
    if (!_cache.gaze) return null;
    const { x, y, dir, blink, leftClosed, rightClosed, vx, vy } = _cache.gaze;
    return { x, y, dir, blink, leftClosed, rightClosed, vx, vy };
  },

  // Convert the viewport gaze point to coordinates local to an element/canvas.
  gazeIn(el) {
    _ensureStarted();
    if (!_calib) _ensureGazeChip();
    const g = _cache.gaze;
    if (!g || g.vx == null || !el?.getBoundingClientRect) return null;
    const b = el.getBoundingClientRect();
    return { x: g.vx - b.left, y: g.vy - b.top };
  },

  get calibrated() {
    return !!_calib;
  },

  // Run an interactive calibration pass. Resolves to true if calibration succeeded.
  calibrate(opts) {
    return _runCalibration(opts);
  },

  // Polymorphic: a direction string ('left'/'right'/'up'/'down'/'center') registers a
  // calibration-free handler; an element or {x,y,w,h} viewport rect registers a region
  // handler (needs calibration) firing fn(true) on gaze-enter, fn(false) on gaze-leave.
  onGaze(target, fn) {
    _ensureStarted();
    if (typeof target === 'string') {
      _gazeDirHandlers.push({ dir: target, fn, prev: false });
    } else {
      const label = target?.id || target?.className || 'rect';
      _gazeRegionHandlers.push({ target, label, fn, prev: false });
      if (!_calib) _ensureGazeChip();
    }
    return this;
  },
  onBlink(fn) {
    _ensureStarted();
    _blinkHandlers.push({ fn, prev: false });
    return this;
  },
  onWink(eye, fn) {
    _ensureStarted();
    _winkHandlers.push({ eye, fn, prev: false });
    return this;
  },

  onGesture(gesture, fn) {
    _ensureStarted();
    _gestureHandlers.push({ gesture, fn, prev: false });
    return this;
  },
  onExpression(expr, fn) {
    _ensureStarted();
    _expressionHandlers.push({ expr, fn, prev: false });
    return this;
  },

  drawBoxes(
    ctx,
    { color = 'lime', font = '14px sans-serif', lineWidth = 2, mirror = 'auto' } = {},
  ) {
    _ensureStarted();
    if (!ctx) ctx = _defaultCtx();
    if (!ctx) return;
    const { width: cw, height: ch } = ctx.canvas;
    ctx.save();
    _applyMirror(ctx, mirror);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.lineWidth = lineWidth;
    for (const obj of _cache.objects) {
      const { bbox } = obj;
      if (!bbox) continue;
      const x = bbox.x * cw,
        y = bbox.y * ch,
        w = bbox.width * cw,
        h = bbox.height * ch;
      ctx.strokeRect(x, y, w, h);
      ctx.fillText(`${obj.label} ${(obj.confidence * 100).toFixed(0)}%`, x + 2, y - 4);
    }
    ctx.restore();
  },

  drawFace(ctx, { color = 'cyan', pointSize = 1.5, mirror = 'auto' } = {}) {
    _ensureStarted();
    if (!ctx) ctx = _defaultCtx();
    if (!ctx || !_cache.face) return;
    const { width: cw, height: ch } = ctx.canvas;
    ctx.save();
    _applyMirror(ctx, mirror);
    ctx.fillStyle = color;
    for (const lm of _cache.face.landmarks) {
      ctx.beginPath();
      ctx.arc(lm.x * cw, lm.y * ch, pointSize, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },

  drawHands(ctx, { color = 'yellow', lineWidth = 2, pointSize = 4, mirror = 'auto' } = {}) {
    _ensureStarted();
    if (!ctx) ctx = _defaultCtx();
    if (!ctx || !_cache.hands.length) return;
    const { width: cw, height: ch } = ctx.canvas;
    ctx.save();
    _applyMirror(ctx, mirror);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    for (const hand of _cache.hands) {
      const lm = hand.landmarks;
      if (!lm?.length) continue;
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.beginPath();
        ctx.moveTo(lm[a].x * cw, lm[a].y * ch);
        ctx.lineTo(lm[b].x * cw, lm[b].y * ch);
        ctx.stroke();
      }
      for (const p of lm) {
        ctx.beginPath();
        ctx.arc(p.x * cw, p.y * ch, pointSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  },

  drawPose(
    ctx,
    { color = 'magenta', lineWidth = 2, pointSize = 4, minVisibility = 0.5, mirror = 'auto' } = {},
  ) {
    _ensurePoseStarted();
    if (!ctx) ctx = _defaultCtx();
    if (!ctx || !_cache.pose) return;
    const { width: cw, height: ch } = ctx.canvas;
    const lm = _cache.pose.landmarks;
    ctx.save();
    _applyMirror(ctx, mirror);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    for (const [a, b] of POSE_CONNECTIONS) {
      if ((lm[a].visibility ?? 1) < minVisibility || (lm[b].visibility ?? 1) < minVisibility)
        continue;
      ctx.beginPath();
      ctx.moveTo(lm[a].x * cw, lm[a].y * ch);
      ctx.lineTo(lm[b].x * cw, lm[b].y * ch);
      ctx.stroke();
    }
    for (const p of lm) {
      if ((p.visibility ?? 1) < minVisibility) continue;
      ctx.beginPath();
      ctx.arc(p.x * cw, p.y * ch, pointSize, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },
};

onReset(stopVision);
