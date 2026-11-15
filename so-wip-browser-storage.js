/* Local IndexedDB adapter for the SO WIP statement tool. */
(function () {
  'use strict';
  if (window.claude) return;

  const DB_NAME = 'gaty-so-wip-statement';
  const DB_VERSION = 1;
  const listeners = new Map();
  let dbPromise;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        ['order_map', 'archive', 'assets'].forEach(name => {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }
  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function readAll(name) {
    const db = await openDb();
    const tx = db.transaction(name, 'readonly');
    const store = tx.objectStore(name);
    const [keys, values] = await Promise.all([
      requestValue(store.getAllKeys()),
      requestValue(store.getAll())
    ]);
    return keys.map((key, i) => ({ id: key, value: values[i] }));
  }
  async function write(name, id, value) {
    const db = await openDb();
    const tx = db.transaction(name, 'readwrite');
    tx.objectStore(name).put(value, id);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    notify(name);
  }
  async function remove(name, id) {
    const db = await openDb();
    const tx = db.transaction(name, 'readwrite');
    tx.objectStore(name).delete(id);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    notify(name);
  }
  function snapshot(records) {
    return { docs: records.map(item => ({ id: item.id, data: () => item.value })) };
  }
  async function notify(name) {
    const set = listeners.get(name);
    if (!set || !set.size) return;
    const records = await readAll(name);
    set.forEach(callback => callback(snapshot(records)));
  }
  function collection(name) {
    return {
      doc(id) {
        const key = id || ('d_' + crypto.randomUUID());
        return {
          async set(value) { await write(name, key, value); },
          async get() {
            const db = await openDb();
            const value = await requestValue(db.transaction(name, 'readonly').objectStore(name).get(key));
            return { exists: value !== undefined, data: () => value };
          },
          async delete() { await remove(name, key); }
        };
      },
      onSnapshot(callback, onError) {
        let set = listeners.get(name);
        if (!set) listeners.set(name, set = new Set());
        set.add(callback);
        (async () => {
          let records = await readAll(name);
          if (name === 'order_map' && records.length === 0) {
            let legacy = {};
            try { legacy = JSON.parse(localStorage.getItem('so_wip_order_map') || '{}') || {}; } catch {}
            for (const [from, to] of Object.entries(legacy)) {
              if (from && to) await write(name, 'm_' + encodeURIComponent(from).replace(/%/g, '_'), { from, to });
            }
            records = await readAll(name);
          }
          callback(snapshot(records));
        })().catch(error => { if (onError) onError(error); });
        return () => set.delete(callback);
      }
    };
  }

  const assets = {
    async upload(blob) {
      const id = 'a_' + crypto.randomUUID();
      await write('assets', id, blob);
      return { id };
    },
    async get(id) {
      const db = await openDb();
      return requestValue(db.transaction('assets', 'readonly').objectStore('assets').get(id));
    }
  };
  const downloads = {
    async save({ filename, data }) {
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  window.claude = {
    async use(service) {
      if (service === 'db') return { collection };
      if (service === 'assets') return assets;
      if (service === 'downloads') return downloads;
      return null;
    }
  };

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    try {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      const marker = '/_blob/';
      const at = url.pathname.indexOf(marker);
      if (at >= 0) {
        const id = decodeURIComponent(url.pathname.slice(at + marker.length));
        const blob = await assets.get(id);
        if (blob) return new Response(await blob.text(), { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
    } catch {}
    return nativeFetch(input, init);
  };
})();
