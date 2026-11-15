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
  const SHARED_CORRECTIONS_KEY = 'gaty_inventory_cost_reference_corrections_v1';
  const normCorrection = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').trim().toUpperCase();
  const correctionDocId = wrong => 'm_' + encodeURIComponent(String(wrong ?? '')).replace(/%/g, '_');
  function readSharedCorrections() {
    try {
      const value = JSON.parse(localStorage.getItem(SHARED_CORRECTIONS_KEY) || '[]');
      return Array.isArray(value) ? value.filter(item => item && String(item.wrong || '').trim() && String(item.correct || '').trim()) : [];
    } catch { return []; }
  }
  function writeSharedCorrections(value) {
    localStorage.setItem(SHARED_CORRECTIONS_KEY, JSON.stringify(value));
    try { window.dispatchEvent(new CustomEvent('gaty-reference-corrections-updated')); } catch {}
  }
  async function readSharedMapRecords(migrate) {
    let corrections = readSharedCorrections();
    if (migrate) {
      const addOld = (wrong, correct) => {
        wrong = String(wrong ?? '').trim();
        correct = String(correct ?? '').trim();
        if (!wrong || !correct || corrections.some(item => normCorrection(item.wrong) === normCorrection(wrong))) return;
        corrections.push({ wrong, correct });
      };
      try {
        const legacy = JSON.parse(localStorage.getItem('so_wip_order_map') || '{}');
        if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
          Object.entries(legacy).forEach(([wrong, correct]) => addOld(wrong, correct));
        }
      } catch {}
      try {
        (await readAll('order_map')).forEach(item => addOld(item.value && item.value.from, item.value && item.value.to));
      } catch {}
      const before = JSON.stringify(readSharedCorrections());
      if (JSON.stringify(corrections) !== before) {
        try { writeSharedCorrections(corrections); } catch {}
      }
    }
    return corrections.map(item => ({ id: correctionDocId(item.wrong), value: { from: item.wrong, to: item.correct } }));
  }
  async function notify(name) {
    const set = listeners.get(name);
    if (!set || !set.size) return;
    const records = name === 'order_map' ? await readSharedMapRecords(false) : await readAll(name);
    set.forEach(callback => callback(snapshot(records)));
  }
  function collection(name) {
    return {
      doc(id) {
        const key = id || ('d_' + crypto.randomUUID());
        return {
          async set(value) {
            if (name !== 'order_map') return write(name, key, value);
            const corrections = readSharedCorrections();
            const from = String(value && value.from || '').trim();
            const to = String(value && value.to || '').trim();
            if (!from || !to) return;
            const index = corrections.findIndex(item => normCorrection(item.wrong) === normCorrection(from));
            if (index >= 0) corrections[index] = { wrong: corrections[index].wrong, correct: to };
            else corrections.push({ wrong: from, correct: to });
            writeSharedCorrections(corrections);
            await notify(name);
          },
          async get() {
            if (name === 'order_map') {
              const records = await readSharedMapRecords(false);
              const found = records.find(item => item.id === key);
              return { exists: !!found, data: () => found && found.value };
            }
            const db = await openDb();
            const value = await requestValue(db.transaction(name, 'readonly').objectStore(name).get(key));
            return { exists: value !== undefined, data: () => value };
          },
          async delete() {
            if (name !== 'order_map') return remove(name, key);
            const corrections = readSharedCorrections().filter(item => correctionDocId(item.wrong) !== key);
            writeSharedCorrections(corrections);
            await notify(name);
          }
        };
      },
      onSnapshot(callback, onError) {
        let set = listeners.get(name);
        if (!set) listeners.set(name, set = new Set());
        set.add(callback);
        let active = true;
        const deliver = () => {
          const task = name === 'order_map' ? readSharedMapRecords(true) : readAll(name);
          task.then(records => { if (active) callback(snapshot(records)); }).catch(error => { if (active && onError) onError(error); });
        };
        const storageListener = event => {
          if (name === 'order_map' && (!event.key || event.key === SHARED_CORRECTIONS_KEY)) deliver();
        };
        if (name === 'order_map') {
          window.addEventListener('storage', storageListener);
          window.addEventListener('gaty-reference-corrections-updated', storageListener);
        }
        deliver();
        return () => {
          active = false;
          set.delete(callback);
          if (name === 'order_map') {
            window.removeEventListener('storage', storageListener);
            window.removeEventListener('gaty-reference-corrections-updated', storageListener);
          }
        };
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
