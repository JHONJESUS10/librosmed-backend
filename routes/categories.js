const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET todas las categorías
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
  SELECT 
    c.id,
    c.name,
    c.slug,
    COUNT(p.id) AS product_count
  FROM categories c
  LEFT JOIN products p ON c.id = p.category_id
  GROUP BY c.id, c.name, c.slug
  ORDER BY c.name
`);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener categorías' });
  }
});

// GET categoría por slug
router.get('/:slug', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM categories WHERE slug = $1',
      [req.params.slug]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener categoría' });
  }
});

module.exports = router;