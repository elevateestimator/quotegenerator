/* ===========================================================
   Endura Roofing — Quote
   script.js  (Manual PDF export + smart page breaks)
   - Off-screen sandbox (not clipped)
   - Waits for fonts & images before capture
   - Uses html2canvas + jsPDF (no html2pdf auto-paging)
   - Smart cuts between cards/sections to avoid mid-card splits
   - Discount toggle respected; removed from PDF when off/zero
   - Summary values aligned; Tax Rate aligned in PDF
   =========================================================== */

/* ===== Helpers ===== */
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

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

/* ===== Constants (Letter @ 96dpi) ===== */
const PX_PER_IN = 96;
const PAGE_W_CSS = 8.5 * PX_PER_IN;   // 816 px
const PAGE_H_CSS = 11  * PX_PER_IN;   // 1056 px

/* ===== Discount toggle state ===== */
const LS_KEY_DISCOUNT = 'discountEnabled';
const getSavedDiscountEnabled = () => {
  const saved = localStorage.getItem(LS_KEY_DISCOUNT);
  return saved === null ? true : saved === 'true';
};
let discountEnabled = getSavedDiscountEnabled();

function toggleDiscountRow(on) {
  const row = document.getElementById('discount-row');
  if (row) row.style.display = on ? '' : 'none';
}

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

/* ===== Line Items ===== */
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

  // Discount (ignored if toggle is OFF)
  const discountActive = !!discountEnabled;
  const discountType = discountActive ? ($('#discount-type')?.value ?? 'amount') : 'amount';
  const discountVal  = discountActive ? parseNum($('#discount-value')?.value ?? 0) : 0;
  const discount     = (discountType === 'percent') ? (subtotal * (discountVal / 100)) : discountVal;
  const discounted   = Math.max(0, subtotal - discount);

  // Tax
  const taxRatePct   = parseNum($('#tax-rate').value);
  const taxRate      = taxRatePct / 100;
  const taxBaseAfterDiscount =
    taxableBase > 0 ? (taxableBase - (discount * (taxableBase / Math.max(1, subtotal)))) : 0;
  const tax = Math.max(0, taxBaseAfterDiscount * taxRate);
  $('#tax-amount').textContent = formatMoney(tax);

  // Fees
  const fees  = parseNum($('#fees').value);

  // Grand Total
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

/* ===== Assets wait (fonts & images) ===== */
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

/* ===== Build a clean PDF clone =====
   - Removes Discount if toggle OFF or computed 0
   - Aligns Tax Rate with $ column
   - Drops the last "delete" column from Items
*/
function buildPrintClone() {
  const original = document.getElementById('page');
  const clone = original.cloneNode(true);

  // Lock dimensions in CSS px to avoid inch/px rounding surprises
  clone.style.width = PAGE_W_CSS + 'px';
  clone.style.minHeight = PAGE_H_CSS + 'px';
  clone.style.margin = '0';
  clone.style.padding = getComputedStyle(original).padding;
  clone.style.background = '#ffffff';
  clone.style.boxShadow = 'none';
  clone.style.border = '0';

  // Strong "no-break" rules (some engines ignore display:contents)
  const style = document.createElement('style');
  style.textContent = `
    .card, .grid-2, .signatures, .doc-header, .table-wrap, .items-table tr, .totals-grid, .avoid-break {
      break-inside: avoid; page-break-inside: avoid;
      -webkit-column-break-inside: avoid; -webkit-region-break-inside: avoid;
    }
    .totals-grid { grid-template-columns: auto 1fr var(--valw,16ch) !important; }
  `;
  clone.prepend(style);

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

  // Replace editable controls with text for crisp output
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

  // Align Tax Rate like currency rows
  const rateCell = clone.querySelector('#taxrate-row .value');
  if (rateCell) {
    const srcRate = (document.getElementById('tax-rate')?.value ?? '13').replace(/[^\d.]/g, '') || '13';
    rateCell.innerHTML = `<span class="curr curr-placeholder">$</span><span class="amt">${srcRate}%</span>`;
  }

  // Remove screen-only bits and the last "X" column from Items
  clone.querySelectorAll('.no-print').forEach(el => el.remove());
  const itemsTable = clone.querySelector('#items-table');
  if (itemsTable) {
    const cg = itemsTable.querySelector('colgroup');
    if (cg && cg.lastElementChild) cg.removeChild(cg.lastElementChild);
    itemsTable.querySelectorAll('thead tr th:last-child, tbody tr td:last-child').forEach(el => el.remove());
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

/* ===== Find smart page cuts (between cards/sections) ===== */
function computeCutPositionsPx(clone, scaleFactor, idealPageHeightPxCanvas) {
  // Candidate boundaries: bottom of each major block
  const selectors = [
    '.doc-header', '.grid-2', '.card', '.signatures',
    '.table-wrap', '.items-table', '.totals', '.avoid-break'
  ];
  const rect = clone.getBoundingClientRect();
  const bottomsCss = new Set([0]); // start at top

  selectors.forEach(sel => {
    clone.querySelectorAll(sel).forEach(el => {
      const r = el.getBoundingClientRect();
      const bottomCss = (r.bottom - rect.top); // CSS px relative to clone top
      if (bottomCss > 0) bottomsCss.add(Math.round(bottomCss));
    });
  });

  const bottomsCanvas = Array.from(bottomsCss)
    .map(css => Math.round(css * scaleFactor))
    .sort((a,b) => a - b);

  const cuts = [];
  let y = 0;
  const minStep = Math.round(200 * scaleFactor); // don't get stuck on tiny steps
  while (y + 1 < bottomsCanvas[bottomsCanvas.length - 1]) {
    const target = y + idealPageHeightPxCanvas;
    // choose the largest boundary <= target but > y + minStep
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
async function downloadPDF() {
  try {
    recalcAll();

    const clone = buildPrintClone();

    // Render clone in off-screen sandbox (not clipped)
    const sandbox = createPdfSandbox();
    sandbox.innerHTML = '';
    sandbox.appendChild(clone);

    // Wait for fonts & images inside the clone
    await waitForAssets(clone);

    // Render to canvas
    const scale = 2; // crisp
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
    const scaleFactor = canvasW / clone.offsetWidth; // canvas px per CSS px

    // jsPDF setup
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
    const pdfW = pdf.internal.pageSize.getWidth();   // 612 pt
    const pdfH = pdf.internal.pageSize.getHeight();  // 792 pt

    // Height of one PDF page in canvas pixels when scaled to fit width
    const pageHeightPxCanvas = Math.floor(canvasW * (pdfH / pdfW));

    // Compute smart cut positions (in canvas px)
    const cuts = computeCutPositionsPx(clone, scaleFactor, pageHeightPxCanvas);

    // Helper to draw a slice
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvasW;

    let prev = 0;
    for (let i = 0; i < cuts.length; i++) {
      const next = cuts[i];
      const sliceH = next - prev;
      pageCanvas.height = sliceH;
      const ctx = pageCanvas.getContext('2d');
      ctx.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(canvas, 0, prev, canvasW, sliceH, 0, 0, canvasW, sliceH);

      const imgData = pageCanvas.toDataURL('image/jpeg', 0.98);
      const imgHpt = (sliceH / canvasW) * pdfW;
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, imgHpt);
      prev = next;
    }

    // If content below last cut remains, add it
    if (prev < canvasH) {
      const sliceH = canvasH - prev;
      pageCanvas.height = sliceH;
      const ctx = pageCanvas.getContext('2d');
      ctx.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(canvas, 0, prev, canvasW, sliceH, 0, 0, canvasW, sliceH);

      const imgData = pageCanvas.toDataURL('image/jpeg', 0.98);
      const imgHpt = (sliceH / canvasW) * pdfW;
      if (cuts.length > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, imgHpt);
    }

    pdf.save(getPdfFilename());
    sandbox.remove();
  } catch (e) {
    console.error('PDF export error', e);
    alert('PDF export failed. Please refresh and try again.');
  }
}

function getPdfFilename() {
  const client = $('[data-bind="client_name"]').value?.trim() || 'Client';
  const qno    = $('[data-bind="quote_no"]').value?.trim() || 'Quote';
  return `${client.replace(/[^\w\-]+/g,'_')}_${qno.replace(/[^\w\-]+/g,'_')}.pdf`;
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

document.addEventListener('DOMContentLoaded', () => {
  setDefaults();

  // Auto-insert the Discount toggle beside Clear if not present
  let discountToggle = document.getElementById('discount-toggle');
  if (!discountToggle) {
    const left = document.querySelector('.toolbar .left');
    if (left) {
      const label = document.createElement('label');
      label.className = 'switch no-print';
      label.title = 'Show/Hide Discount';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = 'discount-toggle';
      input.checked = discountEnabled;

      const span = document.createElement('span');
      span.textContent = 'Discount';

      label.appendChild(input);
      label.appendChild(span);

      const clearBtn = document.getElementById('btn-clear');
      if (clearBtn) clearBtn.insertAdjacentElement('afterend', label);
      else left.appendChild(label);
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

  // Inputs affecting totals
  ['#discount-type', '#discount-value', '#tax-rate', '#fees'].forEach(sel => {
    $(sel).addEventListener('input', recalcAll);
    $(sel).addEventListener('change', recalcAll);
  });

  // Deposit mode
  $$('input[name="deposit_mode"]').forEach(r => r.addEventListener('change', () => {
    const grand = parseNum($('#grand-total').textContent);
    updateDeposit(grand);
  }));

  // Toolbar
  $('#btn-add-line').addEventListener('click', () => {
    $('#item-rows').appendChild(makeRow({ qty: 1, price: 0, taxable: true }));
    recalcAll();
  });
  // Both buttons export the same clean PDF (no browser headers/footers)
  $('#btn-download').addEventListener('click', downloadPDF);
  $('#btn-print').addEventListener('click', downloadPDF);
  $('#btn-preview').addEventListener('click', togglePreview);
  $('#btn-clear').addEventListener('click', clearForm);

  recalcAll();
});
