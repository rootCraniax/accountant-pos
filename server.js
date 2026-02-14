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

    console.log('Database initialized successfully');
  } finally {
    client.release();
  }
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

    const { rows: txRows } = await client.query(
      `INSERT INTO transactions (invoice_no, customer_id, customer_name, items, subtotal, tax, grand_total, payment_method, amount_paid, change, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'completed') RETURNING *`,
      [invoiceNo, customer.id, customer.name, JSON.stringify(lineItems), Math.round(subtotal * 100) / 100, Math.round(totalTax * 100) / 100, grandTotal, paymentMethod || 'cash', paid, change]
    );

    await client.query('COMMIT');

    const tx = txRows[0];
    res.json({
      id: tx.id,
      invoiceNo: tx.invoice_no,
      date: tx.date,
      customer: { id: tx.customer_id, name: tx.customer_name },
      items: tx.items,
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
    items: tx.items,
    subtotal: parseFloat(tx.subtotal),
    tax: parseFloat(tx.tax),
    grandTotal: parseFloat(tx.grand_total),
    paymentMethod: tx.payment_method,
    amountPaid: parseFloat(tx.amount_paid),
    change: parseFloat(tx.change),
    status: tx.status,
  };
}

// Dashboard stats
app.get('/api/dashboard', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const todayTx = await pool.query(
      "SELECT * FROM transactions WHERE date::date = $1",
      [today]
    );

    const txList = todayTx.rows;
    const totalRevenue = txList.reduce((sum, t) => sum + parseFloat(t.grand_total), 0);
    const totalTax = txList.reduce((sum, t) => sum + parseFloat(t.tax), 0);

    // Calculate profit
    let totalProfit = 0;
    for (const t of txList) {
      for (const item of t.items) {
        const prod = await pool.query('SELECT cost FROM products WHERE id = $1', [item.productId]);
        const cost = prod.rows.length > 0 ? parseFloat(prod.rows[0].cost) : 0;
        totalProfit += (item.price - cost) * item.qty;
      }
    }

    const lowStock = await pool.query('SELECT * FROM products WHERE stock < 20 ORDER BY stock ASC');
    const allTx = await pool.query('SELECT * FROM transactions ORDER BY id DESC');
    const recentTx = allTx.rows.slice(0, 5);

    res.json({
      today: {
        transactions: txList.length,
        revenue: Math.round(totalRevenue * 100) / 100,
        tax: Math.round(totalTax * 100) / 100,
        profit: Math.round(totalProfit * 100) / 100,
      },
      allTime: {
        transactions: allTx.rows.length,
        revenue: Math.round(allTx.rows.reduce((s, t) => s + parseFloat(t.grand_total), 0) * 100) / 100,
      },
      lowStock: lowStock.rows.map(r => ({ ...r, price: parseFloat(r.price), cost: parseFloat(r.cost), tax: parseFloat(r.tax) })),
      topSelling: [],
      recentTransactions: recentTx.map(formatTx),
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
