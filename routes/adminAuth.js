const express  = require('express')
const router   = express.Router()
const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const pool     = require('../db')

const JWT_SECRET = process.env.JWT_SECRET || 'librosmed_secret_2024'

// ── Middleware: verificar token de admin ──────────────────────
const authAdmin = async (req, res, next) => {
  const header = req.headers.authorization
  if (!header) return res.status(401).json({ error: 'No autorizado.' })
  try {
    const token   = header.split(' ')[1]
    const decoded = jwt.verify(token, JWT_SECRET)
    if (decoded.type !== 'admin') return res.status(403).json({ error: 'Acceso denegado.' })
    req.admin = decoded
    next()
  } catch {
    res.status(401).json({ error: 'Token inválido.' })
  }
}

// ── Middleware: solo main admin ───────────────────────────────
const onlyMain = (req, res, next) => {
  if (req.admin.role !== 'main') return res.status(403).json({ error: 'Solo el administrador principal puede hacer esto.' })
  next()
}

// ══════════════════════════════════════════════════════════════
//  POST /api/admin/auth/seed
//  Crea el main admin inicial (solo si no existe)
// ══════════════════════════════════════════════════════════════
router.post('/seed', async (req, res) => {
  try {
    const exists = await pool.query("SELECT id FROM admins WHERE role = 'main' AND password_hash != 'PENDIENTE'")
    if (exists.rows.length > 0) return res.status(409).json({ error: 'El main admin ya existe.' })

    const { name, email, password } = req.body
    if (!name || !email || !password) return res.status(400).json({ error: 'Faltan datos.' })

    const hash = await bcrypt.hash(password, 10)
    await pool.query(
      "UPDATE admins SET name = $1, email = $2, password_hash = $3 WHERE role = 'main'",
      [name, email, hash]
    )
    res.json({ message: 'Main admin configurado correctamente.' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error interno.' })
  }
})

// ══════════════════════════════════════════════════════════════
//  POST /api/admin/auth/login
//  Login para main admin y subadmins
// ══════════════════════════════════════════════════════════════
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Correo y contraseña obligatorios.' })

  try {
    const result = await pool.query('SELECT * FROM admins WHERE email = $1 AND is_active = TRUE', [email])
    if (result.rows.length === 0) return res.status(401).json({ error: 'Credenciales incorrectas.' })

    const admin = result.rows[0]
    if (admin.password_hash === 'PENDIENTE') return res.status(401).json({ error: 'Cuenta no configurada aún.' })

    const valid = await bcrypt.compare(password, admin.password_hash)
    if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas.' })

    const token = jwt.sign(
      { id: admin.id, email: admin.email, name: admin.name, role: admin.role, type: 'admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    )

    res.json({
      message: 'Sesión iniciada.',
      token,
      admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role }
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error interno.' })
  }
})

// ══════════════════════════════════════════════════════════════
//  POST /api/admin/auth/register
//  Registro de subadmin con código de invitación
// ══════════════════════════════════════════════════════════════
router.post('/register', async (req, res) => {
  const { name, email, password, invite_code } = req.body
  if (!name || !email || !password || !invite_code) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios, incluyendo el código de invitación.' })
  }

  try {
    // Verificar código de invitación
    const codeResult = await pool.query(
      'SELECT * FROM invite_codes WHERE code = $1 AND is_used = FALSE AND (expires_at IS NULL OR expires_at > NOW())',
      [invite_code]
    )
    if (codeResult.rows.length === 0) {
      return res.status(400).json({ error: 'Código de invitación inválido o expirado.' })
    }
    const inviteCode = codeResult.rows[0]

    // Verificar que el correo no exista
    const exists = await pool.query('SELECT id FROM admins WHERE email = $1', [email])
    if (exists.rows.length > 0) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' })

    // Crear subadmin
    const hash   = await bcrypt.hash(password, 10)
    const result = await pool.query(
      'INSERT INTO admins (name, email, password_hash, role, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role',
      [name, email, hash, 'subadmin', inviteCode.created_by]
    )
    const admin = result.rows[0]

    // Marcar código como usado
    await pool.query(
      'UPDATE invite_codes SET is_used = TRUE, used_by = $1 WHERE id = $2',
      [admin.id, inviteCode.id]
    )

    const token = jwt.sign(
      { id: admin.id, email: admin.email, name: admin.name, role: admin.role, type: 'admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    )

    res.status(201).json({ message: 'Cuenta de subadmin creada.', token, admin })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error interno.' })
  }
})

// ══════════════════════════════════════════════════════════════
//  POST /api/admin/auth/invite  — Generar código de invitación
//  Solo main admin
// ══════════════════════════════════════════════════════════════
router.post('/invite', authAdmin, onlyMain, async (req, res) => {
  try {
    const { expires_hours } = req.body
    const code = 'LIBROS-' + Math.random().toString(36).substring(2, 8).toUpperCase()

    let expiresAt = null
    if (expires_hours) {
      expiresAt = new Date(Date.now() + expires_hours * 3600000)
    }

    const result = await pool.query(
      'INSERT INTO invite_codes (code, created_by, expires_at) VALUES ($1, $2, $3) RETURNING *',
      [code, req.admin.id, expiresAt]
    )

    res.json({ message: 'Código generado.', code: result.rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error interno.' })
  }
})

// ══════════════════════════════════════════════════════════════
//  GET /api/admin/auth/invite  — Ver códigos generados
//  Solo main admin
// ══════════════════════════════════════════════════════════════
router.get('/invite', authAdmin, onlyMain, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ic.*, a.name AS used_by_name
       FROM invite_codes ic
       LEFT JOIN admins a ON ic.used_by = a.id
       WHERE ic.created_by = $1
       ORDER BY ic.created_at DESC`,
      [req.admin.id]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: 'Error interno.' })
  }
})

// ══════════════════════════════════════════════════════════════
//  DELETE /api/admin/auth/invite/:id  — Eliminar código
//  Solo main admin
// ══════════════════════════════════════════════════════════════
router.delete('/invite/:id', authAdmin, onlyMain, async (req, res) => {
  try {
    await pool.query('DELETE FROM invite_codes WHERE id = $1 AND created_by = $2', [req.params.id, req.admin.id])
    res.json({ message: 'Código eliminado.' })
  } catch (err) {
    res.status(500).json({ error: 'Error interno.' })
  }
})

// ══════════════════════════════════════════════════════════════
//  GET /api/admin/auth/subadmins  — Lista de subadmins
//  Solo main admin
// ══════════════════════════════════════════════════════════════
router.get('/subadmins', authAdmin, onlyMain, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email, role, is_active, created_at FROM admins WHERE role = 'subadmin' ORDER BY created_at DESC"
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: 'Error interno.' })
  }
})

// ══════════════════════════════════════════════════════════════
//  PATCH /api/admin/auth/subadmins/:id  — Activar/desactivar
//  Solo main admin
// ══════════════════════════════════════════════════════════════
router.patch('/subadmins/:id', authAdmin, onlyMain, async (req, res) => {
  try {
    const { is_active } = req.body
    await pool.query('UPDATE admins SET is_active = $1 WHERE id = $2', [is_active, req.params.id])
    res.json({ message: 'Subadmin actualizado.' })
  } catch (err) {
    res.status(500).json({ error: 'Error interno.' })
  }
})

// ══════════════════════════════════════════════════════════════
//  GET /api/admin/auth/users  — Lista de clientes registrados
//  Main admin y subadmins
// ══════════════════════════════════════════════════════════════
router.get('/users', authAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, phone, created_at FROM users ORDER BY created_at DESC'
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: 'Error interno.' })
  }
})

// ══════════════════════════════════════════════════════════════
//  GET /api/admin/auth/me  — Info del admin actual
// ══════════════════════════════════════════════════════════════
router.get('/me', authAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, created_at FROM admins WHERE id = $1',
      [req.admin.id]
    )
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: 'Error interno.' })
  }
})

module.exports = { router, authAdmin, onlyMain }