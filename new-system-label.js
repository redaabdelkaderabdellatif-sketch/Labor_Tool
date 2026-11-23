/* GATY NEW SYSTEM GROUPING V2
   Keep Accounting and Purchasing & Warehouses as children of New System. */
(function () {
  if (typeof moduleTabsHtml !== 'function') return;
  const originalTabs = moduleTabsHtml;
  moduleTabsHtml = function (active) {
    let html = originalTabs(active);
    const before = html;
    html = html
      .replace(/<button\b[^>]*onclick="selectModuleTab\('accounting'\)"[^>]*>[\s\S]*?<\/button>/g, '')
      .replace(/<button\b[^>]*onclick="selectModuleTab\('invaccounting'\)"[^>]*>[\s\S]*?<\/button>/g, '');
    if (html !== before) {
      const label = (typeof STATE !== 'undefined' && STATE.lang === 'en') ? 'New System' : 'السيستم الجديد';
      const selected = active === 'new-system' || active === 'accounting' || active === 'invaccounting';
      html = html.replace('</nav>', '<button type="button" class="' + (selected ? 'active' : '') + '" ' + (selected ? 'aria-current="page"' : '') + ' onclick="selectModuleTab(\'new-system\')">' + label + '</button></nav>');
    }
    return html;
  };
  if (typeof render === 'function') render();
})();
