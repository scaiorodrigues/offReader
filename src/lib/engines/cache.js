// Download com progresso + Cache Storage. É o mecanismo offline compartilhado pelos motores:
// depois do primeiro download, os arquivos são lidos do cache sem rede.

export const MODEL_CACHE = 'leitor-models-v1';

const cachesApi = () => (typeof caches !== 'undefined' ? caches : null);

export async function isCached(url, cacheName = MODEL_CACHE) {
  const c = cachesApi();
  if (!c) return false;
  try { return !!(await (await c.open(cacheName)).match(url)); } catch { return false; }
}

export async function removeCached(urls, cacheName = MODEL_CACHE) {
  const c = cachesApi();
  if (!c) return;
  const cache = await c.open(cacheName);
  await Promise.all(urls.map((u) => cache.delete(u)));
}

async function download(url, onBytes, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Falha ao baixar (${res.status}): ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onBytes(buf.length, buf.length);
    return buf;
  }
  const reader = res.body.getReader();
  let out = total ? new Uint8Array(total) : null;
  const parts = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (out && received + value.length <= out.length) out.set(value, received);
    else { if (out) { parts.push(out.subarray(0, received)); out = null; } parts.push(value); }
    received += value.length;
    onBytes(received, total);
  }
  if (out) return received === out.length ? out : out.subarray(0, received);
  const joined = new Uint8Array(received);
  let off = 0;
  for (const p of parts) { joined.set(p, off); off += p.length; }
  return joined;
}

/**
 * Devolve os bytes do arquivo, do cache se existir; senão baixa (com até 3 tentativas) e guarda.
 * onProgress(receivedBytes, totalBytes)
 */
export async function fetchCached(url, { onProgress, signal, cacheName = MODEL_CACHE } = {}) {
  const c = cachesApi();
  if (c) {
    try {
      const hit = await (await c.open(cacheName)).match(url);
      if (hit) {
        const buf = new Uint8Array(await hit.arrayBuffer());
        onProgress?.(buf.length, buf.length);
        return buf;
      }
    } catch { /* segue para a rede */ }
  }
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const bytes = await download(url, (r, t) => onProgress?.(r, t), signal);
      if (c) {
        try { await (await c.open(cacheName)).put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })); }
        catch (e) { console.warn('Não foi possível guardar no cache:', e); }
      }
      return bytes;
    } catch (e) {
      lastErr = e;
      if (e.name === 'AbortError') throw e;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  throw lastErr;
}

/**
 * Baixa/lê vários arquivos em sequência e reporta o progresso agregado (0..1), ponderado pelos bytes esperados.
 * @param {{url:string, bytes:number}[]} files
 * @param {(p:{fraction:number, file:string})=>void} onProgress
 */
export async function fetchAll(files, { onProgress, signal } = {}) {
  const totalBytes = files.reduce((a, f) => a + f.bytes, 0);
  const results = [];
  let done = 0;
  for (const f of files) {
    results.push(await fetchCached(f.url, {
      signal,
      onProgress: (received, total) => {
        const expected = total || f.bytes;
        const part = Math.min(received, expected) / (expected || 1) * f.bytes;
        onProgress?.({ fraction: Math.min(1, (done + part) / totalBytes), file: f.url.split('/').pop() });
      },
    }));
    done += f.bytes;
  }
  return results;
}
