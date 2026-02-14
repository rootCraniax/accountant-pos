const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== PostgreSQL Connection =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// ===== Database Init & Seed =====
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        sku VARCHAR(50) UNIQUE NOT NULL,
        price NUMERIC(10,2) NOT NULL,
        cost NUMERIC(10,2) NOT NULL,
        stock INTEGER NOT NULL DEFAULT 0,
        category VARCHAR(100) NOT NULL,
        tax NUMERIC(5,2) NOT NULL DEFAULT 15
      );

      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) DEFAULT '',
        email VARCHAR(255) DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        invoice_no VARCHAR(20) UNIQUE NOT NULL,
        date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        customer_id INTEGER REFERENCES customers(id),
        customer_name VARCHAR(255),
        items JSONB NOT NULL,
        subtotal NUMERIC(10,2) NOT NULL,
        tax NUMERIC(10,2) NOT NULL,
        grand_total NUMERIC(10,2) NOT NULL,
        payment_method VARCHAR(50) NOT NULL DEFAULT 'cash',
        amount_paid NUMERIC(10,2) NOT NULL,
        change NUMERIC(10,2) NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'completed'
      );
    `);

    // Seed products if table is empty
    const { rows } = await client.query('SELECT COUNT(*) FROM products');
    if (parseInt(rows[0].count) === 0) {
      await client.query(`
        INSERT INTO products (name, sku, price, cost, stock, category, tax) VALUES
          ('Ballpoint Pen (Box)', 'OFF-001', 12.99, 7.50, 150, 'Office Supplies', 15),
          ('A4 Paper Ream', 'OFF-002', 24.99, 14.00, 80, 'Office Supplies', 15),
          ('Desk Calculator', 'ELC-001', 45.00, 22.00, 35, 'Electronics', 15),
          ('USB Flash Drive 64GB', 'ELC-002', 29.99, 12.00, 60, 'Electronics', 15),
          ('Receipt Printer Roll', 'OFF-003', 8.50, 3.50, 200, 'Office Supplies', 15),
          ('Accounting Ledger Book', 'OFF-004', 35.00, 18.00, 45, 'Office Supplies', 15),
          ('Wireless Mouse', 'ELC-003', 55.00, 28.00, 40, 'Electronics', 15),
          ('Folder Organizer Set', 'OFF-005', 18.75, 9.00, 90, 'Office Supplies', 15)
      `);
    }

    // Seed customers if table is empty
    const custCount = await client.query('SELECT COUNT(*) FROM customers');
    if (parseInt(custCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO customers (name, phone, email) VALUES
          ('Walk-in Customer', '', ''),
          ('Ahmed Al-Rashid', '+966-50-1234567', 'ahmed@company.sa'),
          ('Fatima Holdings LLC', '+966-55-9876543', 'accounts@fatima.sa'),
          ('Gulf Trading Co.', '+966-54-1112233', 'procurement@gulftrade.sa')
      `);
    }

    // Log DB status
    const txCheck = await client.query('SELECT COUNT(*) FROM transactions');
    const prodCheck = await client.query('SELECT COUNT(*) FROM products');
    console.log(`Database initialized: ${prodCheck.rows[0].count} products, ${txCheck.rows[0].count} transactions`);
  } finally {
    client.release();
  }
}

// Helper: safely parse items JSONB (handles double-encoded strings)
function parseItems(items) {
  if (typeof items === 'string') {
    try { return JSON.parse(items); } catch { return []; }
  }
  return Array.isArray(items) ? items : [];
}

// ===== API Routes =====

// Products
app.get('/api/products', async (req, res) => {
  try {
    const { search, category } = req.query;
    let query = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      query += ` AND (LOWER(name) LIKE $${params.length} OR LOWER(sku) LIKE $${params.length})`;
    }
    if (category && category !== 'All') {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }

    query += ' ORDER BY id';
    const { rows } = await pool.query(query, params);
    res.json(rows.map(r => ({ ...r, price: parseFloat(r.price), cost: parseFloat(r.cost), tax: parseFloat(r.tax) })));
  } catch (err) {
    console.error('GET /api/products error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { name, sku, price, cost, stock, category, tax } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO products (name, sku, price, cost, stock, category, tax) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [name, sku, price, cost, stock, category, tax || 15]
    );
    const r = rows[0];
    res.json({ ...r, price: parseFloat(r.price), cost: parseFloat(r.cost), tax: parseFloat(r.tax) });
  } catch (err) {
    console.error('POST /api/products error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { name, sku, price, cost, stock, category, tax } = req.body;
    const { rows } = await pool.query(
      'UPDATE products SET name=$1, sku=$2, price=$3, cost=$4, stock=$5, category=$6, tax=$7 WHERE id=$8 RETURNING *',
      [name, sku, price, cost, stock, category, tax, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const r = rows[0];
    res.json({ ...r, price: parseFloat(r.price), cost: parseFloat(r.cost), tax: parseFloat(r.tax) });
  } catch (err) {
    console.error('PUT /api/products error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Customers
app.get('/api/customers', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM customers ORDER BY id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Transactions (Checkout)
app.post('/api/transactions', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { items, customerId, paymentMethod, amountPaid } = req.body;
    let subtotal = 0;
    let totalTax = 0;
    const lineItems = [];

    for (const item of items) {
      const { rows } = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [item.productId]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Product ${item.productId} not found` }); }
      const product = rows[0];
      product.price = parseFloat(product.price);
      product.cost = parseFloat(product.cost);
      product.tax = parseFloat(product.tax);

      if (product.stock < item.qty) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Insufficient stock for ${product.name}` }); }

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

      await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.qty, item.productId]);
    }

    const grandTotal = Math.round((subtotal + totalTax) * 100) / 100;
    const custResult = await client.query('SELECT * FROM customers WHERE id = $1', [customerId || 1]);
    const customer = custResult.rows[0] || { id: 1, name: 'Walk-in Customer' };

    // Generate invoice number
    const txCount = await client.query('SELECT COUNT(*) FROM transactions');
    const txNum = parseInt(txCount.rows[0].count) + 1001;
    const invoiceNo = `INV-${String(txNum).padStart(5, '0')}`;

    const paid = amountPaid || grandTotal;
    const change = Math.round((paid - grandTotal) * 100) / 100;

    // FIX: pass lineItems array directly — let pg handle JSONB serialization
    const { rows: txRows } = await client.query(
      `INSERT INTO transactions (invoice_no, customer_id, customer_name, items, subtotal, tax, grand_total, payment_method, amount_paid, change, status)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,'completed') RETURNING *`,
      [invoiceNo, customer.id, customer.name, JSON.stringify(lineItems), Math.round(subtotal * 100) / 100, Math.round(totalTax * 100) / 100, grandTotal, paymentMethod || 'cash', paid, change]
    );

    await client.query('COMMIT');

    const tx = txRows[0];
    console.log(`Transaction ${tx.invoice_no} saved: ${tx.grand_total} SAR, ${parseItems(tx.items).length} items`);

    res.json({
      id: tx.id,
      invoiceNo: tx.invoice_no,
      date: tx.date,
      customer: { id: tx.customer_id, name: tx.customer_name },
      items: parseItems(tx.items),
      subtotal: parseFloat(tx.subtotal),
      tax: parseFloat(tx.tax),
      grandTotal: parseFloat(tx.grand_total),
      paymentMethod: tx.payment_method,
      amountPaid: parseFloat(tx.amount_paid),
      change: parseFloat(tx.change),
      status: tx.status,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/transactions error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/transactions', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM transactions ORDER BY id DESC');
    res.json(rows.map(formatTx));
  } catch (err) {
    console.error('GET /api/transactions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/transactions/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM transactions WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(formatTx(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function formatTx(tx) {
  return {
    id: tx.id,
    invoiceNo: tx.invoice_no,
    date: tx.date,
    customer: { id: tx.customer_id, name: tx.customer_name },
    items: parseItems(tx.items),
    subtotal: parseFloat(tx.subtotal),
    tax: parseFloat(tx.tax),
    grandTotal: parseFloat(tx.grand_total),
    paymentMethod: tx.payment_method,
    amountPaid: parseFloat(tx.amount_paid),
    change: parseFloat(tx.change),
    status: tx.status,
  };
}

// Dashboard stats — uses CURRENT_DATE from PostgreSQL to avoid timezone mismatch
app.get('/api/dashboard', async (req, res) => {
  try {
    // Today's aggregated stats — use PostgreSQL CURRENT_DATE (no JS date mismatch)
    const todayStats = await pool.query(`
      SELECT
        COUNT(*)::int AS tx_count,
        COALESCE(SUM(grand_total), 0) AS revenue,
        COALESCE(SUM(tax), 0) AS tax_total,
        COALESCE(SUM(subtotal), 0) AS subtotal_total
      FROM transactions WHERE date::date = CURRENT_DATE
    `);
    const ts = todayStats.rows[0];

    // All-time stats
    const allTimeStats = await pool.query(`
      SELECT COUNT(*)::int AS tx_count, COALESCE(SUM(grand_total), 0) AS revenue
      FROM transactions
    `);
    const at = allTimeStats.rows[0];

    // All transactions for today — for profit & top selling calc
    const todayTx = await pool.query('SELECT items FROM transactions WHERE date::date = CURRENT_DATE');
    let totalProfit = 0;
    const productSales = {};
    for (const t of todayTx.rows) {
      const items = parseItems(t.items);
      for (const item of items) {
        const prod = await pool.query('SELECT cost FROM products WHERE id = $1', [item.productId]);
        const cost = prod.rows.length > 0 ? parseFloat(prod.rows[0].cost) : 0;
        totalProfit += (item.price - cost) * item.qty;
        productSales[item.name] = (productSales[item.name] || 0) + item.qty;
      }
    }

    // Top selling products today
    const topSelling = Object.entries(productSales)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, qty]) => ({ name, qty }));

    // Payment method breakdown today
    const paymentBreakdown = await pool.query(`
      SELECT payment_method, COUNT(*)::int AS count, COALESCE(SUM(grand_total), 0) AS total
      FROM transactions WHERE date::date = CURRENT_DATE
      GROUP BY payment_method ORDER BY total DESC
    `);

    // Low stock products
    const lowStock = await pool.query('SELECT * FROM products WHERE stock < 20 ORDER BY stock ASC');

    // Recent 10 transactions (all time, not just today)
    const recentTx = await pool.query('SELECT * FROM transactions ORDER BY id DESC LIMIT 10');

    // Sales last 7 days
    const salesByDay = await pool.query(`
      SELECT date::date AS day, COUNT(*)::int AS tx_count, COALESCE(SUM(grand_total), 0) AS revenue
      FROM transactions
      WHERE date >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY date::date ORDER BY day DESC
    `);

    console.log(`Dashboard: today=${ts.tx_count} tx, all-time=${at.tx_count} tx, recent=${recentTx.rows.length}`);

    res.json({
      today: {
        transactions: ts.tx_count,
        revenue: parseFloat(parseFloat(ts.revenue).toFixed(2)),
        tax: parseFloat(parseFloat(ts.tax_total).toFixed(2)),
        profit: parseFloat(totalProfit.toFixed(2)),
      },
      allTime: {
        transactions: at.tx_count,
        revenue: parseFloat(parseFloat(at.revenue).toFixed(2)),
      },
      topSelling,
      paymentBreakdown: paymentBreakdown.rows.map(r => ({
        method: r.payment_method,
        count: r.count,
        total: parseFloat(parseFloat(r.total).toFixed(2)),
      })),
      lowStock: lowStock.rows.map(r => ({ ...r, price: parseFloat(r.price), cost: parseFloat(r.cost), tax: parseFloat(r.tax) })),
      recentTransactions: recentTx.rows.map(formatTx),
      salesByDay: salesByDay.rows.map(r => ({
        day: r.day,
        transactions: r.tx_count,
        revenue: parseFloat(parseFloat(r.revenue).toFixed(2)),
      })),
    });
  } catch (err) {
    console.error('GET /api/dashboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Debug endpoint — check DB state
app.get('/api/debug', async (req, res) => {
  try {
    const products = await pool.query('SELECT COUNT(*) FROM products');
    const customers = await pool.query('SELECT COUNT(*) FROM customers');
    const transactions = await pool.query('SELECT COUNT(*) FROM transactions');
    const lastTx = await pool.query('SELECT id, invoice_no, date, grand_total, items FROM transactions ORDER BY id DESC LIMIT 1');
    const dbTime = await pool.query('SELECT NOW() AS now, CURRENT_DATE AS today');
    res.json({
      counts: {
        products: parseInt(products.rows[0].count),
        customers: parseInt(customers.rows[0].count),
        transactions: parseInt(transactions.rows[0].count),
      },
      dbTime: dbTime.rows[0],
      lastTransaction: lastTx.rows[0] ? {
        ...lastTx.rows[0],
        itemsType: typeof lastTx.rows[0].items,
        itemsParsed: parseItems(lastTx.rows[0].items),
      } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== Start =====
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`POS System running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to init DB:', err.message);
  process.exit(1);
});
