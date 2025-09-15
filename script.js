/* ===========================================================
   Endura Roofing — Quote
   script.js  (No browser-print fallback; PDF only)
   - Download PDF never calls window.print()
   - The "Print" button now triggers the same PDF flow
   - Discount toggle supported (auto-inserted if missing)
   - Summary numbers aligned; Tax Rate aligned in PDF
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

/* ===== Discount toggle state ===== */
const LS_KEY_DISCOUNT = 'discountEnabled';
const getSavedDiscountEnabled = () => {
  const saved = localStorage.getItem(LS_KEY_DISCOUNT);
  return saved === null ? true : saved === 'true';
};
let discountEnabled = getSavedDiscountEnabled();

function toggleDiscountRow(on) {
  const row = document.getElementById('discount-row');
  if (row) row.style.display = on ? '' : 'none'; // inline style overrides display: contents
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

  // Default tax to 13% if empty
  const taxEl = $('#tax-rate');
  if (taxEl && !taxEl.value) taxEl.value = '13';
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
  let subtotal = 0;
  let taxableBase = 0;

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

  // ----- Discount (ignored when toggle is OFF) -----
  const discountActive = !!discountEnabled;
  const discountType = discountActive ? ($('#discount-type')?.value ?? 'amount') : 'amount';
  const discountVal  = discountActive ? parseNum($('#discount-value')?.value ?? 0) : 0;
  const discount     = (discountType === 'percent') ? (subtotal * (discountVal / 100)) : discountVal;
  const discounted   = Math.max(0, subtotal - discount);

  // ----- Tax -----
  const taxRatePct   = parseNum($('#tax-rate').value);
  const taxRate      = taxRatePct / 100;
  const taxBaseAfterDiscount = taxableBase > 0 ? (taxableBase - (discount * (taxableBase / Math.max(1, subtotal)))) : 0;
  const tax          = Math.max(0, taxBaseAfterDiscount * taxRate);
  $('#tax-amount').textContent = formatMoney(tax);

  // ----- Fees -----
  const fees         = parseNum($('#fees').value);

  // ----- Grand Total -----
  const grand        = Math.max(0, discounted + tax + fees);
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

/* ===== Clean print/PDF clone =====
   - Removes Discount row when toggle is OFF
   - Also removes Discount when ON but value is 0
   - Rewrites Tax Rate cell to align with $ column
*/
function buildPrintClone() {
  const original = document.getElementById('page');
  const clone = original.cloneNode(true);

  // Toggle state (from UI or saved setting)
  const enabled = document.getElementById('discount-toggle')
    ? document.getElementById('discount-toggle').checked
    : getSavedDiscountEnabled();

  if (!enabled) {
    clone.querySelector('#discount-row')?.remove();
  } else {
    const subtotal = parseNum(document.getElementById('subtotal')?.textContent || '0');
    const type = document.getElementById('discount-type')?.value || 'amount';
    const raw = parseNum(document.getElementById('discount-value')?.value || '0');
    const computed = type === 'percent' ? subtotal * (raw / 100) : raw;

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

  // Replace form controls with text for crisp output
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

  // Normalize the Tax Rate cell so it lines up with the $ column
  const rateCell = clone.querySelector('#taxrate-row .value');
  if (rateCell) {
    const srcRate = (document.getElementById('tax-rate')?.value ?? '13').replace(/[^\d.]/g, '') || '13';
    rateCell.innerHTML = `<span class="curr curr-placeholder">$</span><span class="amt">${srcRate}%</span>`;
  }

  // Remove screen-only bits
  clone.querySelectorAll('.no-print').forEach(el => el.remove());

  return clone;
}

async function downloadPDF() {
  // Always use html2pdf — never fall back to window.print()
  recalcAll();

  const clone = buildPrintClone();
  const root = document.getElementById('print-clone-root');
  root.innerHTML = '';
  root.appendChild(clone);

  const client = $('[data-bind="client_name"]').value?.trim() || 'Client';
  const qno    = $('[data-bind="quote_no"]').value?.trim() || 'Quote';
  const filename = `${client.replace(/[^\w\-]+/g,'_')}_${qno.replace(/[^\w\-]+/g,'_')}.pdf`;

  const opt = {
    margin:       [0, 0, 0, 0],
    filename,
    image:        { type: 'jpeg', quality: 0.98 },
    // allowTaint helps when running from file:// or when images lack CORS headers
    html2canvas:  { scale: 2, useCORS: true, allowTaint: true, backgroundColor: '#ffffff' },
    jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' },
    pagebreak:    { mode: ['avoid-all', 'css', 'legacy'], avoid: ['.avoid-break', '.card', '.grid-2', '.signatures', '.items-table tr', '.totals-grid'] }
  };

  try {
    await html2pdf().set(opt).from(clone).save();
  } catch (e) {
    console.error('html2pdf error', e);
    alert('PDF export failed. Try running this file from a local server (not file://), then click Download PDF again.');
  } finally {
    root.innerHTML = '';
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
  $('#discount-type').value = 'amount';
  $('#discount-value').value = '';
  $('#tax-rate').value = '13';
  $('#fees').value = '';
  $('#item-rows').innerHTML = '';
  ensureAtLeastOneRow();
  recalcAll();
}

document.addEventListener('DOMContentLoaded', () => {
  setDefaults();

  // Auto-insert the Discount toggle beside the Clear button if not present
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
      if (clearBtn) {
        clearBtn.insertAdjacentElement('afterend', label);
      } else {
        left.appendChild(label);
      }
      discountToggle = input;
    }
  } else {
    // If it exists in HTML, sync with saved state
    discountToggle.checked = discountEnabled;
  }

  // Apply initial visibility and wire change handler
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

  // Inputs that affect totals
  ['#discount-type', '#discount-value', '#tax-rate', '#fees'].forEach(sel => {
    $(sel).addEventListener('input', recalcAll);
    $(sel).addEventListener('change', recalcAll);
  });

  // Deposit mode handler
  $$('input[name="deposit_mode"]').forEach(r => r.addEventListener('change', () => {
    const grand = parseNum($('#grand-total').textContent);
    updateDeposit(grand);
  }));

  // Toolbar buttons
  $('#btn-add-line').addEventListener('click', () => {
    $('#item-rows').appendChild(makeRow({ qty: 1, price: 0, taxable: true }));
    recalcAll();
  });

  // IMPORTANT: Both buttons now generate the same PDF (no headers/footers)
  $('#btn-download').addEventListener('click', downloadPDF);
  $('#btn-print').addEventListener('click', downloadPDF); // no window.print()

  $('#btn-preview').addEventListener('click', togglePreview);
  $('#btn-clear').addEventListener('click', clearForm);

  recalcAll();
});
