const express = require('express');
const router = express.Router();
const pool = require('../db');

// POST crear orden (pago simulado)
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const { customer_name, customer_email, items } = req.body;

    if (!customer_name || !customer_email || !items || items.length === 0) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    // Calcular total
    let total = 0;
    for (const item of items) {
      const product = await pool.query('SELECT price FROM products WHERE id = $1', [item.product_id]);
      if (product.rows.length === 0) {
        return res.status(400).json({ error: `Producto ${item.product_id} no encontrado` });
      }
      total += parseFloat(product.rows[0].price) * item.quantity;
    }

    await client.query('BEGIN');

    // Insertar orden
    const orderResult = await client.query(
      'INSERT INTO orders (customer_name, customer_email, total, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [customer_name, customer_email, total.toFixed(2), 'confirmed']
    );
    const order = orderResult.rows[0];

    // Insertar items
    for (const item of items) {
      const product = await client.query('SELECT price FROM products WHERE id = $1', [item.product_id]);
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
        [order.id, item.product_id, item.quantity, product.rows[0].price]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: '¡Pedido confirmado con éxito!',
      order: {
        id: order.id,
        customer_name: order.customer_name,
        customer_email: order.customer_email,
        total: order.total,
        status: order.status,
        created_at: order.created_at,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error al procesar el pedido' });
  } finally {
    client.release();
  }
});

// GET historial de órdenes por email
router.get('/history/:email', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, 
        json_agg(json_build_object(
          'product_id', oi.product_id,
          'quantity', oi.quantity,
          'unit_price', oi.unit_price,
          'title', p.title,
          'author', p.author
        )) as items
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE o.customer_email = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [req.params.email]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

module.exports = router;