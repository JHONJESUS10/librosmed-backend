const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
require('dotenv').config();

const app = express();

/* ════════════════════════════════════════
   MULTER — Subida de imágenes
════════════════════════════════════════ */
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    cb(null, `cover_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|webp|gif/.test(file.mimetype) &&
               /jpeg|jpg|png|webp|gif/.test(path.extname(file.originalname).toLowerCase());
    ok ? cb(null, true) : cb(new Error('Solo se permiten imágenes'));
  },
});

/* ════════════════════════════════════════
   MIDDLEWARES
════════════════════════════════════════ */
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://librosmed-frontend.vercel.app',
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true,
}));

app.use(express.json());
app.use('/uploads', express.static(uploadDir));

/* ════════════════════════════════════════
   UPLOAD DE IMÁGENES
════════════════════════════════════════ */
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });

  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${process.env.PORT || 5000}`;

  res.json({ url: `${baseUrl}/uploads/${req.file.filename}`, filename: req.file.filename });
});

/* ════════════════════════════════════════
   RUTAS
════════════════════════════════════════ */
app.use('/api/categories',  require('./routes/categories'));
app.use('/api/products',    require('./routes/products'));
app.use('/api/orders',      require('./routes/orders'));
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/sales',       require('./routes/sales'));

// Admin auth (exporta router + middlewares)
const { router: adminAuthRouter } = require('./routes/adminAuth');
app.use('/api/admin/auth', adminAuthRouter);

/* ════════════════════════════════════════
   HEALTH CHECK
════════════════════════════════════════ */
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'LibrosMed API funcionando 🚀' });
});

/* ════════════════════════════════════════
   SERVIDOR
════════════════════════════════════════ */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`));