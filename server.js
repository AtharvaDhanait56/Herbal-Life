require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json());


// Serve static frontend files automatically from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// --- MYSQL DATABASE CONNECTION ---
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
});

db.connect((err) => {
    if (err) {
        console.error('❌ Database connection failed:', err.stack);
        return;
    }
    console.log(`✅ Connected to MySQL Database "${process.env.DB_NAME}" smoothly.`);

    // Ensure the table exists with an appropriate schema to hold stringified item arrays
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS bills (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(255) NOT NULL,
            customer_name VARCHAR(255) NOT NULL,
            items TEXT NOT NULL,
            grand_total DECIMAL(10, 2) NOT NULL,
            total_discount DECIMAL(10, 2) NOT NULL,
            total_taxable DECIMAL(10, 2) NOT NULL,
            total_payable DECIMAL(10, 2) NOT NULL,
            payment_status VARCHAR(20) NOT NULL DEFAULT 'UNPAID',
            paid_amount DECIMAL(10, 2) NULL,
            paid_at DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;

    db.query(createTableQuery, (tableErr) => {
        if (tableErr) {
            console.error('❌ Error verifying/creating the table:', tableErr);
        } else {
            console.log('📊 MySQL "bills" table structure verified.');

            // Add payment fields to databases created by older versions of the app.
            const paymentColumns = [
                ["payment_status", "ALTER TABLE bills ADD COLUMN payment_status VARCHAR(20) NOT NULL DEFAULT 'UNPAID'"],
                ["paid_amount", "ALTER TABLE bills ADD COLUMN paid_amount DECIMAL(10, 2) NULL"],
                ["paid_at", "ALTER TABLE bills ADD COLUMN paid_at DATETIME NULL"]
            ];

            paymentColumns.forEach(([columnName, alterSql]) => {
                db.query("SHOW COLUMNS FROM bills LIKE ?", [columnName], (columnErr, columns) => {
                    if (columnErr) {
                        console.error(`Error checking bills.${columnName}:`, columnErr);
                        return;
                    }
                    if (columns.length === 0) {
                        db.query(alterSql, (alterErr) => {
                            if (alterErr) console.error(`Error adding bills.${columnName}:`, alterErr);
                        });
                    }
                });
            });

            // Add the selling_total field to databases created by older versions of the app.
            db.query("SHOW COLUMNS FROM bills LIKE 'selling_total'", (columnErr, columns) => {
                if (columnErr) {
                    console.error('Error checking bills.selling_total:', columnErr);
                    return;
                }
                if (columns.length === 0) {
                    db.query("ALTER TABLE bills ADD COLUMN selling_total DECIMAL(10, 2) NULL", (alterErr) => {
                        if (alterErr) console.error('Error adding bills.selling_total:', alterErr);
                    });
                }
            });
        }
    });

    // Ensure the products table exists to hold the catalog (cost price only - the price you
    // charge a customer is set per invoice from Saved Invoices, not per product).
    const createProductsTableQuery = `
        CREATE TABLE IF NOT EXISTS products (
            id INT AUTO_INCREMENT PRIMARY KEY,
            sku VARCHAR(50) NOT NULL,
            name VARCHAR(255) NOT NULL,
            cost_price DECIMAL(10, 2) NOT NULL,
            selling_price DECIMAL(10, 2) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_sku (sku)
        );
    `;

    db.query(createProductsTableQuery, (productsTableErr) => {
        if (productsTableErr) {
            console.error('❌ Error verifying/creating the products table:', productsTableErr);
            return;
        }
        console.log('📊 MySQL "products" table structure verified.');

        // Loosen selling_price to nullable for databases created by an earlier version of the app.
        db.query("ALTER TABLE products MODIFY COLUMN selling_price DECIMAL(10, 2) NULL", (modifyErr) => {
            if (modifyErr) console.error('Error making products.selling_price nullable:', modifyErr);
        });

        // One-time seed from the previously hardcoded product list, so existing products aren't lost.
        db.query("SELECT COUNT(*) AS count FROM products", (countErr, countResults) => {
            if (countErr) {
                console.error('Error checking products table contents:', countErr);
                return;
            }
            if (countResults[0].count > 0) return;

            const legacyProducts = {
                "1295 - AFRESH ENERGY DRINK MIX - LEMON": 773.00,
                "230K - AFRESH ENERGY DRINK MIX - KASHMIRI KAHWA": 773.00,
                "1247 - FORMULA 1 NUTRITIONAL SHAKE MIX - VANILLA": 2075.00,
                "1249 - FORMULA 1 NUTRITIONAL SHAKE MIX - MANGO": 2075.00,
                "287K - FORMULA 1 NUTRITIONAL SHAKE MIX - PAAN": 2075.00,
                "406K - FORMULA 1 NUTRITIONAL SHAKE MIX - MANGO FLAVOUR (750 G)": 3073.00,
                "409K - FORMULA 1 NUTRITIONAL SHAKE MIX - KULFI FLAVOUR (750 G)": 3073.00,
                "4114 - FORMULA 1 NUTRITIONAL SHAKE MIX - KULFI": 2075.00,
                "183K - SHAKE MATE": 621.00,
                "1279 - DINOSHAKE - CHOCOLICIOUS": 1061.00,
                "1569 - PERSONALIZED PROTEIN POWDER - 400G": 2366.00,
                "2865 - ACTIVE FIBER COMPLEX": 2437.00,
                "0020 - HERBALIFE CALCIUM TABLETS": 1145.00,
                "0077 - HERBAL CONTROL": 3269.00,
                "0111 - CELL-U-LOSS": 1623.00,
                "0555 - JOINT SUPPORT": 2338.00,
                "1232 - FORMULA 2 MULTIVITAMIN MINERAL & HERBAL TABLETS": 1908.00,
                "127K - WOMAN'S CHOICE": 1185.00,
                "1293 - ALOE PLUS": 1008.00,
                "1458 - HERBALIFE 24 HYDRATE": 1558.00,
                "3123 - CELL ACTIVATOR": 2109.00
            };

            const seedRows = Object.entries(legacyProducts).map(([key, costPrice]) => {
                const separatorIndex = key.indexOf(' - ');
                const sku = separatorIndex === -1 ? key : key.slice(0, separatorIndex);
                const name = separatorIndex === -1 ? key : key.slice(separatorIndex + 3);
                return [sku, name, costPrice, null];
            });

            db.query(
                "INSERT INTO products (sku, name, cost_price, selling_price) VALUES ?",
                [seedRows],
                (seedErr) => {
                    if (seedErr) console.error('Error seeding products table:', seedErr);
                    else console.log(`🌱 Seeded ${seedRows.length} products from the legacy product list.`);
                }
            );
        });
    });

    // Add an admin flag to the Users table (pre-provisioned outside this app) so only
    // admins can manage the product catalog. Existing users default to non-admin.
    db.query("SHOW COLUMNS FROM Users LIKE 'is_admin'", (columnErr, columns) => {
        if (columnErr) {
            console.error('Error checking Users.is_admin (Users table may not exist yet):', columnErr.message);
            return;
        }
        if (columns.length === 0) {
            db.query("ALTER TABLE Users ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0", (alterErr) => {
                if (alterErr) console.error('Error adding Users.is_admin:', alterErr);
                else console.log('📊 MySQL "Users.is_admin" column added.');
            });
        }
    });
});

// --- API ROUTES ---

// 1. SAVE NEW BILL (With Username)
app.post('/api/save-bill', (req, res) => {
    const { username, customerName, items, grandTotal, totalDiscount, totalTaxable, totalPayable, sellingTotal } = req.body;

    const sqlInsert = `
        INSERT INTO bills (username, customer_name, items, grand_total, total_discount, total_taxable, total_payable, selling_total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sqlInsert, [username, customerName, JSON.stringify(items), grandTotal, totalDiscount, totalTaxable, totalPayable, sellingTotal ?? null], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Success", billId: result.insertId });
    });
});

// 2. FETCH BILLS (Filtered by Username)
app.get('/api/get-bills/:username', (req, res) => {
    const user = req.params.username;
    const sqlSelect = "SELECT * FROM bills WHERE username = ? ORDER BY id DESC";

    db.query(sqlSelect, [user], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 3. DELETE BILL (Verified by Username)
app.delete('/api/delete-bill/:id/:username', (req, res) => {
    const billId = req.params.id;
    const user = req.params.username;

    // We check both ID and username to ensure users can only delete their own data
    const sqlDeleteQuery = "DELETE FROM bills WHERE id = ? AND username = ?";

    db.query(sqlDeleteQuery, [billId, user], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ error: "Record not found or access denied." });
        res.json({ message: "Bill deleted successfully." });
    });
});

// 4. MARK A BILL AS PAID (Verified by Username)
app.patch('/api/bills/:id/paid', (req, res) => {
    const billId = Number(req.params.id);
    const { username, amount } = req.body;
    const paidAmount = Number(amount);

    if (!Number.isInteger(billId) || billId <= 0 || !username) {
        return res.status(400).json({ error: "Invalid bill or username." });
    }
    if (!Number.isFinite(paidAmount) || paidAmount <= 0 || paidAmount > 99999999.99) {
        return res.status(400).json({ error: "Enter a valid paid amount." });
    }

    db.query(
        "SELECT total_payable, selling_total, payment_status FROM bills WHERE id = ? AND username = ?",
        [billId, username],
        (selectErr, results) => {
            if (selectErr) return res.status(500).json({ error: selectErr.message });
            if (results.length === 0) return res.status(404).json({ error: "Bill not found or access denied." });

            const bill = results[0];
            // Customers owe the selling total; fall back to purchase cost for legacy bills saved before selling price existed.
            const effectivePayable = bill.selling_total !== null && bill.selling_total !== undefined
                ? Number(bill.selling_total)
                : Number(bill.total_payable);
            const payableInPaise = Math.round(effectivePayable * 100);
            const paidInPaise = Math.round(paidAmount * 100);

            if (bill.payment_status === 'PAID') {
                return res.status(409).json({ error: "This bill is already marked as PAID." });
            }
            if (paidInPaise < payableInPaise) {
                return res.status(400).json({
                    error: `Paid amount must be at least ₹${effectivePayable.toFixed(2)}.`
                });
            }

            db.query(
                "UPDATE bills SET payment_status = 'PAID', paid_amount = ?, paid_at = NOW() WHERE id = ? AND username = ? AND payment_status <> 'PAID'",
                [(paidInPaise / 100).toFixed(2), billId, username],
                (updateErr, result) => {
                    if (updateErr) return res.status(500).json({ error: updateErr.message });
                    if (result.affectedRows === 0) return res.status(409).json({ error: "This bill is already marked as PAID." });
                    res.json({ message: "Bill marked as PAID.", paidAmount: paidInPaise / 100 });
                }
            );
        }
    );
});

// 4b. SET THE SELLING PRICE FOR A BILL (what the customer is actually charged, verified by username)
app.patch('/api/bills/:id/selling-total', (req, res) => {
    const billId = Number(req.params.id);
    const { username, sellingTotal } = req.body;
    const parsedTotal = Number(sellingTotal);

    if (!Number.isInteger(billId) || billId <= 0 || !username) {
        return res.status(400).json({ error: "Invalid bill or username." });
    }
    if (!Number.isFinite(parsedTotal) || parsedTotal <= 0 || parsedTotal > 99999999.99) {
        return res.status(400).json({ error: "Enter a valid selling price." });
    }

    db.query(
        "UPDATE bills SET selling_total = ? WHERE id = ? AND username = ?",
        [parsedTotal.toFixed(2), billId, username],
        (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            if (result.affectedRows === 0) return res.status(404).json({ error: "Bill not found or access denied." });
            res.json({ message: "Selling price updated.", sellingTotal: parsedTotal });
        }
    );
});

// --- PRODUCT CATALOG ROUTES ---

// Only admins may add/edit/delete products. Checks Users.is_admin for the given username
// and calls next() if they're an admin, otherwise responds 403.
function requireAdmin(req, res, next) {
    const username = req.body.username || req.query.username;
    if (!username) return res.status(400).json({ error: "username is required." });

    db.query("SELECT is_admin FROM Users WHERE username = ?", [username], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0 || !results[0].is_admin) {
            return res.status(403).json({ error: "Only admins can manage products." });
        }
        next();
    });
}

// GET all products
app.get('/api/products', (req, res) => {
    db.query("SELECT * FROM products ORDER BY name ASC", (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// ADD a new product (cost price only - selling is set per invoice, not per product)
app.post('/api/products', requireAdmin, (req, res) => {
    const { sku, name, costPrice } = req.body;
    if (!sku || !name || !Number.isFinite(Number(costPrice))) {
        return res.status(400).json({ error: "sku, name and costPrice are required." });
    }

    db.query(
        "INSERT INTO products (sku, name, cost_price) VALUES (?, ?, ?)",
        [sku.trim(), name.trim(), Number(costPrice)],
        (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: "A product with this SKU already exists." });
                return res.status(500).json({ error: err.message });
            }
            res.json({ message: "Product added.", productId: result.insertId });
        }
    );
});

// EDIT an existing product
app.put('/api/products/:id', requireAdmin, (req, res) => {
    const productId = Number(req.params.id);
    const { sku, name, costPrice } = req.body;
    if (!Number.isInteger(productId) || productId <= 0 || !sku || !name || !Number.isFinite(Number(costPrice))) {
        return res.status(400).json({ error: "sku, name and costPrice are required." });
    }

    db.query(
        "UPDATE products SET sku = ?, name = ?, cost_price = ? WHERE id = ?",
        [sku.trim(), name.trim(), Number(costPrice), productId],
        (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: "A product with this SKU already exists." });
                return res.status(500).json({ error: err.message });
            }
            if (result.affectedRows === 0) return res.status(404).json({ error: "Product not found." });
            res.json({ message: "Product updated." });
        }
    );
});

// DELETE a product
app.delete('/api/products/:id', requireAdmin, (req, res) => {
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({ error: "Invalid product id." });
    }

    db.query("DELETE FROM products WHERE id = ?", [productId], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ error: "Product not found." });
        res.json({ message: "Product deleted." });
    });
});

//5. Register

app.post('/api/register', (req, res) => {

    const { username, password } = req.body;

    db.query(
        "SELECT * FROM Users WHERE username = ?",
        [username],
        (err, results) => {

            if (err) {
                return res.status(500).json({
                    message: "Database Error"
                });
            }

            if (results.length > 0) {
                return res.status(400).json({
                    message: "Username already exists"
                });
            }

            db.query(
                "INSERT INTO Users (username, password) VALUES (?, ?)",
                [username, password],
                (err) => {

                    if (err) {
                        return res.status(500).json({
                            message: "Registration Failed"
                        });
                    }

                    res.json({
                        message: "User Registered Successfully"
                    });
                }
            );
        }
    );
});

//6. Login 

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    // Find user in table
    db.query("SELECT * FROM Users WHERE username = ?", [username], async (err, results) => {
        if (err) return res.status(500).json({ error: "Server error" });

        if (results.length > 0) {
            const user = results[0];
            // Compare entered password with stored hash
            const match = password === user.password;

            if (match) {
                res.json({ success: true, username: user.username, isAdmin: !!user.is_admin });
            } else {
                res.status(401).json({ success: false, message: "Invalid password!" });
            }
        } else {
            res.status(401).json({ success: false, message: "User not found!" });
        }
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
