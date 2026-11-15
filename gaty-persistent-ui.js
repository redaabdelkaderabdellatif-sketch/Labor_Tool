/* Persistent local workbook archive and editable upload/download copy. */
(function () {
  'use strict';
  if (window.__gatyPersistentUiInstalled) return;
  window.__gatyPersistentUiInstalled = true;

  var DB_NAME = 'gaty-persistent-workbooks-v1';
  var DB_VERSION = 1;
  var OVERRIDES_KEY = 'gaty_ui_text_overrides_v1';
  var dbPromise = null;
  var restoring = new WeakSet();
  var restorePending = new WeakSet();
  var editMode = false;
  var observerTimers = new WeakMap();

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
      req.onerror = function () { reject(req.error || new Error('IndexedDB unavailable')); };
    });
    return dbPromise;
  }
  function waitForTransaction(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('Storage transaction failed')); };
      tx.onabort = function () { reject(tx.error || new Error('Storage transaction aborted')); };
    });
  }
  function pageScope(doc) {
    var win = doc.defaultView;
    var path = '';
    var href = '';
    try { href = win.location.href; path = win.location.pathname; } catch (_) {}
    if (href.indexOf('about:srcdoc') === 0 || href === 'about:blank') {
      try {
        var frame = win.frameElement;
        if (frame) return 'srcdoc:' + (frame.id || frame.getAttribute('title') || 'frame');
      } catch (_) {}
    }
    if (path) return path;
    try {
      var frame = win.frameElement;
      if (frame) return 'srcdoc:' + (frame.id || frame.getAttribute('title') || 'frame');
    } catch (_) {}
    return location.pathname;
  }
  function inputKey(input, index, doc) {
    return pageScope(doc) + '::input:' + (input.id ? 'id=' + input.id :
      input.name ? 'name=' + input.name : 'index=' + index);
  }
  function fileInputs(doc) {
    return Array.prototype.slice.call(doc.querySelectorAll('input[type="file"]'));
  }
  function status(doc, message, error) {
    var box = doc.getElementById('gaty-persist-status');
    if (!box) return;
    box.textContent = message;
    box.style.color = error ? '#b42332' : '#157347';
    if (!error) setTimeout(function () {
      if (box.textContent === message) box.textContent = 'حفظ الملفات تلقائيًا';
    }, 5000);
  }
  function asFile(entry) {
    return new File([entry.blob], entry.name || 'workbook.xlsx', {
      type: entry.type || 'application/octet-stream',
      lastModified: entry.lastModified || Date.now()
    });
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
  function setInputFiles(input, entries) {
    if (!entries || !entries.length) return false;
    try {
      var transfer = new DataTransfer();
      entries.forEach(function (entry) { transfer.items.add(asFile(entry)); });
      input.files = transfer.files;
      restoring.add(input);
      setTimeout(function () {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        setTimeout(function () { restoring.delete(input); }, 1000);
      }, 0);
      return true;
    } catch (error) {
      status(input.ownerDocument, 'تعذر استعادة ملف محفوظ: ' + error.message, true);
      return false;
    }
  }
  function restoreInputs(doc) {
    var inputs = fileInputs(doc);
    inputs.forEach(function (input, index) {
      if ((input.files && input.files.length) || restorePending.has(input)) return;
      var slotKey = inputKey(input, index, doc);
      restorePending.add(input);
      latestFor(slotKey).then(function (record) {
        if (!record || !record.files || !record.files.length || !input.isConnected) return;
        setInputFiles(input, record.files);
        status(doc, 'استُعيد الملف: ' + record.files.map(function (file) { return file.name; }).join('، '));
      }).catch(function (error) {
        status(doc, 'تعذر فتح أرشيف الملفات: ' + error.message, true);
      }).finally(function () { restorePending.delete(input); });
    });
  }
  function saveInput(input) {
    if (restoring.has(input) || !input.files || !input.files.length) return;
    var doc = input.ownerDocument;
    var list = Array.prototype.slice.call(input.files);
    var index = fileInputs(doc).indexOf(input);
    var slotKey = inputKey(input, index < 0 ? 0 : index, doc);
    var record = {
      id: 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2),
      slotKey: slotKey,
      page: pageScope(doc),
      pageTitle: doc.title || doc.querySelector('h1,h2')?.textContent?.trim() || 'Gaty',
      inputId: input.id || '',
      label: associatedLabel(input),
      savedAt: Date.now(),
      files: list.map(function (file) {
        return { name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, blob: file };
      })
    };
    openDb().then(function (db) {
      var tx = db.transaction(['uploads', 'slots'], 'readwrite');
      tx.objectStore('uploads').add(record);
      tx.objectStore('slots').put({ slotKey: slotKey, uploadId: record.id });
      return waitForTransaction(tx);
    }).then(function () {
      status(doc, 'تم حفظ ' + list.map(function (file) { return file.name; }).join('، '));
    }).catch(function (error) {
      status(doc, 'لم يتم حفظ الملف: ' + error.message, true);
    });
  }
  function associatedLabel(input) {
    var label = input.id && input.ownerDocument.querySelector('label[for="' + input.id.replace(/"/g, '\\"') + '"]');
    if (label) return label.textContent.trim().slice(0, 160);
    var zone = uploadZone(input);
    return zone ? (zone.querySelector('strong,.upload-label,h2,h3') || zone).textContent.trim().slice(0, 160) : (input.id || input.name || 'ملف');
  }

  function uploadZone(input) {
    var node = input;
    for (var n = 0; node && n < 8; n++, node = node.parentElement) {
      var cls = String(node.className || '');
      if (node.tagName === 'LABEL' || /upload|drop|file[-_ ]?(zone|card|area)/i.test(cls)) return node;
    }
    return input.parentElement || input.ownerDocument.body;
  }
  function uiLanguage(doc) {
    return (doc.documentElement && doc.documentElement.lang) || 'ar';
  }
  function authenticatedForTools() {
    try {
      var stamp = Number(localStorage.getItem('gaty_apps_gate') || 0);
      return stamp > 0 && Date.now() - stamp < 3600000;
    } catch (_) { return false; }
  }
  function overrides() {
    try {
      var value = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (_) { return {}; }
  }
  function directTextNodes(el) {
    return Array.prototype.filter.call(el.childNodes, function (node) {
      return node.nodeType === 3 && node.nodeValue.trim();
    });
  }
  function setDirectText(el, value) {
    var nodes = directTextNodes(el);
    if (nodes.length) {
      nodes[0].nodeValue = ' ' + value + ' ';
      for (var i = 1; i < nodes.length; i++) nodes[i].nodeValue = '';
    } else if (!el.children.length) el.textContent = value;
  }
  function isDynamicText(el, text) {
    var marker = (el.id + ' ' + el.className + ' ' + (el.getAttribute('aria-live') || '')).toLowerCase();
    return /filename|file-name|file_name|status|error|rows|count|badge|result|total|progress|saved|persist/i.test(marker) ||
      /^[✓✔✅❌⚠]/.test(text.trim()) || text.trim().length > 260;
  }
  function textCandidates(doc) {
    var results = [];
    var seen = new WeakSet();
    var inputs = fileInputs(doc);
    inputs.forEach(function (input, index) {
      var zone = uploadZone(input);
      var candidateIndex = 0;
      var nodes = zone.querySelectorAll('strong,span,p,small,label,h1,h2,h3,h4,button,a,div');
      Array.prototype.forEach.call(nodes, function (el) {
        if (el === zone || el.contains(input) || seen.has(el)) return;
        var text = el.textContent.trim();
        if (!text || isDynamicText(el, text)) return;
        var direct = directTextNodes(el);
        if (!direct.length && el.children.length) return;
        if (el.matches('button,a') && /download|export|تحميل|تنزيل|excel|اكسل/i.test(text)) return;
        seen.add(el);
        results.push({ el: el, key: pageScope(doc) + '|lang:' + uiLanguage(doc) + '|upload:' + inputKey(input, index, doc) + '|text:' + candidateIndex++ });
      });
    });
    var downloads = Array.prototype.slice.call(doc.querySelectorAll('button,a[download],a[href]')).filter(function (el) {
      var text = el.textContent.trim();
      return !isDynamicText(el, text) && (el.hasAttribute('download') || /download|export|تحميل|تنزيل|مستر شيت|excel|اكسل/i.test(text));
    });
    downloads.forEach(function (el, index) {
      var nodes = el.querySelectorAll('span,strong');
      var target = directTextNodes(el).length ? el : (nodes.length ? nodes[nodes.length - 1] : el);
      var key = pageScope(doc) + '|lang:' + uiLanguage(doc) + '|download:' + (el.id || el.getAttribute('data-action') || index);
      if (!seen.has(target)) {
        seen.add(target);
        results.push({ el: target, key: key });
      }
    });
    return results;
  }
  function applyOverrides(doc) {
    var saved = overrides();
    textCandidates(doc).forEach(function (item) {
      if (Object.prototype.hasOwnProperty.call(saved, item.key)) setDirectText(item.el, saved[item.key]);
    });
  }
  function markEditTargets(doc) {
    doc.querySelectorAll('[data-gaty-edit-target]').forEach(function (el) {
      el.removeAttribute('data-gaty-edit-target');
    });
    if (!editMode) return;
    textCandidates(doc).forEach(function (item) {
      item.el.setAttribute('data-gaty-edit-target', '1');
    });
  }
  function startEdit(item, event, doc) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    var existing = item.el.textContent.trim();
    var next = prompt('اكتب الاسم أو الوصف الجديد:', existing);
    if (next === null) return;
    var saved = overrides();
    saved[item.key] = next.trim();
    try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(saved)); }
    catch (error) { status(doc, 'تعذر حفظ النص: ' + error.message, true); return; }
    setDirectText(item.el, next.trim());
  }

  function installStyles(doc) {
    if (doc.getElementById('gaty-persist-style')) return;
    var style = doc.createElement('style');
    style.id = 'gaty-persist-style';
    style.textContent = '#gaty-persist-tools{position:fixed;z-index:2147483646;left:10px;bottom:10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 20px);font:12px Arial,sans-serif}#gaty-persist-tools button{border:1px solid #714b67;border-radius:7px;background:#714b67;color:#fff;padding:7px 10px;cursor:pointer}[data-gaty-edit-target="1"]{outline:2px dashed #714b67;cursor:text}[data-gaty-edit-target="1"]:hover{background:#f4edf3!important}#gaty-persist-status{background:#fff;border:1px solid #ddd;border-radius:7px;padding:6px 8px;max-width:260px;box-shadow:0 2px 8px #0002}[data-gaty-edit-target="1"]:hover{background:#f4edf3!important}#gaty-persist-modal{position:fixed;inset:0;z-index:2147483647;background:#0006;display:none;align-items:center;justify-content:center;padding:16px;font:14px Arial,sans-serif}#gaty-persist-modal.open{display:flex}#gaty-persist-modal .gaty-panel{background:#fff;color:#222;width:min(760px,100%);max-height:85vh;overflow:auto;border-radius:12px;padding:16px;box-shadow:0 8px 32px #0003}#gaty-persist-modal h2{margin:0 0 12px}#gaty-persist-modal .gaty-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid #eee}#gaty-persist-modal .gaty-row button{background:#fff;color:#714b67}';
    (doc.head || doc.documentElement).appendChild(style);
  }
  function getRecords() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('uploads', 'readonly');
        var cursor = tx.objectStore('uploads').index('savedAt').openCursor(null, 'prev');
        var records = [];
        cursor.onsuccess = function () {
          var item = cursor.result;
          if (item && records.length < 100) {
            records.push(item.value);
            item.continue();
          } else resolve(records);
        };
        cursor.onerror = function () { reject(cursor.error); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function restoreRecord(record, doc) {
    return openDb().then(function (db) {
      var tx = db.transaction('slots', 'readwrite');
      tx.objectStore('slots').put({ slotKey: record.slotKey, uploadId: record.id });
      return waitForTransaction(tx);
    }).then(function () {
      var found = fileInputs(doc).find(function (input, index) { return inputKey(input, index, doc) === record.slotKey; });
      if (found) setInputFiles(found, record.files);
      else status(doc, 'تم اختيار الملف للاستعادة عند فتح تبويبه.');
      renderSavedList(doc);
    });
  }
  function renderSavedList(doc) {
    var list = doc.getElementById('gaty-persist-list');
    if (!list) return;
    list.textContent = 'جارٍ تحميل الملفات...';
    getRecords().then(function (records) {
      list.textContent = '';
      if (!records.length) { list.textContent = 'لا توجد ملفات محفوظة بعد.'; return; }
      records.slice(0, 100).forEach(function (record) {
        var names = record.files.map(function (file) { return file.name; }).join('، ');
        var date = new Date(record.savedAt).toLocaleString();
        var label = (record.pageTitle || record.page || 'Gaty') + ' — ' + (record.label || record.inputId || 'ملف');
        var row = doc.createElement('div');
        row.className = 'gaty-row';
        var description = doc.createElement('span');
        description.textContent = label + ' — ' + names + ' — ' + date;
        var restore = doc.createElement('button');
        restore.type = 'button';
        restore.textContent = 'استعادة';
        restore.addEventListener('click', function () {
          restoreRecord(record, doc).catch(function (error) {
            status(doc, 'تعذرت الاستعادة: ' + error.message, true);
          });
        });
        row.appendChild(description);
        row.appendChild(restore);
        list.appendChild(row);
      });
    }).catch(function (error) { list.textContent = 'تعذر قراءة الملفات: ' + error.message; });
  }
  function addToolbar(doc) {
    if (doc.getElementById('gaty-persist-tools') || !doc.body) return;
    installStyles(doc);
    var bar = doc.createElement('div');
    bar.id = 'gaty-persist-tools';
    var edit = doc.createElement('button');
    edit.type = 'button';
    edit.textContent = 'تعديل أسماء وأوصاف';
    var saved = doc.createElement('button');
    saved.type = 'button';
    saved.textContent = 'الملفات المحفوظة';
    var label = doc.createElement('span');
    label.id = 'gaty-persist-status';
    label.textContent = 'حفظ الملفات تلقائيًا';
    bar.appendChild(edit); bar.appendChild(saved); bar.appendChild(label);
    doc.body.appendChild(bar);
    var modal = doc.createElement('div');
    modal.id = 'gaty-persist-modal';
    modal.innerHTML = '<div class="gaty-panel"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2>الملفات المحفوظة</h2><button type="button" id="gaty-persist-close">إغلاق</button></div><p>تُحفظ النسخ في هذا المتصفح ولا تُحذف عند تغيير التبويب. كل رفع جديد يُضاف إلى الأرشيف.</p><div id="gaty-persist-list"></div></div>';
    doc.body.appendChild(modal);
    modal.querySelector('#gaty-persist-close').addEventListener('click', function () { modal.classList.remove('open'); });
    modal.addEventListener('click', function (event) { if (event.target === modal) modal.classList.remove('open'); });
    edit.addEventListener('click', function () {
      editMode = !editMode;
      edit.textContent = editMode ? 'إنهاء التعديل' : 'تعديل أسماء وأوصاف';
      markEditTargets(doc);
    });
    saved.addEventListener('click', function () { modal.classList.add('open'); renderSavedList(doc); });
    doc.addEventListener('click', function (event) {
      if (!editMode || event.target.closest('#gaty-persist-tools,#gaty-persist-modal')) return;
      var item = textCandidates(doc).find(function (candidate) { return candidate.el === event.target || candidate.el.contains(event.target); });
      if (item) startEdit(item, event, doc);
    }, true);
  }
  function scheduleRefresh(doc) {
    if (observerTimers.has(doc)) clearTimeout(observerTimers.get(doc));
    observerTimers.set(doc, setTimeout(function () {
      observerTimers.delete(doc);
      applyOverrides(doc);
      markEditTargets(doc);
      restoreInputs(doc);
    }, 120));
  }
  function initDocument(doc) {
    if (!doc || !doc.defaultView || doc.defaultView.__gatyPersistentUiInstalled) return;
    doc.defaultView.__gatyPersistentUiInstalled = true;
    if (!doc.body) {
      doc.addEventListener('DOMContentLoaded', function () { initReadyDocument(doc); }, { once: true });
      return;
    }
    initReadyDocument(doc);
  }
  function initReadyDocument(doc) {
    if (!doc || doc.__gatyPersistentUiReady) return;
    doc.__gatyPersistentUiReady = true;
    if (authenticatedForTools()) addToolbar(doc);
    doc.addEventListener('change', function (event) {
      if (event.target && event.target.matches && event.target.matches('input[type="file"]')) saveInput(event.target);
    }, true);
    applyOverrides(doc);
    setTimeout(function () { restoreInputs(doc); }, 500);
    if (doc.defaultView && doc.defaultView.navigator.storage && doc.defaultView.navigator.storage.persist) {
      doc.defaultView.navigator.storage.persist().catch(function () {});
    }
    var mutation = new MutationObserver(function () { scheduleRefresh(doc); });
    mutation.observe(doc.documentElement, { childList: true, subtree: true });
    Array.prototype.forEach.call(doc.querySelectorAll('iframe'), function (frame) {
      frame.addEventListener('load', function () { try { initDocument(frame.contentDocument); } catch (_) {} });
      try { if (frame.contentDocument && frame.contentDocument.readyState !== 'loading') initDocument(frame.contentDocument); } catch (_) {}
    });
  }

  initDocument(document);
  var outerObserver = new MutationObserver(function () {
    document.querySelectorAll('iframe').forEach(function (frame) {
      try {
        var child = frame.contentDocument;
        if (child && child.defaultView && !child.defaultView.__gatyPersistentUiInstalled) initDocument(child);
      } catch (_) {}
    });
  });
  outerObserver.observe(document.documentElement, { childList: true, subtree: true });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  window.addEventListener('pageshow', function () { setTimeout(function () { restoreInputs(document); }, 500); });
})();
