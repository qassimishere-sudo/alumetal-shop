const express = require('express');
const { Client } = require('pg');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { GoogleGenerativeAI } = require("@google/generative-ai");

// حط المفتاح اللي جبته من موقع جوجل هنا
const genAI = new GoogleGenerativeAI("AIzaSyB81WaedbRQg3-Ytb1RF2l4ncWh3fgGwNs");

// بنختار موديل سريع وذكي ومجاني
const model = genAI.getGenerativeModel({ model: "gemma-3-27b-it" }); // ✅ ده الصح
const fs = require('fs');
const path = require('path');
const session = require('express-session');

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

app.use(session({
    secret: 'MySecretKey123',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // خليها true لو رفعت على دومين https
}));

app.use(express.json());

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
// --- مسار الشات باستخدام Gemini ---
// --- مسار الشات المربوط بقاعدة البيانات ---
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    
    try {
        // 1. نجيب كل المشاريع من الداتا بيز الأول
        // بنختار الاسم والقسم والوصف عشان نوفر في الاستهلاك
        const dbResult = await db.query("SELECT title, category, description FROM projects");
        
        // 2. ننسق البيانات دي في شكل نص عشان الـ AI يفهمه
        let productsContext = "";
        if (dbResult.rows.length > 0) {
            productsContext = dbResult.rows.map(p => 
                `- مشروع: ${p.title} (القسم: ${p.category}) - تفاصيل: ${p.description}`
            ).join("\n");
        } else {
            productsContext = "لا توجد مشاريع مضافة حالياً.";
        }

        // 3. نبعت التعليمات + بيانات الداتا بيز + سؤال العميل للذكاء الاصطناعي
        const prompt = `
            أنت مساعد ذكي لشركة "الهندسية ميتال".
            مدير الشركة: م/ محسن فاروق.
            رقم التواصل: 01066603323.
            
            دي قائمة بالمشاريع والمنتجات اللي نفذناها وموجودة في قاعدة البيانات عندنا:
            ${productsContext}

            تعليماتك:
            1. استخدم المعلومات اللي فوق دي عشان ترد على العميل. يعني لو سأل "عندكم مطابخ؟" ولقيت مطابخ في القائمة، اشرح له مواصفاتها من البيانات.
            2. لو العميل سأل عن حاجة مش موجودة في القائمة، قوله بذكاء إننا نقدر نفذها عمولة.
            3. لهجتك مصرية ودودة، وهدفك تحديد ميعاد للمعاينة.
            
            سؤال العميل: ${message}
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        res.json({ reply: text });

    } catch (error) {
        console.error("Chat Error:", error);
        res.status(500).json({ reply: "معلش السيستم مشغول شوية، ممكن تكلمنا واتساب؟" });
    }
});
function requireAuth(req, res, next) {
    if (req.session.isAdmin) {
        next();
    } else {
        res.redirect('/');
    }
}

app.post('/admin-login', (req, res) => {
    const { password } = req.body;
    if (password === "Ammar@123") {
        req.session.isAdmin = true;
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.get('/', async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM projects ORDER BY id DESC");
        res.render('index', { projects: result.rows });
    } catch (err) {
        console.error(err);
        res.send("Error");
    }
});

// --- التعديل الأساسي هنا لحل مشكلة الـ 500 ---
app.get('/product/:id', async (req, res) => {
    try {
        // 1. التأكد من أن الـ ID رقم صحيح عشان قاعدة البيانات ما تضربش
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.redirect('/');

        const result = await db.query("SELECT * FROM projects WHERE id = $1", [id]);
        
        // 2. لو المنتج مش موجود يرجع للرئيسية بدل ما يوقع السيرفر
        if (result.rows.length === 0) return res.redirect('/');
        
        const row = result.rows[0];
        
        // 3. معالجة الصور بشكل آمن (Try-Catch) عشان لو الـ JSON بايظ السيرفر ما يوقفش
        try {
            const imagesStr = row.images || '[]';
            row.imagesList = JSON.parse(imagesStr);
            
            // تأكيد إنها مصفوفة
            if (!Array.isArray(row.imagesList)) {
                row.imagesList = [];
            }
        } catch (e) {
            console.error("Error parsing images JSON:", e);
            row.imagesList = []; // لو في خطأ نرجع مصفوفة فاضية
        }

        // 4. التأكد من وجود البيانات النصية عشان الـ EJS ما يضربش
        row.title = row.title || 'بدون عنوان';
        row.description = row.description || 'لا يوجد وصف';
        row.category = row.category || 'عام';

        // اسم الملف هنا 'details' بناء على كودك، تأكد إن ملف الـ view اسمه details.ejs
        res.render('details', { product: row });

    } catch (err) {
        console.error("Server Error in /product/:id ->", err);
        res.redirect('/'); // لو حصل أي خطأ غير متوقع رجعه للرئيسية
    }
});

app.get('/admin-panel', requireAuth, async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM projects ORDER BY id DESC");
        res.render('admin', { projects: result.rows });
    } catch (err) {
        res.send("Error");
    }
});

// إضافة مشروع
app.post('/add-project', upload.array('photos', 20), requireAuth, async (req, res) => {
    const { title, description, category } = req.body;
    const files = req.files;

    if (!files || files.length === 0) return res.send("Please upload images");

    try {
        const uploadPromises = files.map(file => cloudinary.uploader.upload(file.path, { 
            folder: "alumetal_projects"
        }));
        
        const uploadResults = await Promise.all(uploadPromises);
        
        // حذف الملفات المؤقتة
        files.forEach(file => {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        });

        const imageUrls = uploadResults.map(result => result.secure_url);
        const mainimage = imageUrls[0];
        const imagesJSON = JSON.stringify(imageUrls);

        await db.query(`INSERT INTO projects (title, category, description, images, mainImage) VALUES ($1, $2, $3, $4, $5)`, 
            [title, category, description, imagesJSON, mainimage]);

        res.redirect('/admin-panel');
    } catch (err) {
        console.error(err);
        res.send("Error: " + err.message);
    }
});

app.post('/delete-project/:id', requireAuth, async (req, res) => {
    try {
        await db.query("DELETE FROM projects WHERE id = $1", [req.params.id]);
        res.redirect('/admin-panel');
    } catch (err) {
        res.send("Error deleting");
    }
});

app.get('/edit-project/:id', requireAuth, async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
        if (result.rows.length === 0) return res.redirect('/admin-panel');
        const proj = result.rows[0];
        // تصحيح بسيط لاسم المتغير عشان التناسق
        if(proj.mainImage) proj.mainimage = proj.mainImage; 
        res.render('edit', { project: proj });
    } catch (err) {
        res.redirect('/admin-panel');
    }
});

// تحديث المشروع
app.post('/update-project/:id', upload.array('photos', 20), requireAuth, async (req, res) => {
    const { title, description, category, deleteImages } = req.body;
    const files = req.files;
    const id = req.params.id;

    try {
        const currentProjectRes = await db.query("SELECT * FROM projects WHERE id = $1", [id]);
        const currentProject = currentProjectRes.rows[0];
        
        let currentImages = [];
        try {
            currentImages = JSON.parse(currentProject.images || '[]');
        } catch (e) {
            currentImages = [];
        }

        let imagesToDelete = [];
        if (deleteImages) {
            imagesToDelete = Array.isArray(deleteImages) ? deleteImages : [deleteImages];
            currentImages = currentImages.filter(img => !imagesToDelete.includes(img));
        }

        if (files && files.length > 0) {
            const uploadPromises = files.map(file => cloudinary.uploader.upload(file.path, { 
                folder: "alumetal_projects"
            }));
            const uploadResults = await Promise.all(uploadPromises);
            
            // حذف الملفات المؤقتة
            files.forEach(file => {
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
            });
            
            const newImageUrls = uploadResults.map(result => result.secure_url);
            currentImages = currentImages.concat(newImageUrls);
        }

        const mainimage = currentImages.length > 0 ? currentImages[0] : '';
        const imagesJSON = JSON.stringify(currentImages);

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