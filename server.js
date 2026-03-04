const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();

/* ════════════════════════════════════════
   🔥 PUERTO (DEBE IR ARRIBA)
════════════════════════════════════════ */
const PORT = process.env.PORT || 5000;

/* ════════════════════════════════════════
   🔥 CONFIGURACIÓN DE MULTER (UPLOADS)
════════════════════════════════════════ */

// Asegura que la carpeta uploads exista
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configuración de almacenamiento
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `cover_${Date.now()}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    const isValid =
      allowed.test(file.mimetype) &&
      allowed.test(path.extname(file.originalname).toLowerCase());

    isValid ? cb(null, true) : cb(new Error('Solo se permiten imágenes'));
  },
});

/* ════════════════════════════════════════
   🔥 MIDDLEWARES
════════════════════════════════════════ */

// ✅ CORS habilitado para producción
app.use(cors());

// JSON
app.use(express.json());

// Servir imágenes estáticas
app.use('/uploads', express.static(uploadDir));

/* ════════════════════════════════════════
   🔥 ENDPOINT PARA SUBIR IMÁGENES
════════════════════════════════════════ */

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió imagen' });
  }

  const baseUrl =
    process.env.BASE_URL ||
    `https://librosmed-backend-production.up.railway.app`;

  const url = `${baseUrl}/uploads/${req.file.filename}`;

  res.json({
    url,
    filename: req.file.filename,
  });
});

/* ════════════════════════════════════════
   🔥 RUTAS DE TU API
════════════════════════════════════════ */

app.use('/api/categories', require('./routes/categories'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));

/* ════════════════════════════════════════
   🔥 RUTA DE PRUEBA
════════════════════════════════════════ */

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'LibrosMed API funcionando 🚀' });
});

/* ════════════════════════════════════════
   🔥 SERVIDOR
════════════════════════════════════════ */

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});