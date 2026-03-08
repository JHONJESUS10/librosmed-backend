const express  = require('express')
const router   = express.Router()
const pool     = require('../db')
const jwt      = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET || 'librosmed_secret_2024'

// ── Middleware admin ──────────────────────────────────────────
const authAdmin = async (req, res, next) => {
  const header = req.headers.authorization
  if (!header) return res.status(401).json({ error: 'No autorizado.' })
  try {
    const decoded = jwt.verify(header.split(' ')[1], JWT_SECRET)
    if (decoded.type !== 'admin') return res.status(403).json({ error: 'Acceso denegado.' })
    req.admin = decoded
    next()
  } catch {
    res.status(401).json({ error: 'Token inválido.' })
  }
}

// ══════════════════════════════════════════════════════════════
//  POST /api/sales  — Registrar una venta nueva
//  Llamado desde el frontend al hacer clic en "Pedir por WhatsApp"
// ══════════════════════════════════════════════════════════════
router.post('/', async (req, res) => {
  const { customer_name, customer_email, items, shipping, user_token } = req.body

  if (!customer_name || !items || items.length === 0) {
    return res.status(400).json({ error: 'Faltan datos de la venta.' })
  }

  // Detectar si el cliente está logueado
  let userId = null
  if (user_token) {
    try {
      const decoded = jwt.verify(user_token, JWT_SECRET)
      userId = decoded.id
    } catch {}
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Calcular totales consultando precio de compra de cada producto
    let totalSale = 0
    let totalCost = 0
    const enrichedItems = []

    for (const item of items) {
      const prod = await client.query(
        'SELECT title, price, purchase_price FROM products WHERE id = $1',
        [item.product_id]
      )
      if (prod.rows.length === 0) continue

      const product      = prod.rows[0]
      const salePrice    = parseFloat(product.price)
      const purchPrice   = parseFloat(product.purchase_price || 0)

      totalSale += salePrice  * item.quantity
      totalCost += purchPrice * item.quantity

      enrichedItems.push({
        product_id:     item.product_id,
        product_title:  product.title,
        quantity:       item.quantity,
        sale_price:     salePrice,
        purchase_price: purchPrice,
      })
    }

    const shippingCost = parseFloat(shipping || 0)
    totalSale += shippingCost

    // Insertar venta
    const saleResult = await client.query(
      `INSERT INTO sales (user_id, customer_name, customer_email, total_sale, total_cost, shipping)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userId, customer_name, customer_email || null, totalSale.toFixed(2), totalCost.toFixed(2), shippingCost]
    )
    const saleId = saleResult.rows[0].id

    // Insertar items de la venta
    for (const item of enrichedItems) {
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, product_title, quantity, sale_price, purchase_price)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [saleId, item.product_id, item.product_title, item.quantity, item.sale_price, item.purchase_price]
      )
    }

    await client.query('COMMIT')
    res.status(201).json({ message: 'Venta registrada.', sale_id: saleId })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Error al registrar venta:', err)
    res.status(500).json({ error: 'Error interno al registrar la venta.' })
  } finally {
    client.release()
  }
})

// ══════════════════════════════════════════════════════════════
//  GET /api/sales  — Lista de ventas (admin)
// ══════════════════════════════════════════════════════════════
router.get('/', authAdmin, async (req, res) => {
  try {
    const { limit = 50, offset = 0, status } = req.query

    let query = `
      SELECT s.*, u.name AS user_name
      FROM sales s
      LEFT JOIN users u ON s.user_id = u.id
    `
    const params = []
    if (status) {
      params.push(status)
      query += ` WHERE s.status = $${params.length}`
    }
    query += ` ORDER BY s.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    params.push(limit, offset)

    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: 'Error interno.' })
  }
})

// ══════════════════════════════════════════════════════════════
//  GET /api/sales/:id  — Detalle de una venta con sus items
// ══════════════════════════════════════════════════════════════
router.get('/reports/earnings:id', authAdmin, async (req, res) => {
  try {
    const sale = await pool.query(
      `SELECT s.*, u.name AS user_name, u.email AS user_email
       FROM sales s LEFT JOIN users u ON s.user_id = u.id
       WHERE s.id = $1`,
      [req.params.id]
    )
    if (sale.rows.length === 0) return res.status(404).json({ error: 'Venta no encontrada.' })

    const items = await pool.query(
      'SELECT * FROM sale_items WHERE sale_id = $1',
      [req.params.id]
    )

    res.json({ ...sale.rows[0], items: items.rows })
  } catch (err) {
    res.status(500).json({ error: 'Error interno.' })
  }
})

// ══════════════════════════════════════════════════════════════
//  PATCH /api/sales/:id/status  — Actualizar estado de venta
// ══════════════════════════════════════════════════════════════
router.patch('/:id/status', authAdmin, async (req, res) => {
  try {
    const { status } = req.body
    const valid = ['pendiente', 'confirmado', 'entregado', 'cancelado']
    if (!valid.includes(status)) return res.status(400).json({ error: 'Estado inválido.' })

    await pool.query('UPDATE sales SET status = $1 WHERE id = $2', [status, req.params.id])
    res.json({ message: 'Estado actualizado.' })
  } catch (err) {
    res.status(500).json({ error: 'Error interno.' })
  }
})

// ══════════════════════════════════════════════════════════════
//  GET /api/sales/reports/earnings  — Reporte de ganancias
// ══════════════════════════════════════════════════════════════
router.get('/reports/earnings', authAdmin, async (req, res) => {
  try {
    const { period = 'all' } = req.query

    let dateFilter = ''
    if (period === 'today')   dateFilter = "AND s.created_at >= CURRENT_DATE"
    if (period === 'week')    dateFilter = "AND s.created_at >= NOW() - INTERVAL '7 days'"
    if (period === 'month')   dateFilter = "AND s.created_at >= NOW() - INTERVAL '30 days'"

    // Totales generales
    const totals = await pool.query(`
      SELECT
        COUNT(*)                                    AS total_sales,
        COALESCE(SUM(total_sale), 0)                AS gross_revenue,
        COALESCE(SUM(total_cost), 0)                AS total_cost,
        COALESCE(SUM(total_sale - total_cost), 0)   AS net_profit,
        COALESCE(SUM(shipping), 0)                  AS total_shipping
      FROM sales s
      WHERE status != 'cancelado' ${dateFilter}
    `)

    // Ganancias por especialidad (categoría)
    const byCategory = await pool.query(`
      SELECT
        c.name                                          AS category,
        COUNT(DISTINCT si.sale_id)                      AS sales_count,
        COALESCE(SUM(si.sale_price * si.quantity), 0)   AS revenue,
        COALESCE(SUM(si.purchase_price * si.quantity),0) AS cost,
        COALESCE(SUM((si.sale_price - si.purchase_price) * si.quantity), 0) AS profit
      FROM sale_items si
      JOIN sales s      ON si.sale_id    = s.id
      JOIN products p   ON si.product_id = p.id
      JOIN categories c ON p.category_id = c.id
      WHERE s.status != 'cancelado' ${dateFilter}
      GROUP BY c.name
      ORDER BY profit DESC
    `)

    // Ventas por día (últimos 30 días)
    const byDay = await pool.query(`
      SELECT
        DATE(created_at)                               AS day,
        COUNT(*)                                       AS sales_count,
        COALESCE(SUM(total_sale), 0)                   AS revenue,
        COALESCE(SUM(total_sale - total_cost), 0)      AS profit
      FROM sales s
      WHERE status != 'cancelado'
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY day DESC
    `)

    res.json({
      totals:      totals.rows[0],
      byCategory:  byCategory.rows,
      byDay:       byDay.rows,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Error interno.' })
  }
})

module.exports = router