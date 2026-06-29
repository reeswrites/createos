# Vision API

MediaPipe-powered camera analysis: object detection, hand gesture recognition, face expression detection. Runs at ~10fps in a background loop once the camera is enabled.

Enable the camera via the **Camera** toggle in the nav bar before using `vision.*`.

---

## Objects

Detects 80+ common object categories (COCO classes: person, cat, dog, cup, laptop, phone, etc.).

```js
vision.objects()         // all detected objects
// → [{label, confidence, cx, cy}, ...]

vision.nearest('person') // highest-confidence match for label (or any object if omitted)
// → {label, confidence, cx, cy} | null

vision.any('person')     // true if any object of this label is detected
// → boolean

vision.count('person')   // how many objects of this label are visible
// → number
```

### Coordinates

`cx` and `cy` are canvas-space coordinates centered at `(0, 0)`:
- `cx` range: `[-800, 800]` (left to right)
- `cy` range: `[-450, 450]` (bottom to top — positive is up)

---

## Hands & Gestures

Detects hands and classifies gestures.

```js
vision.hands()    // all detected hands
// → [{gesture, confidence, cx, cy}, ...]

vision.gesture()  // gesture of the first hand, or null
// → 'Thumb_Up' | 'Thumb_Down' | 'Open_Palm' | 'Closed_Fist' |
//   'Pointing_Up' | 'Victory' | 'ILoveYou' | 'None' | null
```

### Edge-triggered handler

Fires once when the gesture first appears (not on every frame while held):

```js
vision.onGesture('Thumb_Up', () => {
  console.log('thumbs up!');
});

vision.onGesture('Open_Palm', () => {
  // fires once each time palm appears
});
```

---

## Face

Detects one face with expression classification and landmark positions.

```js
vision.face()
// → {expression, cx, cy, landmarks} | null

vision.expression()
// → 'smile' | 'surprise' | 'frown' | 'mouth_open' | 'neutral' | null
```

### Edge-triggered handler

```js
vision.onExpression('smile', () => {
  console.log('smiling!');
});
```

### Expressions

| Value | Trigger |
|-------|---------|
| `'smile'` | mouth corners raised |
| `'surprise'` | brow raised + jaw open |
| `'frown'` | mouth corners pulled down |
| `'mouth_open'` | jaw open (without brow raise) |
| `'neutral'` | none of the above |

---

## Examples

### Object drives visual

```js
setInterval(() => {
  const p = vision.nearest('person');
  if (!p) return;
  // cx/cy are canvas-centered — map to pixel coords
  const px = p.cx + 800;
  const py = 450 - p.cy;
  draw.clear().circle(px, py, 30, 'lime');
}, 50);
```

### Gesture switches mode

```js
let mode = 'draw';

vision.onGesture('Open_Palm', () => { mode = 'erase'; });
vision.onGesture('Closed_Fist', () => { mode = 'draw'; });

setInterval(() => {
  const h = vision.hands()[0];
  if (!h) return;
  const x = h.cx + 800, y = 450 - h.cy;
  if (mode === 'draw') draw.circle(x, y, 8, 'white');
  if (mode === 'erase') draw.circle(x, y, 20, '#000');
}, 16);
```

### Expression triggers audio

```js
note("<c4 e4 g4>").play();
setcps(0.33); // ~80 bpm

vision.onExpression('smile', () => setcps(0.58)); // smile = faster (~140 bpm)
vision.onExpression('frown', () => setcps(0.25)); // frown = slower (~60 bpm)
```

### Object count drives density

```js
const k = audio.kick();

setInterval(() => {
  const n = vision.count('person');
  audio.bpm(80 + n * 20); // more people = faster BPM
}, 500);
```

---

## Notes

- Camera must be enabled before `vision.*` returns data — values are empty arrays / null until the camera is on and models are loaded
- Models load from CDN on first camera enable (~2–4s)
- Detection runs at ~10fps to avoid blocking the render thread
- `onGesture` and `onExpression` handlers are edge-triggered: they fire once per gesture appearance, not continuously
- All handlers are cleared automatically on Stop/Reset
