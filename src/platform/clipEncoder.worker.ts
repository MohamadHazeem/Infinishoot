export interface ClipEncodeRequest {
  bitmap: ImageBitmap;
  time: number;
  width: number;
  height: number;
  quality: number;
}

let canvas: OffscreenCanvas;
let ctx: OffscreenCanvasRenderingContext2D | null;
self.onmessage = async ({ data }: MessageEvent<ClipEncodeRequest>) => {
  const { bitmap, time, width, height, quality } = data;
  try {
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas = new OffscreenCanvas(width, height);
      ctx = canvas.getContext('2d', { alpha: false });
    }
    if (!ctx) throw new Error('Canvas unavailable');
    const scale = Math.min(width / bitmap.width, height / bitmap.height);
    const w = bitmap.width * scale, h = bitmap.height * scale;
    ctx.fillStyle = '#1a1c2c';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    self.postMessage({ time, blob });
  } catch {
    self.postMessage({ time, blob: null });
  } finally {
    bitmap.close();
  }
};
