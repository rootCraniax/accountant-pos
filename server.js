const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== In-Memory Data Store =====
let nextProductId = 9;
let nextTxId = 1001;

const products = [
  { id: 1, name: 'Ballpoint Pen (Box)', sku: 'OFF-001', price: 12.99, cost: 7.50, stock: 150, category: 'Office Supplies', tax: 15 },
  { id: 2, name: 'A4 Paper Ream', sku: 'OFF-002', price: 24.99, cost: 14.00, stock: 80, category: 'Office Supplies', tax: 15 },
  { id: 3, name: 'Desk Calculator', sku: 'ELC-001', price: 45.00, cost: 22.00, stock: 35, category: 'Electronics', tax: 15 },
  { id: 4, name: 'USB Flash Drive 64GB', sku: 'ELC-002', price: 29.99, cost: 12.00, stock: 60, category: 'Electronics', tax: 15 },
  { id: 5, name: 'Receipt Printer Roll', sku: 'OFF-003', price: 8.50, cost: 3.50, stock: 200, category: 'Office Supplies', tax: 15 },
  { id: 6, name: 'Accounting Ledger Book', sku: 'OFF-004', price: 35.00, cost: 18.00, stock: 45, category: 'Office Supplies', tax: 15 },
  { id: 7, name: 'Wireless Mouse', sku: 'ELC-003', price: 55.00, cost: 28.00, stock: 40, category: 'Electronics', tax: 15 },
  { id: 8, name: 'Folder Organizer Set', sku: 'OFF-005', price: 18.75, cost: 9.00, stock: 90, category: 'Office Supplies', tax: 15 },
];

const transactions = [];
const customers = [
  { id: 1, name: 'Walk-in Customer', phone: '', email: '' },
  { id: 2, name: 'Ahmed Al-Rashid', phone: '+966-50-1234567', email: 'ahmed@company.sa' },
  { id: 3, name: 'Fatima Holdings LLC', phone: '+966-55-9876543', email: 'accounts@fatima.sa' },
  { id: 4, name: 'Gulf Trading Co.', phone: '+966-54-1112233', email: 'procurement@gulftrade.sa' },
];

// ===== API Routes =====

// Products
app.get('/api/products', (req, res) => {
  const { search, category } = req.query;
  let result = [...products];
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }
  if (category && category !== 'All') {
    result = result.filter(p => p.category === category);
  }
  res.json(result);
});

app.post('/api/products', (req, res) => {
  const product = { id: nextProductId++, ...req.body };
  products.push(product);
  res.json(product);
});

app.put('/api/products/:id', (req, res) => {
  const idx = products.findIndex(p => p.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  products[idx] = { ...products[idx], ...req.body };
  res.json(products[idx]);
});

// Customers
app.get('/api/customers', (req, res) => res.json(customers));

// Transactions (Checkout)
app.post('/api/transactions', (req, res) => {
  const { items, customerId, paymentMethod, amountPaid } = req.body;
  let subtotal = 0;
  let totalTax = 0;
  const lineItems = [];

  for (const item of items) {
    const product = products.find(p => p.id === item.productId);
    if (!product) return res.status(400).json({ error: `Product ${item.productId} not found` });
    if (product.stock < item.qty) return res.status(400).json({ error: `Insufficient stock for ${product.name}` });

    const lineTotal = product.price * item.qty;
    const lineTax = lineTotal * (product.tax / 100);
    subtotal += lineTotal;
    totalTax += lineTax;

    lineItems.push({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      price: product.price,
      qty: item.qty,
      taxRate: product.tax,
      taxAmount: Math.round(lineTax * 100) / 100,
      total: Math.round((lineTotal + lineTax) * 100) / 100,
    });

    product.stock -= item.qty;
  }

  const grandTotal = Math.round((subtotal + totalTax) * 100) / 100;
  const customer = customers.find(c => c.id === customerId) || customers[0];

  const tx = {
    id: nextTxId++,
    invoiceNo: `INV-${String(nextTxId - 1).padStart(5, '0')}`,
    date: new Date().toISOString(),
    customer: { id: customer.id, name: customer.name },
    items: lineItems,
    subtotal: Math.round(subtotal * 100) / 100,
    tax: Math.round(totalTax * 100) / 100,
    grandTotal,
    paymentMethod: paymentMethod || 'cash',
    amountPaid: amountPaid || grandTotal,
    change: Math.round(((amountPaid || grandTotal) - grandTotal) * 100) / 100,
    status: 'completed',
  };

  transactions.push(tx);
  res.json(tx);
});

app.get('/api/transactions', (req, res) => res.json(transactions.slice().reverse()));

app.get('/api/transactions/:id', (req, res) => {
  const tx = transactions.find(t => t.id === parseInt(req.params.id));
  if (!tx) return res.status(404).json({ error: 'Not found' });
  res.json(tx);
});

// Dashboard stats
app.get('/api/dashboard', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const todayTx = transactions.filter(t => t.date.startsWith(today));
  const totalRevenue = todayTx.reduce((sum, t) => sum + t.grandTotal, 0);
  const totalTax = todayTx.reduce((sum, t) => sum + t.tax, 0);
  const totalProfit = todayTx.reduce((sum, t) => {
    return sum + t.items.reduce((s, item) => {
      const product = products.find(p => p.id === item.productId);
      return s + ((item.price - (product ? product.cost : 0)) * item.qty);
    }, 0);
  }, 0);

  const lowStock = products.filter(p => p.stock < 20);
  const topProducts = {};
  todayTx.forEach(t => t.items.forEach(item => {
    topProducts[item.name] = (topProducts[item.name] || 0) + item.qty;
  }));
  const topSelling = Object.entries(topProducts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, qty]) => ({ name, qty }));

  res.json({
    today: {
      transactions: todayTx.length,
      revenue: Math.round(totalRevenue * 100) / 100,
      tax: Math.round(totalTax * 100) / 100,
      profit: Math.round(totalProfit * 100) / 100,
    },
    allTime: {
      transactions: transactions.length,
      revenue: Math.round(transactions.reduce((s, t) => s + t.grandTotal, 0) * 100) / 100,
    },
    lowStock,
    topSelling,
    recentTransactions: transactions.slice(-5).reverse(),
  });
});

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`POS System running on port ${PORT}`);
});
