import * as THREE from 'three';

/** Small procedural noise texture used for grime/roughness variation on every surface. */
export function makeNoiseTexture(size = 256, seed = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  // Two octaves of value noise.
  const coarse = new Float32Array(64 * 64);
  for (let i = 0; i < coarse.length; i++) coarse[i] = rnd();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = (x / size) * 64;
      const cy = (y / size) * 64;
      const x0 = Math.floor(cx);
      const y0 = Math.floor(cy);
      const fx = cx - x0;
      const fy = cy - y0;
      const v00 = coarse[(y0 % 64) * 64 + (x0 % 64)];
      const v10 = coarse[(y0 % 64) * 64 + ((x0 + 1) % 64)];
      const v01 = coarse[((y0 + 1) % 64) * 64 + (x0 % 64)];
      const v11 = coarse[((y0 + 1) % 64) * 64 + ((x0 + 1) % 64)];
      const v = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
      const fine = rnd() * 0.25;
      const n = 0.72 + v * 0.22 + fine * 0.12;
      const i = (y * size + x) * 4;
      const b = Math.max(0, Math.min(255, Math.round(n * 255)));
      img.data[i] = b;
      img.data[i + 1] = b;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Text rendered to a canvas, for nameplates. */
export function makeTextTexture(text: string, color: string, size = 48): { texture: THREE.CanvasTexture; aspect: number } {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = `600 ${size}px "Inter", "Segoe UI", system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 24;
  c.width = Math.max(64, w);
  c.height = size + 20;
  ctx.font = `600 ${size}px "Inter", "Segoe UI", system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(5,7,12,0.55)';
  ctx.beginPath();
  ctx.roundRect(0, 0, c.width, c.height, 10);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return { texture, aspect: c.width / c.height };
}
