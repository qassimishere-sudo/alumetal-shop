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

app.get('/', async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM projects ORDER BY id DESC");
        res.render('index', { projects: result.rows });
    } catch (err) {
        console.error(err);
        res.send("Error");
    }
});

app.get('/product/:id', async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
        if (result.rows.length === 0) return res.redirect('/');
        const row = result.rows[0];
        // إصلاح مشكلة الحروف الكبيرة في قاعدة البيانات
        const imagesStr = row.images || '[]';
        row.imagesList = JSON.parse(imagesStr);
        res.render('details', { product: row });
    } catch (err) {
        res.redirect('/');
    }
});

app.get('/admin-panel', async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM projects ORDER BY id DESC");
        res.render('admin', { projects: result.rows });
    } catch (err) {
        res.send("Error");
    }
});

// إضافة مشروع (يدعم صور متعددة)
app.post('/add-project', upload.array('photos', 20), async (req, res) => {
    const { title, description, category } = req.body;
    const files = req.files;

    if (!files || files.length === 0) return res.send("Please upload images");

    try {
        const uploadPromises = files.map(file => cloudinary.uploader.upload(file.path, { folder: "alumetal_projects" }));
        const uploadResults = await Promise.all(uploadPromises);
        files.forEach(file => fs.unlinkSync(file.path));

        const imageUrls = uploadResults.map(result => result.secure_url);
        // تأكدنا إن الاسم mainImage بحروف صغيرة عشان قاعدة البيانات
        const mainimage = imageUrls[0];
        const imagesJSON = JSON.stringify(imageUrls);

        await db.query(`INSERT INTO projects (title, category, description, images, mainImage) VALUES ($1, $2, $3, $4, $5)`, 
            [title, category, description, imagesJSON, mainimage]);

        res.redirect('/admin-panel');
    } catch (err) {
        res.send("Error: " + err.message);
    }
});

app.post('/delete-project/:id', async (req, res) => {
    try {
        await db.query("DELETE FROM projects WHERE id = $1", [req.params.id]);
        res.redirect('/admin-panel');
    } catch (err) {
        res.send("Error deleting");
    }
});

app.get('/edit-project/:id', async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
        if (result.rows.length === 0) return res.redirect('/admin-panel');
        // تأكد من تمرير mainimage بحروف صغيرة
        const proj = result.rows[0];
        // تصحيح الاسم للعرض
        if(proj.mainImage) proj.mainimage = proj.mainImage; 
        
        res.render('edit', { project: proj });
    } catch (err) {
        res.redirect('/admin-panel');
    }
});

// تحديث المشروع (المنطق الجديد للحذف والإضافة)
app.post('/update-project/:id', upload.array('photos', 20), async (req, res) => {
    const { title, description, category, deleteImages } = req.body;
    const files = req.files;
    const id = req.params.id;

    try {
        // 1. نجيب المشروع الحالي عشان نعرف الصور اللي فيه
        const currentProjectRes = await db.query("SELECT * FROM projects WHERE id = $1", [id]);
        const currentProject = currentProjectRes.rows[0];
        let currentImages = JSON.parse(currentProject.images || '[]');

        // 2. حذف الصور المحددة (لو المستخدم اختار حذف)
        // deleteImages ممكن يكون string (لو صورة واحدة) أو array (لو كذا صورة)
        let imagesToDelete = [];
        if (deleteImages) {
            imagesToDelete = Array.isArray(deleteImages) ? deleteImages : [deleteImages];
            // فلتر الصور: خلي بس الصور اللي مش موجودة في قائمة الحذف
            currentImages = currentImages.filter(img => !imagesToDelete.includes(img));
        }

        // 3. إضافة الصور الجديدة (لو المستخدم رفع)
        if (files && files.length > 0) {
            const uploadPromises = files.map(file => cloudinary.uploader.upload(file.path, { folder: "alumetal_projects" }));
            const uploadResults = await Promise.all(uploadPromises);
            files.forEach(file => fs.unlinkSync(file.path));
            
            const newImageUrls = uploadResults.map(result => result.secure_url);
            // دمج الصور القديمة (بعد الحذف) مع الجديدة
            currentImages = currentImages.concat(newImageUrls);
        }

        // 4. تحديد الصورة الرئيسية (أول صورة في القائمة الجديدة)
        // لو مسح كل الصور، بنحط صورة افتراضية أو نسيبها فاضية
        const mainimage = currentImages.length > 0 ? currentImages[0] : '';
        const imagesJSON = JSON.stringify(currentImages);

        // 5. التحديث في قاعدة البيانات
        await db.query(
            "UPDATE projects SET title = $1, description = $2, category = $3, images = $4, mainImage = $5 WHERE id = $6", 
            [title, description, category, imagesJSON, mainimage, id]
        );

        res.redirect('/admin-panel');

    } catch (err) {
        console.error(err);
        res.send("Error updating: " + err.message);
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));