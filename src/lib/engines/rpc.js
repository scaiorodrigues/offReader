// RPC mínimo sobre postMessage: chamadas com id, progresso opcional e erros propagados.

export function createRpc(worker) {
  let seq = 0;
  const pending = new Map();
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    if (!p) return;
    if (data.type === 'progress') p.onProgress?.(data.value);
    else {
      pending.delete(data.id);
      if (data.type === 'result') p.resolve(data.value);
      else p.reject(Object.assign(new Error(data.message), { name: data.name }));
    }
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || 'Erro no worker de voz');
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  return {
    call(method, params, onProgress) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject, onProgress });
        worker.postMessage({ id, method, params });
      });
    },
    terminate() { worker.terminate(); pending.clear(); },
  };
}

/** Lado do worker: serializa as chamadas (um motor processa uma coisa por vez). */
export function serve(scope, handlers) {
  let chain = Promise.resolve();
  scope.onmessage = ({ data: { id, method, params } }) => {
    chain = chain.then(async () => {
      try {
        const out = await handlers[method](params, (value) => scope.postMessage({ id, type: 'progress', value }));
        const { value, transfer } = out?.__transfer ? out : { value: out, transfer: [] };
        scope.postMessage({ id, type: 'result', value }, transfer);
      } catch (e) {
        scope.postMessage({ id, type: 'error', name: e?.name, message: String(e?.message ?? e) });
      }
    });
  };
}

export const withTransfer = (value, transfer) => ({ __transfer: true, value, transfer });
