// TranscribePress – MP3 encoder for the share file (lamejs, LGPL). Runs off the main thread.
importScripts('lame.min.js');
self.onmessage = (e) => {
  const { samples, rate, kbps } = e.data;
  try {
    const enc = new lamejs.Mp3Encoder(1, rate, kbps || 32), parts = [], N = 1152 * 8, buf = new Int16Array(N);
    let total = 0;
    for (let i = 0; i < samples.length; i += N) {
      const n = Math.min(N, samples.length - i), b = n === N ? buf : new Int16Array(n);
      for (let k = 0; k < n; k++) { const s = Math.max(-1, Math.min(1, samples[i + k])); b[k] = s < 0 ? s * 0x8000 : s * 0x7fff; }
      const out = enc.encodeBuffer(b); if (out.length) { parts.push(new Uint8Array(out)); total += out.length; }
      if ((i / N) % 200 === 0) self.postMessage({ type: 'progress', p: i / samples.length });
    }
    const end = enc.flush(); if (end.length) { parts.push(new Uint8Array(end)); total += end.length; }
    const mp3 = new Uint8Array(total); let o = 0; for (const p of parts) { mp3.set(p, o); o += p.length; }
    self.postMessage({ type: 'done', mp3 }, [mp3.buffer]);
  } catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); }
};
