(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const fileInput = $('file-input');
  const dropZone = $('drop-zone');
  const statusBox = $('status');
  const results = $('results');
  const searchInput = $('search-input');
  const nf = new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 4 });
  const nf2 = new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 2 });
  const SRC_HEADERS = [
    'المخزن', 'رمز الصنف', 'اسم الصنف', 'الكمية الإفتتاحية', 'القيمة الافتتاحية',
    'سند إستلام البضاعة (GRR) الكمية', 'سند إستلام البضاعة (GRR) القيمة',
    'كمية المشتريات', 'قيمة الشراء', 'كمية مردودات المشتريات', 'قيمة مردودات المشتريات',
    'سند تسليم البضاعة (GDN) الكمية', 'سند تسليم البضاعة (GDN) القيمة', 'كمية المبيعات',
    'قيمة المبيعات', 'كمية مردودات المبيعات', 'قيمة مردودات المبيعات', 'كمية التحويل الوارد',
    'قيمة التحويل الوارد', 'كمية التحويل الصادر', 'قيمة التحويل الصادر', 'كمية تعديل المخزون',
    'قيمة تعديل المخزون', 'كمية المخزون التالف', 'قيمة المخزون التالف', 'كمية المواد للأستخدام الداخلى',
    'قيمة المواد للأستخدام الداخلى', 'كمية المواد الخام', 'قيمة المواد الخام المنصرفة',
    'كمية السلع تامة الصنع', 'قيمة السلع تامة الصنع', 'كمية الإقفال', 'قيمة كمية الإقفال'
  ];
  const SUMMARY_HEADERS = [
    'المخزن', 'عدد الأصناف', 'القيمة الافتتاحية', 'قيمة GRR', 'قيمة المشتريات',
    'قيمة مردودات المشتريات', 'قيمة GDN', 'قيمة المبيعات', 'قيمة مردودات المبيعات',
    'قيمة التحويل الوارد', 'قيمة التحويل الصادر', 'قيمة تعديل المخزون', 'قيمة المخزون التالف',
    'قيمة الاستخدام الداخلي', 'قيمة المواد الخام المنصرفة', 'قيمة السلع تامة الصنع', 'قيمة الإقفال'
  ];
  // 0-based positions in the source header row for values shown in the warehouse summary.
  const SUMMARY_VALUE_POSITIONS = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32];
  const SOURCE_VALUE_START = 3;
  const WAREHOUSE_NAMES = {
    '16': 'مخزن المواد الخام', '17': 'مخزن تحت التشغيل', '18': 'مخزن الإنتاج التام'
  };
  let report = null;
  let detailQuery = '';

  function setStatus(message, type = '') {
    statusBox.textContent = message;
    statusBox.className = `status ${type}`.trim();
    statusBox.hidden = !message;
  }

  function normalized(value) {
    return String(value ?? '').replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim();
  }

  function parseNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    let text = normalized(value).replace(/[٬,\s]/g, '').replace(/٫/g, '.');
    if (!text || text === '-') return 0;
    const negative = /^\(.*\)$/.test(text);
    text = text.replace(/[()]/g, '');
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return 0;
    return negative ? -parsed : parsed;
  }

  function normalizeWarehouse(code, filename) {
    const key = normalized(code);
    if (WAREHOUSE_NAMES[key]) return WAREHOUSE_NAMES[key];
    const name = normalized(filename).toLowerCase();
    if (name.includes('الخامات') || name.includes('خام')) return 'مخزن المواد الخام';
    if (name.includes('تحت التشغيل') || name.includes('تشغيل')) return 'مخزن تحت التشغيل';
    if (name.includes('التام') || name.includes('تام')) return 'مخزن الإنتاج التام';
    return key ? `المخزن ${key}` : 'مخزن غير محدد';
  }

  function findHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const values = (rows[r] || []).map(normalized);
      const codeIndex = values.findIndex((value) => value === 'رمز الصنف');
      const nameIndex = values.findIndex((value) => value === 'اسم الصنف');
      if (codeIndex >= 0 && nameIndex >= 0) return { rowIndex: r, values };
    }
    return null;
  }

  function periodFromRows(rows) {
    const top = rows.slice(0, 5).flat().map(normalized).join(' ');
    const match = top.match(/(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})\s*[-–إلى]+\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/);
    return match ? `${match[1]} - ${match[2]}` : '';
  }

  async function parseFile(file) {
    if (!window.XLSX) throw new Error('تعذر تحميل قارئ Excel. تأكد من الاتصال بالإنترنت ثم أعد فتح الصفحة.');
    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(bytes, { type: 'array', cellDates: false });
    let parsedRows = null;
    let metadataPeriod = '';
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: false });
      const found = findHeader(rows);
      if (!found) continue;
      metadataPeriod = periodFromRows(rows);
      const header = found.values;
      const warehouseIndex = header.findIndex((value) => value === 'المخزن');
      const codeIndex = header.findIndex((value) => value === 'رمز الصنف');
      const nameIndex = header.findIndex((value) => value === 'اسم الصنف');
      const movementIndexes = Array.from({ length: 30 }, (_, i) => header.findIndex((value) => value === SRC_HEADERS[SOURCE_VALUE_START + i]));
      if (movementIndexes.some((index) => index < 0)) {
        throw new Error(`الملف «${file.name}» لا يحتوي كل أعمدة تقرير المخزون المطلوبة.`);
      }
      parsedRows = [];
      for (const row of rows.slice(found.rowIndex + 1)) {
        const code = normalized(row[codeIndex]);
        const name = normalized(row[nameIndex]);
        if ((!code && !name) || /المجموع الكلى|الإجمالى|الإجمالي/i.test(name)) continue;
        const storeCode = warehouseIndex >= 0 ? row[warehouseIndex] : '';
        const warehouse = normalizeWarehouse(storeCode, file.name);
        const values = movementIndexes.map((index) => parseNumber(row[index]));
        parsedRows.push([warehouse, code, name, ...values]);
      }
      if (parsedRows.length) break;
    }
    if (!parsedRows?.length) throw new Error(`لم أجد جدول حركة أصناف صالحًا في «${file.name}». تأكد أنه ملخص عمليات المخزون.`);
    return { name: file.name, period: metadataPeriod, rows: parsedRows };
  }

  function aggregate(files) {
    const rows = files.flatMap((file) => file.rows);
    const storeMap = new Map();
    for (const row of rows) {
      const name = row[0];
      if (!storeMap.has(name)) storeMap.set(name, { name, count: 0, totals: Array(30).fill(0) });
      const store = storeMap.get(name);
      store.count += 1;
      for (let i = 0; i < 30; i++) store.totals[i] += parseNumber(row[3 + i]);
    }
    const stores = [...storeMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    const summaryRows = stores.map((store) => [store.name, store.count, ...SUMMARY_VALUE_POSITIONS.map((position) => store.totals[position - SOURCE_VALUE_START])]);
    const total = ['الإجمالي', rows.length];
    for (let i = 0; i < 15; i++) total.push(stores.reduce((sum, store) => sum + store.totals[SUMMARY_VALUE_POSITIONS[i] - SOURCE_VALUE_START], 0));
    return { rows, stores, summaryRows, total, files };
  }

  function formatAmount(value, decimals = 4) {
    const formatter = decimals === 2 ? nf2 : nf;
    return formatter.format(Number.isFinite(value) ? value : 0);
  }

  function renderTable(table, headers, rows, numericFrom = 1, totalsLast = false) {
    const head = table.querySelector('thead');
    const body = table.querySelector('tbody');
    head.replaceChildren();
    body.replaceChildren();
    const hr = document.createElement('tr');
    headers.forEach((label) => { const th = document.createElement('th'); th.textContent = label; hr.appendChild(th); });
    head.appendChild(hr);
    const displayRows = rows;
    displayRows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      if (totalsLast && rowIndex === displayRows.length - 1) tr.className = 'total-row';
      row.forEach((value, cellIndex) => {
        const td = document.createElement('td');
        td.textContent = typeof value === 'number' ? formatAmount(value, cellIndex >= numericFrom ? 4 : 0) : String(value ?? '');
        if (cellIndex >= numericFrom && typeof value === 'number') td.dir = 'ltr';
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  function updateDetails() {
    if (!report) return;
    const filtered = report.rows.filter((row) => {
      if (!detailQuery) return true;
      const lookup = `${row[0]} ${row[1]} ${row[2]}`.toLocaleLowerCase('ar');
      return lookup.includes(detailQuery);
    });
    const displayLimit = 500;
    renderTable($('detail-table'), SRC_HEADERS, filtered.slice(0, displayLimit), 3);
    const count = detailQuery ? `${nf.format(filtered.length)} نتيجة` : `${nf.format(report.rows.length)} صنف`;
    const shown = filtered.length > displayLimit ? `، ويُعرض أول ${nf.format(displayLimit)}` : '';
    $('detail-count').textContent = `${count}${shown}`;
  }

  function renderReport(nextReport) {
    report = nextReport;
    const total = report.total;
    $('kpi-items').textContent = nf.format(report.rows.length);
    $('kpi-stores').textContent = nf.format(report.stores.length);
    $('kpi-purchases').textContent = formatAmount(total[4], 2);
    $('kpi-closing').textContent = formatAmount(total[16], 2);
    $('summary-count').textContent = `${nf.format(report.stores.length)} مخازن`;
    renderTable($('summary-table'), SUMMARY_HEADERS, [...report.summaryRows, report.total], 1, true);
    const periods = [...new Set(report.files.map((item) => item.period).filter(Boolean))];
    $('period-label').textContent = periods.length === 1 ? `الفترة: ${periods[0]}` : periods.length > 1 ? `فترات الملفات: ${periods.join('، ')}` : 'الفترة غير محددة في الملفات';
    const chips = $('file-chips');
    chips.replaceChildren();
    report.files.forEach((file) => {
      const chip = document.createElement('span'); chip.className = 'file-chip';
      const mark = document.createElement('span'); mark.textContent = 'XLSX';
      const name = document.createElement('span'); name.textContent = file.name; name.title = file.name;
      chip.append(mark, name); chips.appendChild(chip);
    });
    results.hidden = false;
    updateDetails();
  }

  function makeExportWorkbook() {
    const wb = XLSX.utils.book_new();
    const summaryData = [
      ['تقرير حركة الأصناف'],
      [$('period-label').textContent],
      [],
      SUMMARY_HEADERS,
      ...report.summaryRows,
      report.total
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    summarySheet['!cols'] = [{ wch: 27 }, { wch: 13 }, ...Array(15).fill({ wch: 20 })];
    summarySheet['!autofilter'] = { ref: `A4:Q${4 + report.summaryRows.length}` };
    XLSX.utils.book_append_sheet(wb, summarySheet, 'ملخص');

    const detailData = [
      ['حركة الأصناف حسب المخزن'],
      [$('period-label').textContent, 'الحركات مجمعة حسب الصنف ولا تتضمن تواريخ أو أرقام المستندات الفردية'],
      [],
      SRC_HEADERS,
      ...report.rows
    ];
    const detailSheet = XLSX.utils.aoa_to_sheet(detailData);
    detailSheet['!cols'] = [{ wch: 26 }, { wch: 18 }, { wch: 38 }, ...Array(30).fill({ wch: 17 })];
    detailSheet['!autofilter'] = { ref: `A4:AG${4 + report.rows.length}` };
    XLSX.utils.book_append_sheet(wb, detailSheet, 'تفاصيل الحركة');
    return wb;
  }

  function downloadReport() {
    if (!report || !window.XLSX) return;
    const workbook = makeExportWorkbook();
    const period = report.files.find((file) => file.period)?.period || 'تقرير';
    const safePeriod = period.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '_');
    XLSX.writeFile(workbook, `حركة_الأصناف_${safePeriod}.xlsx`, { compression: true });
  }

  async function processFiles(files) {
    if (!files.length) return;
    if (!window.XLSX) { setStatus('قارئ Excel لم يكتمل تحميله. أعد المحاولة بعد لحظات.', 'error'); return; }
    results.hidden = true;
    $('download-button').disabled = true;
    setStatus(`جارٍ قراءة ${nf.format(files.length)} ملف...`);
    try {
      const parsed = [];
      for (const file of files) parsed.push(await parseFile(file));
      renderReport(aggregate(parsed));
      $('download-button').disabled = false;
      setStatus(`تم تحليل ${nf.format(parsed.length)} ملفًا و${nf.format(report.rows.length)} سجل صنف بنجاح.`, 'success');
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      report = null;
      setStatus(error?.message || 'تعذر قراءة الملفات. تأكد من اختيار ملخص عمليات المخزون بصيغة Excel.', 'error');
    }
  }

  fileInput.addEventListener('change', (event) => {
    processFiles([...event.target.files]);
    event.target.value = '';
  });
  $('download-button').addEventListener('click', downloadReport);
  $('clear-button').addEventListener('click', () => {
    report = null; detailQuery = ''; searchInput.value = ''; results.hidden = true; setStatus(''); fileInput.value = '';
  });
  searchInput.addEventListener('input', () => { detailQuery = normalized(searchInput.value).toLocaleLowerCase('ar'); updateDetails(); });
  dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); }
  });
  ['dragenter', 'dragover'].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add('drag-active'); }));
  ['dragleave', 'drop'].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove('drag-active'); }));
  dropZone.addEventListener('drop', (event) => processFiles([...event.dataTransfer.files].filter((file) => /\.xlsx?$/i.test(file.name))));
})();



