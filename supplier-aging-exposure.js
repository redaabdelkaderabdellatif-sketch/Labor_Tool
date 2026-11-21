/* Supplier aging: monetary exposure for the "Over Limit By" column.
   This only changes the supplier aging display and workbook export. */
(function () {
  if (!window.GATY_MODULE_DOCS || !window.GATY_MODULE_DOCS.suppliers) return;

  let source = window.GATY_MODULE_DOCS.suppliers;
  const legacyRule = /(^[ \t]*)const overLimitBy = typeof term\.creditLimit === 'number' \? Math\.max\(0, result\.totalOpen - term\.creditLimit\) : null;\r?\n\1const overdueByDays = typeof term\.creditPeriodDays === 'number' \? Math\.max\(0, result\.maxOpenAgeDays - term\.creditPeriodDays\) : null;/gm;
  source = source.replace(legacyRule, (_match, indent) => `${indent}const creditLimitExposure = typeof term.creditLimit === 'number' ? Math.max(0, result.totalOpen - term.creditLimit) : null;
${indent}const creditPeriodExposure = typeof term.creditPeriodDays === 'number'
${indent}  ? result.transactions.reduce((sum, txn) => {
${indent}      const ageDays = Math.floor((today - txn.date) / 86400000);
${indent}      return ageDays > term.creditPeriodDays ? sum + txn.remainingOpen : sum;
${indent}    }, 0)
${indent}  : null;
${indent}const exposures = [creditLimitExposure, creditPeriodExposure].filter(value => typeof value === 'number' && value > 0.005);
${indent}const overLimitBy = exposures.length ? Math.min(...exposures) : 0;
${indent}const overdueByDays = typeof term.creditPeriodDays === 'number' ? Math.max(0, result.maxOpenAgeDays - term.creditPeriodDays) : null;`);
  window.GATY_MODULE_DOCS.suppliers = source;
})();
