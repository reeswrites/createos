// Auto-blur faces — MediaPipe face tracking + dynamic masking.
// Paste into an editor and Run. Grants camera on first use.
//
// Two composited pipeline layers in one Canvas window:
//   z=0  sharp camera feed
//   z=1  the SAME camera, blurred, masked to the face oval → transparent
//        everywhere else, so the sharp base shows through outside the face.
// vision.faceMask() self-repaints a feathered white oval over the live FaceMesh
// bbox each frame (mirror + smoothing handled); `.mask()` re-uploads it every
// frame (dynamic mask, ADR 054). Single face (vision.face()).

const BLUR = 26; // blur strength (px)

vision.configure({ face: { numFaces: 5 } }); // track up to 5 faces (default 1)

const c = new Canvas({ title: 'Auto-Blur Faces', w: 960, h: 540 });

pipe(Source.camera).layer(c, 0); // sharp base
pipe(Source.camera)
  .blur(BLUR)
  .mask(vision.faceMask({ pad: 0.35, feather: 0.25, smoothing: 0.3 }))
  .layer(c, 1); // blurred ∩ face
