const { Pool } = require('pg');

// Si estamos en Railway (producción), usa SSL
// Si estamos en local (desarrollo), no usa SSL
const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

pool.connect()
  .then(() => console.log(`✅ Conectado a PostgreSQL (${isProduction ? 'Railway' : 'Local'})`))
  .catch(err => console.error("❌ Error de conexión", err));

module.exports = pool;