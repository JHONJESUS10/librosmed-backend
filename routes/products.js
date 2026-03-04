const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET todos los productos (con filtros opcionales)
router.get('/', async (req, res) => {
  try {
    const { category, search, featured, limit = 50 } = req.query;
    let query = `
      SELECT p.*, c.name as category_name, c.slug as category_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (category) {
      params.push(category);
      query += ` AND c.slug = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (p.title ILIKE $${params.length} OR p.author ILIKE $${params.length})`;
    }
    if (featured === 'true') {
      query += ` AND p.is_featured = true`;
    }

    params.push(parseInt(limit));
    query += ` ORDER BY p.created_at DESC LIMIT $${params.length}`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

// GET producto por ID
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, c.name as category_name, c.slug as category_slug
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener producto' });
  }
});
// POST — crear producto nuevo
router.post('/', async (req, res) => {
  try {
    const { title, author, price, category_id, description,
            edition, pages, isbn, language, rating,
            stock, is_featured, cover_url } = req.body;

    const result = await pool.query(
      `INSERT INTO products 
        (title, author, price, category_id, description, edition, pages, isbn, language, rating, stock, is_featured, cover_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [title, author, price, category_id, description || null,
       edition || null, pages || null, isbn || null,
       language || 'Español', rating || 4.5,
       stock || 10, is_featured || false, cover_url || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear producto: ' + err.message });
  }
});

// PUT — actualizar producto
router.put('/:id', async (req, res) => {
  try {
    const { title, author, price, category_id, description,
            edition, pages, isbn, language, rating,
            stock, is_featured, cover_url } = req.body;

    const result = await pool.query(
      `UPDATE products SET
        title=$1, author=$2, price=$3, category_id=$4,
        description=$5, edition=$6, pages=$7, isbn=$8,
        language=$9, rating=$10, stock=$11,
        is_featured=$12, cover_url=$13
       WHERE id=$14 RETURNING *`,
      [title, author, price, category_id, description || null,
       edition || null, pages || null, isbn || null,
       language || 'Español', rating || 4.5,
       stock || 10, is_featured || false, cover_url || null,
       req.params.id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar: ' + err.message });
  }
});

// DELETE — eliminar producto
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
    res.json({ message: 'Producto eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

module.exports = router;