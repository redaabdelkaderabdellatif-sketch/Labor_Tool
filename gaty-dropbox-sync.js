/* Dropbox backup for the shared Gaty workbook archive. */
(function () {
  'use strict';
  if (window.__gatyDropboxBackupInstalled) return;
  window.__gatyDropboxBackupInstalled = true;

  var APP_KEY = 'v3yursqyxe6eiej';
  var REDIRECT_URI = 'https://gaty-reda-cost.redaabdelkaderabdellatif.workers.dev/';
  var WORKER = 'https://gaty-dropbox-storage.redaabdelkaderabdellatif.workers.dev';
  var DB_NAME = 'gaty-persistent-workbooks-v1';
  var DB_VERSION = 1;
  var AUTH_KEY = 'gaty_dropbox_auth_v1';
  var dbPromise;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('uploads')) {
          var uploads = db.createObjectStore('uploads', { keyPath: 'id' });
          uploads.createIndex('slotKey', 'slotKey', { unique: false });
          uploads.createIndex('savedAt', 'savedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('slots')) db.createObjectStore('slots', { keyPath: 'slotKey' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('تعذر فتح أرشيف الملفات')); };
    });
    return dbPromise;
  }
  function getAuth() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('slots', 'readonly');
        var req = tx.objectStore('slots').get(AUTH_KEY);
        req.onsuccess = function () { resolve(req.result && req.result.value || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }
  function setAuth(value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('slots', 'readwrite');
        tx.objectStore('slots').put({ slotKey: AUTH_KEY, value: value });
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error || new Error('تعذر حفظ اتصال Dropbox')); };
        tx.onabort = function () { reject(tx.error || new Error('تعذر حفظ اتصال Dropbox')); };
      });
    });
  }
  function allRecords() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('uploads', 'readonly');
        var req = tx.objectStore('uploads').openCursor();
        var records = [];
        req.onsuccess = function () {
          var cursor = req.result;
          if (!cursor) { resolve(records); return; }
          records.push(cursor.value);
          cursor.continue();
        };
        req.onerror = function () { reject(req.error); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function saveRecord(record) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('uploads', 'readwrite');
        tx.objectStore('uploads').put(record);
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error || new Error('تعذر تحديث سجل الملف')); };
        tx.onabort = function () { reject(tx.error || new Error('تعذر تحديث سجل الملف')); };
      });
    });
  }
  function status(doc, message, error) {
    var box = doc && doc.getElementById('gaty-persist-status');
    if (!box) return;
    box.textContent = message;
    box.style.color = error ? '#b42332' : '#157347';
  }
  function randomVerifier() {
    var bytes = new Uint8Array(64);
    crypto.getRandomValues(bytes);
    return base64url(bytes);
  }
  function base64url(bytes) {
    var binary = '';
    bytes.forEach(function (b) { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function randomState() {
    var bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return base64url(bytes);
  }
  function challenge(verifier) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (hash) {
      return base64url(new Uint8Array(hash));
    });
  }
  function connectDropbox(doc) {
    var verifier = randomVerifier();
    var state = randomState();
    sessionStorage.setItem('gaty_dropbox_verifier', verifier);
    sessionStorage.setItem('gaty_dropbox_state', state);
    challenge(verifier).then(function (codeChallenge) {
      var url = new URL('https://www.dropbox.com/oauth2/authorize');
      url.searchParams.set('client_id', APP_KEY);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('redirect_uri', REDIRECT_URI);
      url.searchParams.set('token_access_type', 'offline');
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('state', state);
      url.searchParams.set('scope', 'files.metadata.read files.content.read files.content.write');
      window.top.location.href = url.toString();
    }).catch(function (error) {
      status(doc, 'تعذر بدء ربط Dropbox: ' + error.message, true);
    });
  }
  function tokenRequest(params) {
    return fetch(WORKER + '/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString()
    }).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) throw new Error(data.error_description || data.error || 'تعذر تجديد صلاحية Dropbox');
        return data;
      });
    });
  }
  function finishOAuth(doc) {
    var params = new URLSearchParams(window.location.search);
    var code = params.get('code');
    var state = params.get('state');
    var error = params.get('error_description') || params.get('error');
    if (!code && !error) return;
    if (error) {
      history.replaceState({}, '', window.location.pathname + window.location.hash);
      status(doc, 'لم يكتمل ربط Dropbox: ' + error, true);
      return;
    }
    var savedState = sessionStorage.getItem('gaty_dropbox_state') || '';
    var verifier = sessionStorage.getItem('gaty_dropbox_verifier') || '';
    sessionStorage.removeItem('gaty_dropbox_state');
    sessionStorage.removeItem('gaty_dropbox_verifier');
    if (!state || state !== savedState || !verifier) {
      history.replaceState({}, '', window.location.pathname + window.location.hash);
      status(doc, 'تعذر التحقق من طلب ربط Dropbox. حاول الربط مرة أخرى.', true);
      return;
    }
    history.replaceState({}, '', window.location.pathname + window.location.hash);
    status(doc, 'جارٍ إكمال ربط Dropbox...');
    tokenRequest({ grant_type: 'authorization_code', code: code, code_verifier: verifier, redirect_uri: REDIRECT_URI })
      .then(function (data) {
        if (!data.access_token || !data.refresh_token) throw new Error('لم يرجع Dropbox رمز تحديث دائم');
        return setAuth({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: Date.now() + Number(data.expires_in || 14400) * 1000,
          accountId: data.account_id || '',
          connectedAt: Date.now()
        });
      })
      .then(function () {
        status(doc, 'تم ربط Dropbox. جارٍ حفظ الملفات السابقة...');
        return backupAll(doc);
      })
      .then(function (result) {
        status(doc, 'Dropbox متصل — تم حفظ ' + result.files + ' ملف');
        updateButtons(doc, true);
      })
      .catch(function (err) {
        status(doc, 'تعذر إكمال ربط Dropbox: ' + err.message, true);
        updateButtons(doc, false);
      });
  }
  function accessToken(forceRefresh) {
    return getAuth().then(function (auth) {
      if (!auth || !auth.refreshToken) throw new Error('اربط Dropbox أولًا من زر Dropbox');
      if (!forceRefresh && auth.accessToken && auth.expiresAt > Date.now() + 60000) return auth.accessToken;
      return tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refreshToken }).then(function (data) {
        auth.accessToken = data.access_token;
        auth.expiresAt = Date.now() + Number(data.expires_in || 14400) * 1000;
        return setAuth(auth).then(function () { return auth.accessToken; });
      });
    });
  }
  function safeName(value) {
    return String(value || 'workbook.xlsx').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150);
  }
  function backupOne(file, record, fileIndex, doc) {
    var suffix = String(record.savedAt || Date.now()) + '_' + String(fileIndex + 1).padStart(2, '0');
    var title = safeName(record.pageTitle || 'Gaty');
    var path = '/Gaty Cost Backups/' + title + '/' + suffix + '_' + safeName(file.name);
    function send(token, retried) {
      return fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': JSON.stringify({ path: path, mode: 'add', autorename: true, mute: true })
        },
        body: file
      }).then(function (response) {
        if (response.status === 401 && !retried) return accessToken(true).then(function (newToken) { return send(newToken, true); });
        return response.json().then(function (data) {
          if (!response.ok) throw new Error(data.error_summary || 'فشل رفع الملف إلى Dropbox');
          return data;
        });
      });
    }
    return accessToken(false).then(function (token) { return send(token, false); });
  }
  function backupRecord(record, doc) {
    if (!record || !record.files || !record.files.length) return Promise.resolve(0);
    record.dropboxBackups = record.dropboxBackups || {};
    var done = 0;
    return record.files.reduce(function (chain, entry, index) {
      var key = [entry.name, entry.size, entry.lastModified].join('|');
      if (record.dropboxBackups[key]) return chain;
      return chain.then(function () {
        var file = new File([entry.blob], entry.name || 'workbook.xlsx', {
          type: entry.type || 'application/octet-stream',
          lastModified: entry.lastModified || Date.now()
        });
        status(doc, 'جارٍ رفع ' + file.name + ' إلى Dropbox...');
        return backupOne(file, record, index, doc).then(function (metadata) {
          record.dropboxBackups[key] = { path: metadata.path_display || metadata.path_lower, id: metadata.id, savedAt: Date.now() };
          done++;
          return saveRecord(record);
        });
      });
    }, Promise.resolve()).then(function () { return done; });
  }
  function backupAll(doc) {
    return allRecords().then(function (records) {
      var total = 0;
      return records.reduce(function (chain, record) {
        return chain.then(function () { return backupRecord(record, doc).then(function (count) { total += count; }); });
      }, Promise.resolve()).then(function () { return { files: total, records: records.length }; });
    });
  }
  function makeSlotKey(input, index, doc) {
    var win = doc.defaultView, href = '', path = '';
    try { href = win.location.href; path = win.location.pathname; } catch (_) {}
    if (href.indexOf('about:srcdoc') === 0 || href === 'about:blank') {
      try {
        var frame = win.frameElement;
        if (frame) return 'srcdoc:' + (frame.id || 'frame') + ':' + (frame.getAttribute('title') || doc.title || '') + '::input:' + (input.id ? 'id=' + input.id : input.name ? 'name=' + input.name : 'index=' + index);
      } catch (_) {}
    }
    return (path || location.pathname) + '::input:' + (input.id ? 'id=' + input.id : input.name ? 'name=' + input.name : 'index=' + index);
  }
  function latestFor(slotKey) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(['slots', 'uploads'], 'readonly');
        var req = tx.objectStore('slots').get(slotKey);
        req.onsuccess = function () {
          var slot = req.result;
          if (!slot) { resolve(null); return; }
          var itemReq = tx.objectStore('uploads').get(slot.uploadId);
          itemReq.onsuccess = function () { resolve(itemReq.result || null); };
          itemReq.onerror = function () { reject(itemReq.error); };
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }
  function fileInputs(doc) {
    return Array.prototype.slice.call(doc.querySelectorAll('input[type="file"]'));
  }
  function install(doc) {
    if (!doc || !doc.body || doc.__gatyDropboxSyncReady) return;
    doc.__gatyDropboxSyncReady = true;
    if (doc === doc.defaultView.top.document) finishOAuth(doc);
    doc.addEventListener('change', function (event) {
      var input = event.target;
      if (!input || !input.matches || !input.matches('input[type="file"]')) return;
      var list = fileInputs(doc), index = list.indexOf(input);
      var slot = makeSlotKey(input, index < 0 ? 0 : index, doc);
      setTimeout(function () {
        latestFor(slot).then(function (record) {
          if (!record) return;
          getAuth().then(function (auth) {
            if (!auth || !auth.refreshToken) {
              status(doc, 'محفوظ محليًا فقط — اربط Dropbox للنسخة السحابية');
              return;
            }
            return backupRecord(record, doc).then(function (count) {
              if (count) status(doc, 'تم حفظ ' + count + ' ملف في Dropbox');
            });
          }).catch(function (err) { status(doc, 'تعذر النسخ إلى Dropbox: ' + err.message, true); });
        }).catch(function () {});
      }, 1400);
    }, true);
    var mo = new MutationObserver(function () { addButton(doc); });
    mo.observe(doc.documentElement, { childList: true, subtree: true });
    addButton(doc);
    getAuth().then(function (auth) { updateButtons(doc, !!(auth && auth.refreshToken)); }).catch(function () {});
  }
  function adminSession(doc) {
    try {
      var stamp = Number(doc.defaultView.localStorage.getItem('gaty_apps_gate') || 0);
      return stamp > 0 && Date.now() - stamp < 3600000;
    } catch (_) { return false; }
  }
  function addButton(doc) {
    var toolbar = doc.getElementById('gaty-persist-tools');
    if (!toolbar || toolbar.querySelector('#gaty-dropbox-button')) return;
    if (!adminSession(doc)) return;
    var button = doc.createElement('button');
    button.type = 'button';
    button.id = 'gaty-dropbox-button';
    button.textContent = 'ربط Dropbox';
    button.addEventListener('click', function () {
      getAuth().then(function (auth) {
        if (!auth || !auth.refreshToken) { connectDropbox(doc); return; }
        status(doc, 'جارٍ مزامنة الملفات مع Dropbox...');
        return backupAll(doc).then(function (result) {
          status(doc, 'Dropbox متصل — تم حفظ ' + result.files + ' ملف');
          updateButtons(doc, true);
        });
      }).catch(function (err) { status(doc, 'تعذر استخدام Dropbox: ' + err.message, true); });
    });
    toolbar.insertBefore(button, toolbar.querySelector('#gaty-persist-status'));
  }
  function updateButtons(doc, connected) {
    var button = doc.getElementById('gaty-dropbox-button');
    if (button) button.textContent = connected ? 'مزامنة Dropbox' : 'ربط Dropbox';
  }
  function scanDocs() {
    install(document);
    Array.prototype.forEach.call(document.querySelectorAll('iframe'), function (frame) {
      try { if (frame.contentDocument && frame.contentDocument.readyState !== 'loading') install(frame.contentDocument); } catch (_) {}
      frame.addEventListener('load', function () { try { install(frame.contentDocument); } catch (_) {} });
    });
  }
  scanDocs();
  new MutationObserver(scanDocs).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanDocs, { once: true });
})();