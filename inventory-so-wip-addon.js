/* SO WIP Statement inventory subtab — isolated add-on */
(function () {
  'use strict';
  const docs = GATY_MODULE_DOCS;
  const html = docs && docs.stock;
  if (!html || html.includes('invtabbtn-wip-statement')) return;

  const wipButton = `<button class="tab-btn" id="invtabbtn-wip" onclick="switchInvTab('wip')"> Work In Process</button>`;
  const statementButton = `<button class="tab-btn" id="invtabbtn-wip-statement" onclick="switchInvTab('wip-statement')"> SO WIP statement</button>`;
  const finishedPanel = `<div id="invtab-finished" class="tab-page" style="display:none">`;
  const statementPanel = `<div id="invtab-wip-statement" class="tab-page" style="display:none">
  <iframe title="SO WIP statement" src="so-wip-statement.html?v=20261115-so-wip1" loading="lazy" style="display:block;width:100%;height:calc(100vh - 190px);min-height:1100px;border:0;border-radius:10px;background:#fff"></iframe>
</div>

`;
  const showWip = `  document.getElementById('invtab-wip').style.display = name === 'wip' ? 'block' : 'none';`;
  const activeWip = `  document.getElementById('invtabbtn-wip').classList.toggle('active', name === 'wip');`;
  if (![wipButton, finishedPanel, showWip, activeWip].every((part) => html.includes(part))) {
    console.error('SO WIP statement add-on: Inventory insertion point not found.');
    return;
  }
  docs.stock = html
    .replace(wipButton, wipButton + ' ' + statementButton)
    .replace(finishedPanel, statementPanel + finishedPanel)
    .replace(showWip, showWip + ` document.getElementById('invtab-wip-statement').style.display = name === 'wip-statement' ? 'block' : 'none';`)
    .replace(activeWip, activeWip + ` document.getElementById('invtabbtn-wip-statement').classList.toggle('active', name === 'wip-statement');`);
})();
