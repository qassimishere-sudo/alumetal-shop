const express = require('express');
const { Client } = require('pg');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. إعدادات Cloudinary (ببياناتك اللي بعتها)
cloudinary.config({ 
  cloud_name: 'ddpe5tfeb', 
  api_key: '524952667629949', 
  api_secret: 'Efs5S1A8RsX9lq5bmclBZtcSNFc' 
});

// 2. إعداد قاعدة البيانات (PostgreSQL)
// الرابط ده هنجيبه من إعدادات Render (هشرحلك تحت)
const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // شرط عشان يشتغل على Render
});

db.connect()
    .then(() => console.log('Connected to PostgreSQL Database'))
    .catch(err => console.error('Database Connection Error:', err));

// إنشاء الجدول (لو مش موجود) - بصيغة PostgreSQL
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

// 3. إعداد Multer (تخزين مؤقت للرفع)
const upload = multer({ dest: 'uploads/' });

// --- الروابط (Routes) ---

app.get('/', async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM projects ORDER BY id DESC");
        res.render('index', { projects: result.rows });
    } catch (err) {
        console.error(err);
        res.send("Error loading projects");
    }
});

app.get('/product/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const result = await db.query("SELECT * FROM projects WHERE id = $1", [id]);
        if (result.rows.length === 0) return res.redirect('/');
        
        const row = result.rows[0];
        row.imagesList = JSON.parse(row.images); 
        res.render('details', { product: row });
    } catch (err) {
        console.error(err);
        res.redirect('/');
    }
});

app.get('/admin-panel', (req, res) => {
    res.render('admin');
});

// 4. رفع المشروع (رفع الصور لـ Cloudinary)
app.post('/add-project', upload.array('photos', 10), async (req, res) => {
    const { title, description, category } = req.body;
    const files = req.files;

    if (!files || files.length === 0) return res.send("Please upload images");

    try {
        // رفع الصور لـ Cloudinary واحد تلو الآخر
        const uploadPromises = files.map(file => {
            return cloudinary.uploader.upload(file.path, { folder: "alumetal_projects" });
        });

        const uploadResults = await Promise.all(uploadPromises);

        // مسح الملفات المؤقتة من السيرفر لتوفير المساحة
        files.forEach(file => fs.unlinkSync(file.path));

        // استخراج روابط الصور الجديدة
        const imageUrls = uploadResults.map(result => result.secure_url);
        const mainImage = imageUrls[0];
        const imagesJSON = JSON.stringify(imageUrls);

        // الحفظ في قاعدة البيانات
        const insertQuery = `INSERT INTO projects (title, category, description, images, mainImage) VALUES ($1, $2, $3, $4, $5)`;
        await db.query(insertQuery, [title, category, description, imagesJSON, mainImage]);

        res.redirect('/');

    } catch (err) {
        console.error(err);
        res.send("Error uploading project: " + err.message);
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));