const express = require('express');
const { Client } = require('pg');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// إعدادات Cloudinary
cloudinary.config({ 
  cloud_name: 'ddpe5tfeb', 
  api_key: '524952667629949', 
  api_secret: 'Efs5S1A8RsX9lq5bmclBZtcSNFc' 
});

// إعداد قاعدة البيانات
const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

db.connect()
    .then(() => console.log('Connected to PostgreSQL Database'))
    .catch(err => console.error('Database Connection Error:', err));

const createTableQuery = `
    CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        title TEXT,
        category TEXT,
        description TEXT,
        images TEXT, 
        mainImage TEXT
    )
`;
db.query(createTableQuery);

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: 'uploads/' });

// --- الروابط (Routes) ---

// الصفحة الرئيسية
app.get('/', async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM projects ORDER BY id DESC");
        res.render('index', { projects: result.rows });
    } catch (err) {
        console.error(err);
        res.send("Error");
    }
});

// صفحة التفاصيل
app.get('/product/:id', async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
        if (result.rows.length === 0) return res.redirect('/');
        const row = result.rows[0];
        row.imagesList = JSON.parse(row.images); 
        res.render('details', { product: row });
    } catch (err) {
        res.redirect('/');
    }
});

// لوحة التحكم (تعرض قائمة المشاريع الآن)
app.get('/admin-panel', async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM projects ORDER BY id DESC");
        res.render('admin', { projects: result.rows });
    } catch (err) {
        res.send("Error");
    }
});

// إضافة مشروع
app.post('/add-project', upload.array('photos', 10), async (req, res) => {
    const { title, description, category } = req.body;
    const files = req.files;

    if (!files || files.length === 0) return res.send("Please upload images");

    try {
        const uploadPromises = files.map(file => cloudinary.uploader.upload(file.path, { folder: "alumetal_projects" }));
        const uploadResults = await Promise.all(uploadPromises);
        files.forEach(file => fs.unlinkSync(file.path));

        const imageUrls = uploadResults.map(result => result.secure_url);
        const mainImage = imageUrls[0];
        const imagesJSON = JSON.stringify(imageUrls);

        await db.query(`INSERT INTO projects (title, category, description, images, mainImage) VALUES ($1, $2, $3, $4, $5)`, 
            [title, category, description, imagesJSON, mainImage]);

        res.redirect('/admin-panel');
    } catch (err) {
        res.send("Error: " + err.message);
    }
});

// حذف مشروع
app.post('/delete-project/:id', async (req, res) => {
    try {
        await db.query("DELETE FROM projects WHERE id = $1", [req.params.id]);
        res.redirect('/admin-panel');
    } catch (err) {
        res.send("Error deleting");
    }
});

// صفحة تعديل مشروع (GET)
app.get('/edit-project/:id', async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
        if (result.rows.length === 0) return res.redirect('/admin-panel');
        res.render('edit', { project: result.rows[0] });
    } catch (err) {
        res.redirect('/admin-panel');
    }
});

// حفظ التعديل (POST) - تعديل البيانات فقط بدون الصور حالياً للسهولة
app.post('/update-project/:id', async (req, res) => {
    const { title, description, category } = req.body;
    try {
        await db.query("UPDATE projects SET title = $1, description = $2, category = $3 WHERE id = $4", 
            [title, description, category, req.params.id]);
        res.redirect('/admin-panel');
    } catch (err) {
        res.send("Error updating");
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));