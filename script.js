/* ===========================================================
   Endura Roofing — Quote
   script.js  (PDF-only export + Discount toggle + alignment)
   - Download/Print both generate the same PDF (no browser headers/footers)
   - Waits for fonts & images before capture
   - Uses an off-screen sandbox (not clipped) to avoid left-shift/cropping
   - Locks clone to Letter size; normalizes Summary rows for reliability
   - Discount toggle (auto-inserted if missing), removed from PDF when off or zero
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

/* ===== Assets wait ===== */
// Wait for fonts & images inside an element (so html2canvas gets them)
async function waitForAssets(root, timeoutMs = 8000) {
  const waitFonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  const imgs = Array.from(root.querySelectorAll('img'));
  const imgPromises = imgs.map(img => new Promise(res => {
    if (img.complete && img.naturalWidth > 0) return res();
    img.addEventListener('load', res, { once: true });
    img.addEventListener('error', res, { once: true }); // still resolve so we don't hang
  }));
  // Timeout safety
  const timeout = new Promise(res => setTimeout(res, timeoutMs));
  await Promise.race([Promise.all([waitFonts, Promise.all(imgPromises)]), timeout]);
}

/* ===== Clean print/PDF clone =====
   - Applies discount toggle/zero logic
   - Rewrites Tax Rate to align with $ column
   - Normalizes summary rows to 'display:grid' (avoid display:contents issues)
   - Locks clone size to Letter (prevents "start in the middle" jumps)
*/
function buildPrintClone() {
  const original = document.getElementById('page');
  const clone = original.cloneNode(true);

  // Lock dimensions to Letter to prevent layout shifts during rasterization
  clone.style.width = '8.5in';
  clone.style.minHeight = '11in';
  clone.style.margin = '0';
  clone.style.padding = getComputedStyle(original).padding; // keep your page padding
  clone.style.background = '#ffffff';

  // Handle Discount row (toggle OFF or value 0 => remove)
  const enabled = document.getElementById('discount-toggle')
    ? document.getElementById('discount-toggle').checked
    : true; // default if toggle missing

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

  // Normalize the Tax Rate cell so it aligns with the $ column
  const rateCell = clone.querySelector('#taxrate-row .value');
  if (rateCell) {
    const srcRate = (document.getElementById('tax-rate')?.value ?? '13').replace(/[^\d.]/g, '') || '13';
    rateCell.innerHTML = `<span class="curr curr-placeholder">$</span><span class="amt">${srcRate}%</span>`;
  }

  // Convert Summary .row wrappers from display:contents -> grid for reliability
  clone.querySelectorAll('.totals-grid .row').forEach(row => {
    row.style.display = 'grid';
    row.style.gridTemplateColumns = 'auto 1fr var(--valw,16ch)';
    row.style.alignItems = 'center';
  });

  return clone;
}

/* ===== Off-screen sandbox (prevents clipping/cropping) ===== */
function createPdfSandbox() {
  const sandbox = document.createElement('div');
  sandbox.id = 'pdf-sandbox';
  sandbox.style.position = 'fixed';
  sandbox.style.left = '0';
  sandbox.style.top = '0';
  sandbox.style.zIndex = '-1';           // behind everything
  sandbox.style.opacity = '0';           // invisible but still lays out
  sandbox.style.pointerEvents = 'none';
  sandbox.style.background = '#ffffff';
  sandbox.style.width = '8.5in';
  sandbox.style.minHeight = '11in';
  document.body.appendChild(sandbox);
  return sandbox;
}

/* ===== Export ===== */
async function downloadPDF() {
  try {
    // Recalc to ensure latest numbers
    recalcAll();

    const clone = buildPrintClone();

    // Render clone in an off-screen sandbox (NOT clipped)
    const sandbox = createPdfSandbox();
    sandbox.innerHTML = ''; // just in case
    sandbox.appendChild(clone);

    // Wait for fonts & images to be ready inside the clone
    await waitForAssets(clone);

    const client = $('[data-bind="client_name"]').value?.trim() || 'Client';
    const qno    = $('[data-bind="quote_no"]').value?.trim() || 'Quote';
    const filename = `${client.replace(/[^\w\-]+/g,'_')}_${qno.replace(/[^\w\-]+/g,'_')}.pdf`;

    const opt = {
      margin: [0, 0, 0, 0],
      filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        scrollX: 0,
        scrollY: 0,
        // Use the rendered size in the sandbox to avoid left-shift
        windowWidth: clone.getBoundingClientRect().width,
        windowHeight: clone.getBoundingClientRect().height
      },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
      // Rely on CSS + legacy; avoid-all sometimes causes odd first-page offsets
      pagebreak: { mode: ['css', 'legacy'], avoid: ['.avoid-break', '.card', '.grid-2', '.signatures', '.items-table tr', '.totals-grid'] }
    };

    await html2pdf().set(opt).from(clone).save();

    // Cleanup
    sandbox.remove();
  } catch (e) {
    console.error('PDF export error', e);
    alert('PDF export failed. Please refresh and try again.');
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

  // Toolbar buttons — both generate the same PDF (no browser print)
  $('#btn-add-line').addEventListener('click', () => {
    $('#item-rows').appendChild(makeRow({ qty: 1, price: 0, taxable: true }));
    recalcAll();
  });
  $('#btn-download').addEventListener('click', downloadPDF);
  $('#btn-print').addEventListener('click', downloadPDF);

  $('#btn-preview').addEventListener('click', togglePreview);
  $('#btn-clear').addEventListener('click', clearForm);

  recalcAll();
});
