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
    database: process.env.DB_NAME
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
            customer_name VARCHAR(255) NOT NULL,
            items TEXT NOT NULL,
            grand_total DECIMAL(10, 2) NOT NULL,
            total_discount DECIMAL(10, 2) NOT NULL,
            total_taxable DECIMAL(10, 2) NOT NULL,
            total_payable DECIMAL(10, 2) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
    
    db.query(createTableQuery, (tableErr) => {
        if (tableErr) {
            console.error('❌ Error verifying/creating the table:', tableErr);
        } else {
            console.log('📊 MySQL "bills" table structure verified.');
        }
    });
});

// --- API ROUTES ---

// 1. SAVE NEW BILL RECORD
app.post('/api/save-bill', (req, res) => {
    const { customerName, items, grandTotal, totalDiscount, totalTaxable, totalPayable } = req.body;

    if (!customerName || !items || items.length === 0) {
        return res.status(400).json({ error: "Missing required invoicing data parameters." });
    }

    const sqlInsert = `
        INSERT INTO bills (customer_name, items, grand_total, total_discount, total_taxable, total_payable) 
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(
        sqlInsert, 
        [customerName, JSON.stringify(items), grandTotal, totalDiscount, totalTaxable, totalPayable], 
        (err, result) => {
            if (err) {
                console.error("Database INSERT error:", err);
                return res.status(500).json({ error: err.message });
            }
            res.json({ message: "Success", billId: result.insertId });
        }
    );
});

// 2. FETCH ALL SAVED BILL RECORDS (Sorted by latest first)
app.get('/api/get-bills', (req, res) => {
    const sqlSelect = "SELECT * FROM bills ORDER BY id DESC";

    db.query(sqlSelect, (err, results) => {
        if (err) {
            console.error("Database SELECT error:", err);
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

// 3. DELETE A SPECIFIC BILL LOG VIA ID
app.delete('/api/delete-bill/:id', (req, res) => {
    const billId = req.params.id;
    const sqlDeleteQuery = "DELETE FROM bills WHERE id = ?";
    
    db.query(sqlDeleteQuery, [billId], (err, result) => {
        if (err) {
            console.error("Error executing MySQL DELETE statement:", err);
            return res.status(500).json({ error: err.message });
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Record not found." });
        }
        res.json({ message: "Bill deleted successfully from database." });
    });
});

// Fallback to route straight to index.html for root requests
app.get('*', (pathReq, pathRes) => {
    pathRes.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`🚀 Node Server running actively on http://localhost:${PORT}`);
});