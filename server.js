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
        }
    });
});

// --- API ROUTES ---

// 1. SAVE NEW BILL (With Username)
app.post('/api/save-bill', (req, res) => {
    const { username, customerName, items, grandTotal, totalDiscount, totalTaxable, totalPayable } = req.body;

    const sqlInsert = `
        INSERT INTO bills (username, customer_name, items, grand_total, total_discount, total_taxable, total_payable) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sqlInsert, [username, customerName, JSON.stringify(items), grandTotal, totalDiscount, totalTaxable, totalPayable], (err, result) => {
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
        "SELECT total_payable, payment_status FROM bills WHERE id = ? AND username = ?",
        [billId, username],
        (selectErr, results) => {
            if (selectErr) return res.status(500).json({ error: selectErr.message });
            if (results.length === 0) return res.status(404).json({ error: "Bill not found or access denied." });

            const bill = results[0];
            const payableInPaise = Math.round(Number(bill.total_payable) * 100);
            const paidInPaise = Math.round(paidAmount * 100);

            if (bill.payment_status === 'PAID') {
                return res.status(409).json({ error: "This bill is already marked as PAID." });
            }
            if (paidInPaise < payableInPaise) {
                return res.status(400).json({
                    error: `Paid amount must be at least ₹${Number(bill.total_payable).toFixed(2)}.`
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
                res.json({ success: true, username: user.username });
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
