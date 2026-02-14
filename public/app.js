// ===== State =====
let products = [];
let cart = [];
let customers = [];
let currentCategory = 'All';

// ===== DOM Elements =====
const $ = id => document.getElementById(id);
const productGrid = $('productGrid');
const cartItems = $('cartItems');
const cartSubtotal = $('cartSubtotal');
const cartTax = $('cartTax');
const cartTotal = $('cartTotal');
const checkoutBtn = $('checkoutBtn');
const clearCartBtn = $('clearCartBtn');
const customerSelect = $('customerSelect');

// ===== Navigation =====
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    const view = item.dataset.view;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    item.classList.add('active');
    $(`view-${view}`).classList.add('active');
    if (view === 'dashboard') loadDashboard();
    if (view === 'inventory') loadInventory();
    if (view === 'transactions') loadTransactions();
  });
});

// ===== API Helpers =====
async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

// ===== Products =====
async function loadProducts() {
  const search = $('productSearch').value;
  products = await api(`/products?search=${encodeURIComponent(search)}&category=${encodeURIComponent(currentCategory)}`);
  renderProducts();
}

function renderProducts() {
  productGrid.innerHTML = products.map(p => `
    <div class="product-tile" data-id="${p.id}">
      <div class="p-cat">${p.category}</div>
      <div class="p-name">${p.name}</div>
      <div class="p-sku">${p.sku}</div>
      <div class="p-price">SAR ${p.price.toFixed(2)}</div>
      <div class="p-stock ${p.stock < 20 ? 'low' : ''}">Stock: ${p.stock}</div>
    </div>
  `).join('');

  productGrid.querySelectorAll('.product-tile').forEach(tile => {
    tile.addEventListener('click', () => addToCart(parseInt(tile.dataset.id)));
  });
}

$('productSearch').addEventListener('input', debounce(loadProducts, 300));

document.querySelectorAll('.cat-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentCategory = tab.dataset.cat;
    loadProducts();
  });
});

// ===== Cart =====
function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  if (!product || product.stock <= 0) return;

  const existing = cart.find(c => c.productId === productId);
  if (existing) {
    if (existing.qty >= product.stock) return;
    existing.qty++;
  } else {
    cart.push({ productId, name: product.name, price: product.price, tax: product.tax, qty: 1, maxStock: product.stock });
  }
  renderCart();
}

function renderCart() {
  if (cart.length === 0) {
    cartItems.innerHTML = `
      <div class="cart-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>
        <p>Cart is empty</p>
        <span>Click products to add</span>
      </div>`;
    checkoutBtn.disabled = true;
  } else {
    cartItems.innerHTML = cart.map((item, i) => `
      <div class="cart-line">
        <div class="cart-line-info">
          <div class="cart-line-name">${item.name}</div>
          <div class="cart-line-price">SAR ${item.price.toFixed(2)} each</div>
        </div>
        <div class="cart-line-qty">
          <button class="qty-btn" onclick="updateQty(${i}, -1)">-</button>
          <span>${item.qty}</span>
          <button class="qty-btn" onclick="updateQty(${i}, 1)">+</button>
        </div>
        <div class="cart-line-total">SAR ${(item.price * item.qty).toFixed(2)}</div>
        <button class="cart-line-remove" onclick="removeFromCart(${i})">&times;</button>
      </div>
    `).join('');
    checkoutBtn.disabled = false;
  }
  updateTotals();
}

function updateQty(index, delta) {
  cart[index].qty += delta;
  if (cart[index].qty <= 0) cart.splice(index, 1);
  else if (cart[index].qty > cart[index].maxStock) cart[index].qty = cart[index].maxStock;
  renderCart();
}

function removeFromCart(index) {
  cart.splice(index, 1);
  renderCart();
}

function updateTotals() {
  let sub = 0, tax = 0;
  cart.forEach(item => {
    const lineTotal = item.price * item.qty;
    sub += lineTotal;
    tax += lineTotal * (item.tax / 100);
  });
  cartSubtotal.textContent = `SAR ${sub.toFixed(2)}`;
  cartTax.textContent = `SAR ${tax.toFixed(2)}`;
  cartTotal.textContent = `SAR ${(sub + tax).toFixed(2)}`;
}

clearCartBtn.addEventListener('click', () => { cart = []; renderCart(); });

// ===== Customers =====
async function loadCustomers() {
  customers = await api('/customers');
  customerSelect.innerHTML = customers.map(c =>
    `<option value="${c.id}">${c.name}</option>`
  ).join('');
}

// ===== Checkout =====
checkoutBtn.addEventListener('click', openCheckout);

function openCheckout() {
  let sub = 0, tax = 0;
  cart.forEach(item => {
    const lt = item.price * item.qty;
    sub += lt;
    tax += lt * (item.tax / 100);
  });
  const total = sub + tax;

  $('chkSubtotal').textContent = `SAR ${sub.toFixed(2)}`;
  $('chkTax').textContent = `SAR ${tax.toFixed(2)}`;
  $('chkTotal').textContent = `SAR ${total.toFixed(2)}`;
  $('amountPaid').value = '';
  $('changeAmount').textContent = 'SAR 0.00';

  // Quick cash buttons
  const quickCash = $('quickCash');
  const rounded = [Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100];
  const unique = [...new Set([total, ...rounded])].slice(0, 4);
  quickCash.innerHTML = unique.map(v =>
    `<button type="button" onclick="document.getElementById('amountPaid').value=${v.toFixed(2)};updateChange()">${v.toFixed(2)}</button>`
  ).join('');

  $('checkoutModal').classList.add('active');
}

$('closeCheckout').addEventListener('click', () => $('checkoutModal').classList.remove('active'));
$('cancelCheckout').addEventListener('click', () => $('checkoutModal').classList.remove('active'));

$('amountPaid').addEventListener('input', updateChange);

function updateChange() {
  let sub = 0, tax = 0;
  cart.forEach(item => { const lt = item.price * item.qty; sub += lt; tax += lt * (item.tax / 100); });
  const total = sub + tax;
  const paid = parseFloat($('amountPaid').value) || 0;
  const change = Math.max(0, paid - total);
  $('changeAmount').textContent = `SAR ${change.toFixed(2)}`;
}

// Toggle cash input visibility
document.querySelectorAll('input[name="payment"]').forEach(radio => {
  radio.addEventListener('change', () => {
    $('cashInputSection').style.display = radio.value === 'cash' ? 'block' : 'none';
  });
});

// Confirm checkout
$('confirmCheckout').addEventListener('click', async () => {
  const paymentMethod = document.querySelector('input[name="payment"]:checked').value;
  let sub = 0, tax = 0;
  cart.forEach(item => { const lt = item.price * item.qty; sub += lt; tax += lt * (item.tax / 100); });
  const total = sub + tax;
  const amountPaid = paymentMethod === 'cash' ? (parseFloat($('amountPaid').value) || total) : total;

  if (paymentMethod === 'cash' && amountPaid < total) {
    alert('Insufficient amount paid!');
    return;
  }

  const tx = await api('/transactions', {
    method: 'POST',
    body: {
      items: cart.map(c => ({ productId: c.productId, qty: c.qty })),
      customerId: parseInt(customerSelect.value),
      paymentMethod,
      amountPaid,
    },
  });

  if (tx.error) {
    alert(tx.error);
    return;
  }

  $('checkoutModal').classList.remove('active');
  cart = [];
  renderCart();
  loadProducts();
  showReceipt(tx);
});

// ===== Receipt =====
function showReceipt(tx) {
  const date = new Date(tx.date);
  $('receiptContent').innerHTML = `
    <div class="receipt-header">
      <h2>AccuPOS</h2>
      <p>Accountant Edition - Official Receipt</p>
      <p>VAT Registration: 300000000000003</p>
    </div>
    <div class="receipt-meta">
      <div><strong>Invoice:</strong> ${tx.invoiceNo}</div>
      <div><strong>Date:</strong> ${date.toLocaleDateString()}</div>
      <div><strong>Time:</strong> ${date.toLocaleTimeString()}</div>
      <div><strong>Customer:</strong> ${tx.customer.name}</div>
      <div><strong>Payment:</strong> ${tx.paymentMethod.toUpperCase()}</div>
      <div><strong>Cashier:</strong> System Admin</div>
    </div>
    <table class="receipt-items">
      <thead>
        <tr><th>Item</th><th>Qty</th><th>Price</th><th>VAT</th><th>Total</th></tr>
      </thead>
      <tbody>
        ${tx.items.map(item => `
          <tr>
            <td>${item.name}</td>
            <td>${item.qty}</td>
            <td>${item.price.toFixed(2)}</td>
            <td>${item.taxAmount.toFixed(2)}</td>
            <td>${item.total.toFixed(2)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="receipt-totals">
      <div class="r-row"><span>Subtotal:</span><span>SAR ${tx.subtotal.toFixed(2)}</span></div>
      <div class="r-row"><span>VAT (15%):</span><span>SAR ${tx.tax.toFixed(2)}</span></div>
      <div class="r-row r-total"><span>Grand Total:</span><span>SAR ${tx.grandTotal.toFixed(2)}</span></div>
      ${tx.paymentMethod === 'cash' ? `
        <div class="r-row"><span>Amount Paid:</span><span>SAR ${tx.amountPaid.toFixed(2)}</span></div>
        <div class="r-row"><span>Change:</span><span>SAR ${tx.change.toFixed(2)}</span></div>
      ` : ''}
    </div>
    <div class="receipt-footer">
      <p>Thank you for your business!</p>
      <p>All prices include VAT where applicable.</p>
    </div>
  `;
  $('receiptModal').classList.add('active');
}

$('closeReceipt').addEventListener('click', () => $('receiptModal').classList.remove('active'));
$('closeReceiptBtn').addEventListener('click', () => $('receiptModal').classList.remove('active'));
$('printReceipt').addEventListener('click', () => window.print());

// ===== Dashboard =====
async function loadDashboard() {
  $('dashDate').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const data = await api('/dashboard');

  // Today stats
  $('statRevenue').textContent = `SAR ${data.today.revenue.toFixed(2)}`;
  $('statProfit').textContent = `SAR ${data.today.profit.toFixed(2)}`;
  $('statTxCount').textContent = data.today.transactions;
  $('statTax').textContent = `SAR ${data.today.tax.toFixed(2)}`;

  // All-time stats
  $('statAllTimeTx').textContent = data.allTime.transactions;
  $('statAllTimeRev').textContent = `SAR ${data.allTime.revenue.toFixed(2)}`;

  // Recent transactions from DB
  const tbody = $('dashRecentTx');
  if (data.recentTransactions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No transactions yet - make a sale!</td></tr>';
  } else {
    tbody.innerHTML = data.recentTransactions.map(tx => {
      const date = new Date(tx.date);
      return `
        <tr>
          <td><strong>${tx.invoiceNo}</strong></td>
          <td>${date.toLocaleDateString()} ${date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</td>
          <td>${tx.customer.name}</td>
          <td style="text-transform:uppercase;font-size:0.78rem;font-weight:600">${tx.paymentMethod}</td>
          <td><strong>SAR ${tx.grandTotal.toFixed(2)}</strong></td>
          <td><span class="status-badge completed">${tx.status}</span></td>
        </tr>`;
    }).join('');
  }

  // Top selling products
  const topSelling = $('dashTopSelling');
  if (!data.topSelling || data.topSelling.length === 0) {
    topSelling.innerHTML = '<p class="empty-text">No sales yet today</p>';
  } else {
    const maxQty = Math.max(...data.topSelling.map(p => p.qty));
    topSelling.innerHTML = data.topSelling.map((p, i) => `
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:4px">
          <span>${i + 1}. ${p.name}</span>
          <strong>${p.qty} sold</strong>
        </div>
        <div style="height:6px;background:var(--border-light);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${(p.qty / maxQty * 100)}%;background:linear-gradient(90deg,var(--primary),var(--purple));border-radius:3px"></div>
        </div>
      </div>
    `).join('');
  }

  // Payment breakdown
  const payBreak = $('dashPaymentBreakdown');
  if (!data.paymentBreakdown || data.paymentBreakdown.length === 0) {
    payBreak.innerHTML = '<p class="empty-text">No payments yet today</p>';
  } else {
    const colors = { cash: 'var(--success)', card: 'var(--blue)', bank_transfer: 'var(--purple)' };
    payBreak.innerHTML = data.paymentBreakdown.map(p => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-light)">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:10px;height:10px;border-radius:50%;background:${colors[p.method] || 'var(--text-muted)'}"></div>
          <span style="font-size:0.85rem;text-transform:capitalize;font-weight:500">${p.method.replace('_', ' ')}</span>
        </div>
        <div style="text-align:right">
          <div style="font-size:0.85rem;font-weight:700">SAR ${p.total.toFixed(2)}</div>
          <div style="font-size:0.72rem;color:var(--text-muted)">${p.count} transaction${p.count > 1 ? 's' : ''}</div>
        </div>
      </div>
    `).join('');
  }

  // Low stock
  const lowStock = $('dashLowStock');
  if (data.lowStock.length === 0) {
    lowStock.innerHTML = '<p class="empty-text">All stock levels OK</p>';
  } else {
    lowStock.innerHTML = data.lowStock.map(p => `
      <div class="low-stock-item">
        <span>${p.name} <small style="color:var(--text-muted)">(${p.sku})</small></span>
        <span class="stock-qty">${p.stock} left</span>
      </div>
    `).join('');
  }

  // Sales by day (last 7 days)
  const salesBody = $('dashSalesByDay');
  if (!data.salesByDay || data.salesByDay.length === 0) {
    salesBody.innerHTML = '<tr><td colspan="4" class="empty-row">No sales data yet</td></tr>';
  } else {
    const maxRev = Math.max(...data.salesByDay.map(d => d.revenue));
    salesBody.innerHTML = data.salesByDay.map(d => {
      const date = new Date(d.day);
      const barWidth = maxRev > 0 ? (d.revenue / maxRev * 100) : 0;
      return `
        <tr>
          <td>${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</td>
          <td><strong>${d.transactions}</strong></td>
          <td>SAR ${d.revenue.toFixed(2)}</td>
          <td><div style="height:8px;background:var(--border-light);border-radius:4px;min-width:100px"><div style="height:100%;width:${barWidth}%;background:linear-gradient(90deg,var(--success),var(--blue));border-radius:4px"></div></div></td>
        </tr>`;
    }).join('');
  }
}
// expose globally for refresh button
window.loadDashboard = loadDashboard;

// ===== Inventory =====
async function loadInventory() {
  const search = $('invSearch') ? $('invSearch').value : '';
  const prods = await api(`/products?search=${encodeURIComponent(search)}`);
  const tbody = $('invTableBody');
  tbody.innerHTML = prods.map(p => `
    <tr>
      <td><strong>${p.sku}</strong></td>
      <td>${p.name}</td>
      <td>${p.category}</td>
      <td>SAR ${p.cost.toFixed(2)}</td>
      <td>SAR ${p.price.toFixed(2)}</td>
      <td><span style="color:${p.stock < 20 ? 'var(--danger)' : 'var(--success)'}; font-weight:600">${p.stock}</span></td>
      <td>${p.tax}%</td>
      <td><button class="btn btn-sm btn-secondary" onclick="editProduct(${p.id})">Edit</button></td>
    </tr>
  `).join('');
}

if ($('invSearch')) {
  $('invSearch').addEventListener('input', debounce(loadInventory, 300));
}

// ===== Product Modal =====
$('addProductBtn').addEventListener('click', () => {
  $('productModalTitle').textContent = 'Add Product';
  $('editProductId').value = '';
  $('productForm').reset();
  $('pTax').value = 15;
  $('productModal').classList.add('active');
});

$('closeProduct').addEventListener('click', () => $('productModal').classList.remove('active'));
$('cancelProduct').addEventListener('click', () => $('productModal').classList.remove('active'));

window.editProduct = async function(id) {
  const prods = await api('/products');
  const p = prods.find(pr => pr.id === id);
  if (!p) return;
  $('productModalTitle').textContent = 'Edit Product';
  $('editProductId').value = p.id;
  $('pName').value = p.name;
  $('pSku').value = p.sku;
  $('pCost').value = p.cost;
  $('pPrice').value = p.price;
  $('pStock').value = p.stock;
  $('pTax').value = p.tax;
  $('pCategory').value = p.category;
  $('productModal').classList.add('active');
};

$('saveProduct').addEventListener('click', async () => {
  const data = {
    name: $('pName').value,
    sku: $('pSku').value,
    cost: parseFloat($('pCost').value),
    price: parseFloat($('pPrice').value),
    stock: parseInt($('pStock').value),
    tax: parseFloat($('pTax').value),
    category: $('pCategory').value,
  };

  if (!data.name || !data.sku) return alert('Name and SKU required');

  const editId = $('editProductId').value;
  if (editId) {
    await api(`/products/${editId}`, { method: 'PUT', body: data });
  } else {
    await api('/products', { method: 'POST', body: data });
  }

  $('productModal').classList.remove('active');
  loadInventory();
  loadProducts();
});

// ===== Transactions =====
async function loadTransactions() {
  const txs = await api('/transactions');
  const tbody = $('txTableBody');
  if (txs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">No transactions recorded</td></tr>';
    return;
  }
  tbody.innerHTML = txs.map(tx => {
    const date = new Date(tx.date);
    return `
      <tr>
        <td><strong>${tx.invoiceNo}</strong></td>
        <td>${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
        <td>${tx.customer.name}</td>
        <td>${tx.items.length}</td>
        <td>SAR ${tx.subtotal.toFixed(2)}</td>
        <td>SAR ${tx.tax.toFixed(2)}</td>
        <td><strong>SAR ${tx.grandTotal.toFixed(2)}</strong></td>
        <td>${tx.paymentMethod.toUpperCase()}</td>
        <td><button class="btn btn-sm btn-secondary" onclick="viewReceipt(${tx.id})">Receipt</button></td>
      </tr>
    `;
  }).join('');
}

window.viewReceipt = async function(id) {
  const tx = await api(`/transactions/${id}`);
  if (tx.error) return;
  showReceipt(tx);
};

// ===== Utilities =====
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// ===== Init =====
loadProducts();
loadCustomers();
