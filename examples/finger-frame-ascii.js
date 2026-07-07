// Finger-Frame ASCII — make a rectangle with your hands, it turns to ASCII.
// Paste into an editor and Run. Grants camera on first use. Needs TWO hands.
//
// Bring one fingertip on each hand (index tip) to opposite corners — the classic
// "director's frame" gesture. The bbox between them becomes a viewfinder:
//   z=0  sharp camera feed
//   z=1  the camera rendered as ASCII, masked to the finger rectangle → only the
//        framed area is ASCII; everything outside stays sharp.
//   z=2  hand skeleton overlay (vision.drawHands)
// vision.handRectMask() self-repaints the white rect from the live hand landmarks
// each frame (mirror handled); `.mask()` re-uploads it every frame (ADR 054).

const W = 960,
  H = 540;

vision.configure({ hands: { numHands: 2 } }); // both hands (default 1)

const c = new Canvas({ title: 'Finger-Frame ASCII', w: W, h: H });

pipe(Source.camera).layer(c, 0); // sharp base
pipe(Source.camera)
  .ascii({ cols: 90, color: '#00ff41', bg: '#0d0208', fit: true }) // fit: match camera aspect
  .mask(vision.handRectMask({ pad: 0.04 }))
  .layer(c, 1); // ASCII inside the finger frame

// neon bloom on the ASCII plane (CSS glow around the glyphs)
c.fx(1).filter('drop-shadow(0 0 2px #00ff41) drop-shadow(0 0 6px #00ff41) brightness(1.15)');

// hand skeleton on top (raw 2D plane at z=2, sized to the logical canvas)
const octx = wm.layer(c.winId, 2, { raster: true, w: W, h: H }).getContext('2d');
tick(() => {
  octx.clearRect(0, 0, W, H);
  vision.drawHands(octx, { color: '#00ff41', lineWidth: 2, pointSize: 4 });
});
