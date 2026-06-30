export class EditableImage {
  constructor(source) {
    this._source = source;
    this._ops = [];
    this._canvas = null;
    this._dirty = true;
  }

  crop(x, y, w, h) {
    this._ops.push({ type: 'crop', x, y, w, h });
    this._dirty = true;
    return this;
  }
  rotate(deg) {
    this._ops.push({ type: 'rotate', deg });
    this._dirty = true;
    return this;
  }
  filter(str) {
    this._ops.push({ type: 'filter', str });
    this._dirty = true;
    return this;
  }
  flipH() {
    this._ops.push({ type: 'flipH' });
    this._dirty = true;
    return this;
  }
  flipV() {
    this._ops.push({ type: 'flipV' });
    this._dirty = true;
    return this;
  }
  blend(other, mode = 'screen') {
    this._ops.push({ type: 'blend', other, mode });
    this._dirty = true;
    return this;
  }
  reset() {
    this._ops = [];
    this._dirty = true;
    return this;
  }

  toCanvas() {
    if (!this._dirty && this._canvas) return this._canvas;

    let src = this._source;
    if (src instanceof EditableImage) src = src.toCanvas();

    const sw = src.videoWidth ?? src.naturalWidth ?? src.width ?? 300;
    const sh = src.videoHeight ?? src.naturalHeight ?? src.height ?? 150;

    let c = document.createElement('canvas');
    c.width = sw;
    c.height = sh;
    c.getContext('2d').drawImage(src, 0, 0);

    for (const op of this._ops) {
      const nc = document.createElement('canvas');
      const nctx = nc.getContext('2d');

      if (op.type === 'crop') {
        nc.width = op.w;
        nc.height = op.h;
        nctx.drawImage(c, op.x, op.y, op.w, op.h, 0, 0, op.w, op.h);
      } else if (op.type === 'rotate') {
        const rad = (op.deg * Math.PI) / 180;
        const sin = Math.abs(Math.sin(rad)),
          cos = Math.abs(Math.cos(rad));
        nc.width = Math.round(c.height * sin + c.width * cos);
        nc.height = Math.round(c.width * sin + c.height * cos);
        nctx.translate(nc.width / 2, nc.height / 2);
        nctx.rotate(rad);
        nctx.drawImage(c, -c.width / 2, -c.height / 2);
      } else if (op.type === 'filter') {
        nc.width = c.width;
        nc.height = c.height;
        nctx.filter = op.str;
        nctx.drawImage(c, 0, 0);
      } else if (op.type === 'flipH') {
        nc.width = c.width;
        nc.height = c.height;
        nctx.translate(c.width, 0);
        nctx.scale(-1, 1);
        nctx.drawImage(c, 0, 0);
      } else if (op.type === 'flipV') {
        nc.width = c.width;
        nc.height = c.height;
        nctx.translate(0, c.height);
        nctx.scale(1, -1);
        nctx.drawImage(c, 0, 0);
      } else if (op.type === 'blend') {
        let other = op.other;
        if (other instanceof EditableImage) other = other.toCanvas();
        nc.width = c.width;
        nc.height = c.height;
        nctx.drawImage(c, 0, 0);
        nctx.globalCompositeOperation = op.mode;
        nctx.drawImage(other, 0, 0, nc.width, nc.height);
      } else {
        continue;
      }

      c = nc;
    }

    this._canvas = c;
    this._dirty = false;
    return c;
  }

  draw(target, x = 0, y = 0, w, h) {
    const c = this.toCanvas();
    target.image(c, x, y, w ?? c.width, h ?? c.height);
    return this;
  }

  get width() {
    return this.toCanvas().width;
  }
  get height() {
    return this.toCanvas().height;
  }
}

export function editImage(source) {
  return new EditableImage(source);
}
