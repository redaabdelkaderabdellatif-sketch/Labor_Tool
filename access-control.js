/* Per-module user access UI. Authentication and password hashing are handled by Apps Script. */
(function () {
  const MODULES = [
    ["raw", "Raw Materials", "الخامات"],
    ["uncosted", "Uncosted", "لم يتم التكلفة"],
    ["cost", "Inventory Cost", "تكلفة المخزون"],
    ["movement", "Item Movement", "حركة الأصناف"],
    ["suppliers", "Suppliers", "الموردون"],
    ["stock", "Inventory", "المخزون"],
    ["accounting", "Accounting", "المحاسبة"],
    ["invaccounting", "Purchasing & Warehouses", "المشتريات والمخازن"]
  ];
  const moduleNames = Object.fromEntries(MODULES.map(([id, en, ar]) => [id, STATE.lang === "en" ? en : ar]));
  const allowed = () => STATE.role === "admin" ? MODULES.map(x => x[0]) : (STATE.allowedModules || []);
  const canOpen = id => STATE.role === "admin" || (STATE.role === "app_user" && allowed().includes(id));

  const oldSyncModuleGate = syncModuleGate;
  syncModuleGate = function () {
    if (STATE.password && (STATE.role === "admin" || STATE.role === "app_user")) {
      localStorage.setItem("gaty_apps_gate", String(Date.now()));
      localStorage.setItem("gaty_apps_scope", JSON.stringify(allowed()));
    } else {
      localStorage.removeItem("gaty_apps_gate");
      localStorage.removeItem("gaty_apps_scope");
    }
  };
  const oldSaveLocal = saveLocal;
  saveLocal = function () {
    if (STATE.role === "app_user") {
      localStorage.removeItem("warsha_pw3");
      syncModuleGate();
      return;
    }
    oldSaveLocal();
  };
  const oldClearLocal = clearLocal;
  clearLocal = function () {
    oldClearLocal();
    localStorage.removeItem("gaty_apps_scope");
  };
  const oldApplyLoginData = applyLoginData;
  applyLoginData = function (data) {
    oldApplyLoginData(data);
    STATE.allowedModules = Array.isArray(data.allowedModules) ? data.allowedModules : [];
    STATE.username = data.username || USER_INPUT || "";
  };

  USER_INPUT = "";
  STATE.allowedModules = [];
  STATE.username = "";
  const oldAuthScreen = renderAuthScreen;
  renderAuthScreen = function () {
    const html = oldAuthScreen();
    return html.replace('<form id="pwForm">', '<form id="pwForm"><input type="text" class="input" style="text-align:center;font-size:16px;margin-bottom:10px;" placeholder="اسم المستخدم (اتركه فارغًا لحسابات النظام)" value="' + esc(USER_INPUT) + '" oninput="USER_INPUT=this.value">');
  };
  handlePasswordSubmit = async function (event) {
    event.preventDefault();
    STATE.authError = "";
    if (!PW_INPUT) { STATE.authError = t("enterPassword"); render(); return; }
    const btn = document.getElementById("pwSubmitBtn");
    if (btn) { btn.disabled = true; btn.innerText = t("loggingIn"); }
    try {
      const data = USER_INPUT.trim()
        ? await moduleAccessApi("getData", { password: PW_INPUT, username: USER_INPUT.trim() })
        : await apiCall("getData", { password: PW_INPUT });
      if (!data.ok) {
        STATE.authError = t("wrongPassword");
        if (btn) { btn.disabled = false; btn.innerText = t("loginBtn"); }
        render();
        return;
      }
      STATE.password = PW_INPUT;
      STATE.username = USER_INPUT.trim();
      applyLoginData(data);
      saveLocal();
      saveCache();
      render();
    } catch (error) {
      STATE.authError = t("connectionError");
      if (btn) { btn.disabled = false; btn.innerText = t("loginBtn"); }
      render();
    }
  };

  moduleTabsHtml = function (active) {
    const items = [
      ["labor", "Gaty Cost"], ["raw", t("appRawMaterials")],
      ["uncosted", STATE.lang === "en" ? "Uncosted" : "لم يتم التكلفة"],
      ["cost", t("appTransferCost")], ["movement", STATE.lang === "en" ? "Item Movement" : "حركة الأصناف"],
      ["suppliers", STATE.lang === "en" ? "Suppliers" : "الموردون"], ["stock", STATE.lang === "en" ? "Inventory" : "المخزون"],
      ["accounting", STATE.lang === "en" ? "Accounting" : "المحاسبة"], ["invaccounting", STATE.lang === "en" ? "Purchasing & Warehouses" : "المشتريات والمخازن"]
    ].filter(([id]) => STATE.role === "admin" || canOpen(id));
    return `<nav class="gaty-module-tabs" aria-label="Gaty Cost modules">${items.map(([id, label]) => `<button type="button" class="${active === id ? "active" : ""}" ${active === id ? 'aria-current="page"' : ""} onclick="selectModuleTab('${id}')">${label}</button>`).join("")}</nav>`;
  };

  const oldSelectModuleTab = selectModuleTab;
  selectModuleTab = function (name) {
    if (STATE.role === "admin") return oldSelectModuleTab(name);
    if (!STATE.password || !canOpen(name)) return;
    STATE.section = "module:" + name;
    syncModuleGate();
    render();
  };

  async function moduleAccessApi(action, data) {
    const response = await fetch(CONFIG.SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...data, action })
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }

  function renderAccessPanel(moduleId) {
    const users = (STATE.settings.appUsers || []).filter(u => (u.allowedModules || []).includes(moduleId));
    const rows = users.map(u => `<li class="list-item"><span>${esc(u.name || u.username)} <small>(${esc(u.username)}) · ${u.active === false ? "معطل" : "فعال"}</small></span><span class="list-item-actions"><button class="small-edit" onclick="toggleModuleUser('${esc(u.id)}',${u.active === false ? "true" : "false"})">${u.active === false ? "تفعيل" : "تعطيل"}</button><button class="small-delete" onclick="revokeModuleUser('${esc(u.id)}','${moduleId}')">إزالة من التبويب</button></span></li>`).join("");
    return `<section class="card" style="margin:12px 0;"><h2 class="card-title">إدارة دخول ${esc(moduleNames[moduleId] || moduleId)}</h2><p style="color:var(--muted);margin:0 0 10px;">أضف مستخدمًا لهذا التبويب فقط. يمكن تكرار اسم المستخدم في تبويب آخر لإضافة صلاحية أخرى.</p>${STATE.error ? `<div class="error-banner">${esc(STATE.error)}</div>` : ""}<ul class="list">${rows || '<li class="list-item">لا يوجد مستخدمون لهذا التبويب</li>'}</ul><div class="grid2" style="margin-top:12px;"><input class="input" id="accessUsername" placeholder="اسم المستخدم"><input class="input" id="accessName" placeholder="الاسم الظاهر"><input class="input" type="password" id="accessPassword" placeholder="كلمة المرور (4 أحرف على الأقل)"></div><button class="add-btn" style="width:100%;margin-top:10px;" onclick="saveModuleUser('${moduleId}')">حفظ صلاحية التبويب</button></section>`;
  }

  const oldRenderModuleScreen = renderModuleScreen;
  renderModuleScreen = function () {
    if (STATE.role !== "app_user") {
      const html = oldRenderModuleScreen();
      if (STATE.role === "admin" && STATE.section && STATE.section.startsWith("module:")) {
        const id = STATE.section.slice(7);
        if (MODULES.some(x => x[0] === id)) return html.replace('<iframe id="gaty-module-frame"', renderAccessPanel(id) + '<iframe id="gaty-module-frame"');
      }
      return html;
    }
    const key = String(STATE.section || "").slice(7);
    if (!canOpen(key) || !MODULES.some(x => x[0] === key)) { STATE.section = null; return renderDashboardScreen(); }
    const titles = { raw: "Raw Materials", uncosted: "Uncosted", cost: t("appTransferCost"), movement: "Item Movement", suppliers: "Suppliers", stock: "Inventory", accounting: "Accounting System", invaccounting: "Purchasing & Warehouses" };
    return `<div class="header"><div class="header-inner"><div class="header-left"><h1 class="title">${esc(appName())}</h1><span>${esc(STATE.name)}</span></div><div style="display:flex;align-items:center;gap:10px;">${langSwitcherHtml()}<button class="logout-btn" onclick="backToDashboard()">${t("backToDashboard")}</button><button class="logout-btn" onclick="logout()">${t("logoutBtn")}</button></div></div></div>${moduleTabsHtml(key)}<main style="padding:0 12px 18px;"><iframe id="gaty-module-frame" class="gaty-module-frame" title="${titles[key] || key}" loading="eager"></iframe></main>`;
  };
  const oldRenderRawMaterialsScreen = renderRawMaterialsScreen;
  renderRawMaterialsScreen = function () {
    const html = oldRenderRawMaterialsScreen();
    return STATE.role === "admin" ? html.replace("<main>", `<main>${renderAccessPanel("raw")}`) : html;
  };
  const oldDashboard = renderDashboardScreen;
  renderDashboardScreen = function () {
    if (STATE.role !== "app_user") return oldDashboard();
    return `<div class="header"><div class="header-inner"><div class="header-left"><h1 class="title">${esc(appName())}</h1><span>${esc(STATE.name)}</span></div><div style="display:flex;align-items:center;gap:10px;">${langSwitcherHtml()}<button class="logout-btn" onclick="logout()">${t("logoutBtn")}</button></div></div></div><main>${moduleTabsHtml("")}<div class="card" style="max-width:700px;margin:28px auto;text-align:center;padding:36px 20px;"><h2 class="card-title">${STATE.lang === "en" ? "Your authorized tabs" : "التبويبات المسموح بها"}</h2><p style="color:var(--muted);">${STATE.lang === "en" ? "Choose an authorized tab above." : "اختر أحد التبويبات المسموح بها أعلاه."}</p></div></main>`;
  };
  const oldRender = render;
  render = function () {
    if (STATE.booted && STATE.role === "app_user" && !STATE.section && !STATE.loading) {
      document.getElementById("app").innerHTML = renderDashboardScreen();
      return;
    }
    oldRender();
  };

  saveModuleUser = async function (moduleId) {
    const username = document.getElementById("accessUsername").value.trim();
    const name = document.getElementById("accessName").value.trim();
    const password = document.getElementById("accessPassword").value;
    if (!username || !password || password.length < 4) { alert("اكتب اسم المستخدم وكلمة مرور من 4 أحرف على الأقل"); return; }
    const users = (STATE.settings.appUsers || []).map(u => ({ ...u, allowedModules: [...(u.allowedModules || [])] }));
    let user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user) { user = { id: crypto.randomUUID(), username, name: name || username, allowedModules: [], active: true }; users.push(user); }
    user.name = name || user.name || username;
    if (!user.allowedModules.includes(moduleId)) user.allowedModules.push(moduleId);
    user.password = password;
    await saveModuleUsers(users);
  };
  toggleModuleUser = function (id, active) {
    const users = (STATE.settings.appUsers || []).map(u => u.id === id ? { ...u, active } : u);
    saveModuleUsers(users);
  };
  revokeModuleUser = function (id, moduleId) {
    const users = (STATE.settings.appUsers || []).map(u => ({ ...u, allowedModules: (u.allowedModules || []).filter(m => m !== moduleId) })).filter(u => u.id !== id || u.allowedModules.length);
    saveModuleUsers(users);
  };
  async function saveModuleUsers(users) {
    STATE.error = "";
    const settings = { ...STATE.settings, appUsers: users };
    STATE.settings = settings;
    render();
    try {
      const result = await moduleAccessApi("saveSettings", { password: STATE.password, settings });
      if (!result.ok) throw new Error(result.error || "save failed");
      STATE.settings.appUsers = users.map(({ password, ...u }) => u);
      saveCache();
      render();
    } catch (error) {
      STATE.settings.appUsers = users.map(({ password, ...u }) => u);
      STATE.error = t("settingsSaveFailed");
      render();
    }
  }

  const allModuleIds = MODULES.map(x => x[0]);
  for (const [id, ,] of MODULES) {
    if (GATY_MODULE_DOCS[id]) {
      GATY_MODULE_DOCS[id] = GATY_MODULE_DOCS[id].replace('var ok = t && (Date.now() - Number(t) < 3600000);', `var scopes=JSON.parse(localStorage.getItem("gaty_apps_scope")||"[]"); var ok=t&&(Date.now()-Number(t)<3600000)&&scopes.includes("${id}");`);
    }
  }
  const oldBoot = boot;
  boot = async function () {
    await oldBoot();
    syncModuleGate();
  };
  render();
})();

