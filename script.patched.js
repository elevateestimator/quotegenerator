/* ===========================================================
   Endura Roofing — Quote
   script.js  (Manual PDF export + smart page breaks + auto libs)
   - Auto-loads html2canvas & jsPDF if missing
   - Off-screen sandbox (not clipped), waits for fonts & images
   - Clone sized to 816x1056 px (Letter @ 96dpi)
   - Smart cuts between cards/sections to avoid mid-card splits
   - Discount toggle respected; removed from PDF when off/zero
   - Summary values aligned; Tax Rate aligned in PDF
   - Pages/slices explicitly painted WHITE (fixes black area)
   =========================================================== */

/* ===== Shortcuts ===== */
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
/* Safe event helpers */
const on = (sel, ev, fn, ctx = document) => { const el = ctx.querySelector(sel); if (el) el.addEventListener(ev, fn); else console.warn('Missing element for', sel); return el; };
const onAll = (sel, ev, fn, ctx = document) => { const nodes = Array.from(ctx.querySelectorAll(sel)); if (!nodes.length) console.warn('No elements for', sel); nodes.forEach(el => el.addEventListener(ev, fn)); return nodes; };

/* ===== Money helpers ===== */
const formatMoney = (n) =>
  (Number.isFinite(n) ? n : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyWithSymbol = (n) =>
  (Number.isFinite(n) ? n : 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const parseNum = (str) => {
  if (str == null) return 0;
  const cleaned = String(str).replace(/[,$\s]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
};

/* ===== Letter dimensions (CSS px @ 96dpi) ===== */
const PX_PER_IN = 96;
const PAGE_W_CSS = Math.round(8.5 * PX_PER_IN);  // 816
const PAGE_H_CSS = Math.round(11  * PX_PER_IN);  // 1056

/* ===== Discount toggle state ===== */
const LS_KEY_DISCOUNT = 'discountEnabled';
const getSavedDiscountEnabled = () => {
  const saved = localStorage.getItem(LS_KEY_DISCOUNT);
  return saved === null ? true : saved === 'true';
};
let discountEnabled = getSavedDiscountEnabled();
function toggleDiscountRow(on) { const row = document.getElementById('discount-row'); if (row) row.style.display = on ? '' : 'none'; }

/* ===== Defaults ===== */
function setDefaults() {
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const expires = new Date(today); expires.setDate(today.getDate() + 30);

  const dateEl = $('[data-bind="quote_date"]');
  const expEl  = $('[data-bind="quote_expires"]');
  if (dateEl && !dateEl.value) dateEl.value = toISO(today);
  if (expEl && !expEl.value)   expEl.value  = toISO(expires);
  if ($('#tax-rate') && !$('#tax-rate').value) $('#tax-rate').value = '13';
}

/* ===== Items ===== */
function makeRow(data = {}) {
  const tr = document.createElement('tr');
  tr.className = 'item-row avoid-break';
  tr.innerHTML = `
    <td><input type="text" class="sku" placeholder="Item / SKU" value="${data.sku || ''}"></td>
    <td><textarea rows="2" class="desc" placeholder="Description">${data.desc || ''}</textarea></td>
    <td class="num"><input type="text" class="qty" inputmode="decimal" placeholder="1" value="${data.qty || ''}"></td>
    <td class="num"><input type="text" class="price" inputmode="decimal" placeholder="0.00" value="${data.price || ''}"></td>
    <td class="center"><input type="checkbox" class="taxable" ${data.taxable ? 'checked' : ''}></td>
    <td class="line-total"><span>$0.00</span></td>
    <td class="no-print slim"><button class="remove" title="Remove">✕</button></td>
  `;
  ['.qty','.price','.desc','.sku'].forEach(sel => tr.querySelector(sel).addEventListener('input', recalcAll));
  tr.querySelector('.taxable').addEventListener('change', recalcAll);
  tr.querySelector('.remove')?.addEventListener('click', () => { tr.remove(); recalcAll(); });
  return tr;
}
function ensureAtLeastOneRow() {
  const body = $('#item-rows');
  if (!body.children.length) body.appendChild(makeRow({ qty: 1, price: 0, taxable: true }));
}

/* ===== Totals ===== */
function recalcAll() {
  const rows = $$('.item-row');
  let subtotal = 0, taxableBase = 0;

  rows.forEach(row => {
    const qty = parseNum($('.qty', row).value);
    const price = parseNum($('.price', row).value);
    const isTaxable = $('.taxable', row).checked;
    const line = qty * price;
    if (isTaxable) taxableBase += line;
    subtotal += line;
    $('.line-total span', row).textContent = moneyWithSymbol(line);
  });

  $('#subtotal').textContent = formatMoney(subtotal);

  // Discount (ignore if toggle OFF)
  const discountActive = !!discountEnabled;
  const discountType = discountActive ? ($('#discount-type')?.value ?? 'amount') : 'amount';
  const discountVal  = discountActive ? parseNum($('#discount-value')?.value ?? 0) : 0;
  const discount     = (discountType === 'percent') ? (subtotal * (discountVal / 100)) : discountVal;
  const discounted   = Math.max(0, subtotal - discount);

  // Tax
  const taxRatePct = parseNum($('#tax-rate').value);
  const taxRate    = taxRatePct / 100;
  const taxBaseAfterDiscount =
    taxableBase > 0 ? (taxableBase - (discount * (taxableBase / Math.max(1, subtotal)))) : 0;
  const tax = Math.max(0, taxBaseAfterDiscount * taxRate);
  $('#tax-amount').textContent = formatMoney(tax);

  // Fees & grand
  const fees  = parseNum($('#fees').value);
  const grand = Math.max(0, discounted + tax + fees);
  $('#grand-total').textContent = formatMoney(grand);

  updateDeposit(grand);
}
function updateDeposit(grandTotal) {
  const mode = $$('input[name="deposit_mode"]').find(r => r.checked)?.value || 'auto';
  const depositInput = $('#deposit-due');
  if (mode === 'auto') {
    depositInput.value = moneyWithSymbol(grandTotal * 0.40);
    depositInput.setAttribute('readonly', 'readonly');
  } else {
    depositInput.removeAttribute('readonly');
  }
}

/* ===== Dynamically load libs if needed ===== */
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.defer = true; s.onload = res; s.onerror = () => rej(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}
async function ensurePdfLibs() {
  if (!window.html2canvas) {
    await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
  }
  const hasJsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  if (!hasJsPDF) {
    await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
  }
}

/* ===== Wait for fonts & images ===== */
async function waitForAssets(root, timeoutMs = 8000) {
  const waitFonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  const imgs = Array.from(root.querySelectorAll('img'));
  const imgPromises = imgs.map(img => new Promise(res => {
    if (img.complete && img.naturalWidth > 0) return res();
    img.addEventListener('load', res, { once: true });
    img.addEventListener('error', res, { once: true }); // still resolve so we don't hang
  }));
  const timeout = new Promise(res => setTimeout(res, timeoutMs));
  await Promise.race([Promise.all([waitFonts, Promise.all(imgPromises)]), timeout]);
}

/* ===== Clean print/PDF clone (with polished letterhead) =====
   - Builds a branded letterhead in the clone (PDF only)
   - Applies discount toggle/zero logic
   - Rewrites Tax Rate to align with $ column
   - Normalizes Summary rows and lock major blocks against breaking
*/
function buildPrintClone() {
  const original = document.getElementById('page');
  const clone = original.cloneNode(true);

  // Pin dimensions in CSS px (Letter @ 96dpi)
  const PX_PER_IN = 96, PAGE_W = 8.5 * PX_PER_IN, PAGE_H = 11 * PX_PER_IN;
  clone.style.width = PAGE_W + 'px';
  clone.style.minHeight = PAGE_H + 'px';
  clone.style.margin = '0';
  clone.style.padding = getComputedStyle(original).padding;
  clone.style.background = '#ffffff';
  clone.style.boxShadow = 'none';
  clone.style.border = '0';

  // PDF-only styles
  const style = document.createElement('style');
  style.textContent = `
    /* no-break for key blocks */
    .card, .grid-2, .signatures, .doc-header, .table-wrap, .items-table tr, .totals-grid, .avoid-break {
      break-inside: avoid; page-break-inside: avoid;
      -webkit-column-break-inside: avoid; -webkit-region-break-inside: avoid;
    }
    /* ensure white backgrounds in PDF clone */
    .card, .signatures { background: #ffffff !important; }

    /* Summary rows: consistent 3-col layout in the PDF */
    .totals-grid { grid-template-columns: auto 1fr var(--valw,16ch) !important; }

    /* Letterhead (PDF) */
    .pdf-letterhead { display:grid; grid-template-columns: 160px 1fr; align-items:center; gap:14px; }
    .pdf-letterhead .pdf-logo { width: 160px; height:auto; object-fit: contain; }
    .pdf-letterhead .pdf-company { font: 800 18px/1.2 Inter, ui-sans-serif, system-ui; color: var(--brand, #0267b5); letter-spacing: .2px; }
    .pdf-letterhead .pdf-contact { display:flex; flex-wrap:wrap; gap: 6px 10px; margin-top: 6px; font: 12px/1.5 Inter, ui-sans-serif, system-ui; color:#374151; }
    .pdf-letterhead .pdf-contact > span { white-space: nowrap; }
    .pdf-letterhead .pdf-contact > span:not(:first-child)::before { content:"•"; margin: 0 8px; color:#9ca3af; }
    .pdf-letterhead + .pdf-accent { height:3px; background: linear-gradient(90deg, #0267b5, rgba(2,103,181,.35)); border-radius: 2px; margin: 8px 0 6px; }

    .meta-grid { grid-template-columns: repeat(4, 1fr) !important; gap: 10px !important; }
    .meta-grid label { display:grid; gap:4px; font-size:10px; letter-spacing:.04em; text-transform:uppercase; color:#6b7280; }
    .meta-grid label > span { font-size:12px; font-weight:700; color:#111827; }
    .doc-header { break-inside: avoid; page-break-inside: avoid; }
  `;
  clone.prepend(style);

  // Build a tidy letterhead for the PDF (uses live values)
  const getVal = (k) => (document.querySelector(`[data-bind="${k}"]`)?.value || '').trim();
  const name   = getVal('company_name') || 'Endura Roofing';
  const addr1  = getVal('company_addr1');
  const addr2  = getVal('company_addr2');
  const phone  = getVal('company_phone');
  const email  = getVal('company_email');
  const web    = getVal('company_web');

  const contactParts = [];
  const addr = [addr1, addr2].filter(Boolean).join(', ').trim();
  if (addr)  contactParts.push(addr);
  if (phone) contactParts.push(phone);
  if (email) contactParts.push(email);
  if (web)   contactParts.push(web.replace(/^https?:\/\//i, ''));

  const header = clone.querySelector('.doc-header');
  const oldBrandRow = clone.querySelector('.brand-row');
  if (header && oldBrandRow) {
    const logoFromClone = oldBrandRow.querySelector('img.logo') || document.createElement('img');
    const lh = document.createElement('div');
    lh.className = 'pdf-letterhead avoid-break';

    const left = document.createElement('div');
    logoFromClone.classList.add('pdf-logo');
    left.appendChild(logoFromClone);

    const right = document.createElement('div');
    const nameEl = document.createElement('div');
    nameEl.className = 'pdf-company';
    nameEl.textContent = name;
    right.appendChild(nameEl);

    const contactEl = document.createElement('div');
    contactEl.className = 'pdf-contact';
    contactParts.forEach(t => { const s = document.createElement('span'); s.textContent = t; contactEl.appendChild(s); });
    right.appendChild(contactEl);

    lh.appendChild(left);
    lh.appendChild(right);

    header.replaceChild(lh, oldBrandRow);

    const accent = document.createElement('div');
    accent.className = 'pdf-accent';
    header.insertBefore(accent, header.querySelector('.meta-grid'));
  }

  // Discount toggle/value logic
  const enabled = document.getElementById('discount-toggle')
    ? document.getElementById('discount-toggle').checked
    : true;
  if (!enabled) {
    clone.querySelector('#discount-row')?.remove();
  } else {
    const subtotal = parseFloat((document.getElementById('subtotal')?.textContent || '0').replace(/[^\d.]/g, '')) || 0;
    const type = document.getElementById('discount-type')?.value || 'amount';
    const raw = (document.getElementById('discount-value')?.value || '').replace(/[,$\s]/g, '');
    const dnum = parseFloat(raw) || 0;
    const computed = type === 'percent' ? subtotal * (dnum / 100) : dnum;
    if (Math.abs(computed) < 0.0001) {
      clone.querySelector('#discount-row')?.remove();
    } else {
      const cell = clone.querySelector('#discount-row .value');
      if (cell) {
        const sign = computed > 0 ? '−' : '';
        cell.innerHTML = `<span class="curr">$</span><span class="amt">${sign}${(Math.abs(computed)).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>`;
      }
    }
  }

  /* PDF: Deposit section should only show the amount */
  {
    const depositCard = clone.querySelector('#deposit-due')?.closest('.card');
    if (depositCard) {
      depositCard.querySelectorAll('.inline-controls, .radio-group, input[type="radio"], label.radio')
        .forEach(el => el.remove());
      const originalVal = document.getElementById('deposit-due')?.value || '';
      const numeric     = parseNum(originalVal);
      const displayVal  = (numeric > 0)
        ? '$' + numeric.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : (originalVal.trim() || '$0.00');
      const dueInputClone = depositCard.querySelector('#deposit-due');
      if (dueInputClone) {
        const out = document.createElement('span');
        out.textContent = displayVal;
        out.style.fontWeight = '700';
        dueInputClone.parentNode.replaceChild(out, dueInputClone);
      }
    }
  }

  // -------- Remove screen-only bits, then fix Items table columns for PDF --------
  // Remove all general .no-print elements (toolbars, delete column cells, etc.)
  clone.querySelectorAll('.no-print').forEach(el => el.remove());

  // Now specifically normalize the Items table so "Line Total" remains
  const itemsTable = clone.querySelector('#items-table');
  if (itemsTable) {
    // If any header/body cells with .no-print remain, remove them explicitly
    itemsTable.querySelectorAll('thead th.no-print, tbody td.no-print').forEach(el => el.remove());

    // Fix colgroup to match the remaining visible header cells
    const cg = itemsTable.querySelector('colgroup');
    if (cg) {
      const thCount = itemsTable.tHead ? itemsTable.tHead.rows[0].children.length : 0;
      while (cg.children.length > thCount && cg.lastElementChild) cg.removeChild(cg.lastElementChild);
    }

    // Ensure table fills width & doesn't clip the last column
    itemsTable.style.tableLayout = 'fixed';
    itemsTable.style.width = '100%';
    const wrap = itemsTable.closest('.table-wrap');
    if (wrap) {
      wrap.style.overflow = 'visible';
      wrap.style.width = '100%';
    }

    // Make the Line Total values unbreakable & right-aligned (nice looking)
    itemsTable.querySelectorAll('td.line-total span').forEach(s => {
      s.style.display = 'inline-block';
      s.style.minWidth = '6ch';
      s.style.textAlign = 'right';
      s.style.whiteSpace = 'nowrap';
    });
  }

  // Replace inputs/selects/areas with text for crisp output
  const replaceControl = (el, text) => {
    const isArea = el.tagName === 'TEXTAREA';
    const out = document.createElement(isArea ? 'div' : 'span');
    out.textContent = text || '';
    out.style.whiteSpace = 'pre-wrap';
    out.style.display = 'block';
    if (isArea) out.style.minHeight = `${(el.rows || 3) * 1.2}em`;
    el.parentNode.replaceChild(out, el);
  };
  clone.querySelectorAll('input, textarea, select').forEach(el => {
    if (el.type === 'checkbox') {
      const mark = document.createElement('span');
      mark.textContent = el.checked ? '✓' : '—';
      mark.style.display = 'inline-block';
      mark.style.textAlign = 'center';
      el.parentNode.replaceChild(mark, el);
    } else if (el.tagName === 'SELECT') {
      const txt = el.options[el.selectedIndex]?.text || '';
      replaceControl(el, txt);
    } else {
      replaceControl(el, el.value);
    }
  });

  // Align the Tax Rate row with the currency column
  const rateCell = clone.querySelector('#taxrate-row .value');
  if (rateCell) {
    const srcRate = (document.getElementById('tax-rate')?.value ?? '13').replace(/[^\d.]/g, '') || '13';
    rateCell.innerHTML = `<span class="curr curr-placeholder">$</span><span class="amt">${srcRate}%</span>`;
  }

  return clone;
}

/* ===== Off-screen sandbox (visible to layout, not clipped) ===== */
function createPdfSandbox() {
  const sandbox = document.createElement('div');
  sandbox.id = 'pdf-sandbox';
  sandbox.style.position = 'absolute';
  sandbox.style.left = '0';
  sandbox.style.top = '0';
  sandbox.style.opacity = '0';
  sandbox.style.pointerEvents = 'none';
  sandbox.style.background = '#ffffff';
  sandbox.style.width = PAGE_W_CSS + 'px';
  sandbox.style.minHeight = PAGE_H_CSS + 'px';
  document.body.appendChild(sandbox);
  return sandbox;
}

/* ===== Compute smart page cuts (between sections) ===== */
function computeCutPositionsPx(clone, scaleFactor, idealPageHeightPxCanvas) {
  const selectors = [
    '.doc-header', '.grid-2', '.card', '.signatures',
    '.table-wrap', '.items-table', '.totals', '.avoid-break'
  ];
  const rect = clone.getBoundingClientRect();
  const bottomsCss = new Set([0]); // include top of page

  selectors.forEach(sel => {
    clone.querySelectorAll(sel).forEach(el => {
      const r = el.getBoundingClientRect();
      const bottomCss = (r.bottom - rect.top);
      if (bottomCss > 0) bottomsCss.add(Math.round(bottomCss));
    });
  });

  const bottomsCanvas = Array.from(bottomsCss)
    .map(css => Math.round(css * scaleFactor))
    .sort((a,b) => a - b);

  const cuts = [];
  let y = 0;
  const minStep = Math.round(200 * scaleFactor); // avoid tiny slices
  while (y + 1 < bottomsCanvas[bottomsCanvas.length - 1]) {
    const target = y + idealPageHeightPxCanvas;
    let candidate = y + idealPageHeightPxCanvas;
    for (let i = bottomsCanvas.length - 1; i >= 0; i--) {
      const b = bottomsCanvas[i];
      if (b <= target && b > y + minStep) { candidate = b; break; }
    }
    cuts.push(candidate);
    y = candidate;
  }
  return cuts;
}

/* ===== Export ===== */
let exporting = false;
async function downloadPDF() {
  if (exporting) return;
  exporting = true;

  try {
    await ensurePdfLibs();
    recalcAll();

    const clone = buildPrintClone();

    // Off-screen sandbox (not clipped)
    const sandbox = createPdfSandbox();
    sandbox.innerHTML = '';
    sandbox.appendChild(clone);

    // Wait for fonts & images
    await waitForAssets(clone);

    // Render to a single big canvas
    const scale = 2;
    const canvas = await window.html2canvas(clone, {
      scale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: 0
    });

    const canvasW = canvas.width;
    const canvasH = canvas.height;
    const scaleFactor = canvasW / clone.offsetWidth;

    // jsPDF
    const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
const pdf = new jsPDFCtor({ unit: 'pt', format: 'letter', orientation: 'portrait' });
    const pdfW = pdf.internal.pageSize.getWidth();   // 612 pt
    const pdfH = pdf.internal.pageSize.getHeight();  // 792 pt

    // Height of one PDF page in canvas px when fitted to width
    const pageHeightPxCanvas = Math.floor(canvasW * (pdfH / pdfW));

    // Smart cut positions (between sections)
    const cuts = computeCutPositionsPx(clone, scaleFactor, pageHeightPxCanvas);

    // Reusable canvas for each page slice
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvasW;
    const ctx = pageCanvas.getContext('2d', { alpha: false });
    const paintWhite = (w, h) => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); };

    let prev = 0;
    for (let i = 0; i < cuts.length; i++) {
      const next = cuts[i];
      const sliceH = next - prev;
      pageCanvas.height = sliceH;
      paintWhite(pageCanvas.width, pageCanvas.height);
      ctx.drawImage(canvas, 0, prev, canvasW, sliceH, 0, 0, canvasW, sliceH);

      const imgData = pageCanvas.toDataURL('image/jpeg', 0.98);
      const imgHpt = (sliceH / canvasW) * pdfW;
      if (i > 0) pdf.addPage();

      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, pdfW, pdfH, 'F');

      pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, imgHpt);
      prev = next;
    }

    // Remaining tail
    if (prev < canvasH) {
      const sliceH = canvasH - prev;
      pageCanvas.height = sliceH;
      paintWhite(pageCanvas.width, pageCanvas.height);
      ctx.drawImage(canvas, 0, prev, canvasW, sliceH, 0, 0, canvasW, sliceH);

      const imgData = pageCanvas.toDataURL('image/jpeg', 0.98);
      const imgHpt = (sliceH / canvasW) * pdfW;
      if (cuts.length > 0) pdf.addPage();

      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, pdfW, pdfH, 'F');

      pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, imgHpt);
    }

    const client = $('[data-bind="client_name"]').value?.trim() || 'Client';
    const qno    = $('[data-bind="quote_no"]').value?.trim() || 'Quote';
    const filename = `${client.replace(/[^\w\-]+/g,'_')}_${qno.replace(/[^\w\-]+/g,'_')}.pdf`;
    pdf.save(filename);

    sandbox.remove();
  } catch (e) {
    console.error('PDF export error', e);
    alert('PDF export failed. Please refresh and try again.');
  } finally {
    exporting = false;
  }
}

/* ===== Preview / Clear / Wire-up ===== */
let previewMode = false;
function togglePreview() {
  previewMode = !previewMode;
  $('#btn-preview').textContent = previewMode ? 'Exit Preview' : 'Preview';
  $$('input, textarea, select').forEach(el => {
    if (el.closest('.toolbar')) return;
    if (previewMode) el.setAttribute('disabled', 'disabled');
    else el.removeAttribute('disabled');
  });
}
function clearForm() {
  if (!confirm('Clear all fields and line items?')) return;
  $$('input[type="text"], input[type="date"], textarea').forEach(el => {
    if (el.id === 'deposit-due') return;
    el.value = '';
  });
  $('#discount-type').value = 'amount'; $('#discount-value').value = '';
  $('#tax-rate').value = '13'; $('#fees').value = '';
  $('#item-rows').innerHTML = ''; ensureAtLeastOneRow(); recalcAll();
}

/* ===== Boot ===== */
document.addEventListener('DOMContentLoaded', () => {
  try {
  setDefaults();

  // Discount toggle beside Clear (auto-create if missing)
  let discountToggle = document.getElementById('discount-toggle');
  if (!discountToggle) {
    const left = document.querySelector('.toolbar .left');
    if (left) {
      const label = document.createElement('label');
      label.className = 'switch no-print'; label.title = 'Show/Hide Discount';
      const input = document.createElement('input'); input.type = 'checkbox'; input.id = 'discount-toggle'; input.checked = discountEnabled;
      const span = document.createElement('span'); span.textContent = 'Discount';
      label.appendChild(input); label.appendChild(span);
      const clearBtn = document.getElementById('btn-clear');
      if (clearBtn) clearBtn.insertAdjacentElement('afterend', label); else left.appendChild(label);
      discountToggle = input;
    }
  } else {
    discountToggle.checked = discountEnabled;
  }
  toggleDiscountRow(discountEnabled);
  if (discountToggle) {
    discountToggle.addEventListener('change', (e) => {
      discountEnabled = e.target.checked;
      localStorage.setItem(LS_KEY_DISCOUNT, String(discountEnabled));
      toggleDiscountRow(discountEnabled);
      recalcAll();
    });
  }

  // Initial rows
  const body = $('#item-rows');
  body.appendChild(makeRow({ qty: 1, price: 0, taxable: true }));
  body.appendChild(makeRow({ qty: 1, price: 0, taxable: false }));

  // Recalc on inputs
  ['#discount-type', '#discount-value', '#tax-rate', '#fees'].forEach(sel => {
    on(sel, 'input', recalcAll);
    on(sel, 'change', recalcAll);
  });

  // Deposit mode
  onAll('input[name="deposit_mode"]', 'change', () => {
    const grand = parseNum($('#grand-total').textContent);
    updateDeposit(grand);
  }));

  // Toolbar — both buttons export the same clean PDF
  on('#btn-add-line', 'click', () => {
    $('#item-rows').appendChild(makeRow({ qty: 1, price: 0, taxable: true }));
    recalcAll();
  });
  on('#btn-download', 'click', downloadPDF);
  on('#btn-print', 'click', downloadPDF);
  on('#btn-preview', 'click', togglePreview);
  on('#btn-clear', 'click', clearForm);

  recalcAll();
  } catch (err) { console.error('Init error:', err); alert('A script error prevented the page from fully loading. Try refreshing.'); }
});
