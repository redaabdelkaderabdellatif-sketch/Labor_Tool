/* Arabic label for the existing New System parent tab. */
(function () {
  if (typeof moduleTabsHtml !== 'function') return;
  const original = moduleTabsHtml;
  moduleTabsHtml = function (active) {
    const html = original(active);
    if (typeof STATE !== 'undefined' && STATE.lang !== 'en') {
      return html.replace('>New System</button>', '>السيستم الجديد</button>');
    }
    return html;
  };
  if (typeof render === 'function') render();
})();
