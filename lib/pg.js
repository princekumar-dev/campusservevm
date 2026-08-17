import pg from 'pg'
import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'

dotenv.config()

const { Pool } = pg

const DATABASE_URL = process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRESQL_URL ||
  null

console.log('🐘 PostgreSQL URI:', DATABASE_URL ? 'SET (hidden)' : 'NOT SET')

if (!DATABASE_URL) {
  console.error('lib/pg.js: No valid DATABASE_URL found. Set DATABASE_URL in your .env file.')
}

let cachedPool = null

export function getPool() {
  if (cachedPool) return cachedPool

  cachedPool = new Pool({
    connectionString: DATABASE_URL,
    max: 20,
    min: 0,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  })

  cachedPool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err)
  })

  return cachedPool
}

// Transaction helper
export async function transaction(fn) {
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Initialize database schema
export async function connectToDatabase() {
  const pool = getPool()

  // Check if tables exist
  const { rows } = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'users'
    ) as table_exists
  `)

  if (!rows[0].table_exists) {
    console.log('🔄 Initializing PostgreSQL schema...')
    const schemaPath = path.join(process.cwd(), 'schema.sql')
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8')
      await pool.query(schema)
      console.log('✅ PostgreSQL schema initialized')
    } else {
      console.error('schema.sql not found. Run schema.sql manually.')
    }
  } else {
    console.log('✅ PostgreSQL tables exist')
    // Add missing columns if they don't exist (migration)
    try {
      await pool.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS evidence JSONB DEFAULT '[]'`)
      await pool.query(`ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS status_history JSONB DEFAULT '[]'`)
      await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'info'`)
      await pool.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]'`)
      await pool.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS status_history JSONB DEFAULT '[]'`)
    } catch (e) {
      // Columns may already exist, ignore
    }
  }

  return pool
}

// Close pool on shutdown
export async function closeDatabase() {
  if (cachedPool) {
    await cachedPool.end()
    cachedPool = null
  }
}

// Query helpers
export async function query(text, params) {
  const pool = getPool()
  return pool.query(text, params)
}

export async function queryOne(text, params) {
  const { rows } = await query(text, params)
  return rows[0] || null
}

export async function queryMany(text, params) {
  const { rows } = await query(text, params)
  return rows
}

// Aggregation helper (replaces MongoDB aggregate)
export async function aggregate(table, { match = {}, group = {}, sort = {}, select = null, limit = null }) {
  const pool = getPool()
  let sql = `SELECT`
  const params = []
  let paramIdx = 1

  if (select && typeof select === 'string') {
    sql += ` ${select}`
  } else if (group._id) {
    // GROUP BY aggregation
    const groupExprs = []
    for (const [key, op] of Object.entries(group)) {
      if (key === '_id') {
        groupExprs.push(`$${paramIdx++} AS _id`)
        params.push(group._id)
      } else if (op.$sum === 1) {
        groupExprs.push(`COUNT(*) AS "${key}"`)
      } else if (op.$sum) {
        groupExprs.push(`COALESCE(SUM($${paramIdx++}), 0) AS "${key}"`)
        params.push(op.$sum)
      } else if (op.$avg) {
        groupExprs.push(`AVG($${paramIdx++}) AS "${key}"`)
        params.push(op.$avg)
      } else if (op.$first) {
        groupExprs.push(`(ARRAY_AGG($${paramIdx++} ORDER BY NULL))[1] AS "${key}"`)
        params.push(op.$first)
      }
    }
    sql += ` ${groupExprs.join(', ')}`
  } else {
    sql += ` *`
  }

  sql += ` FROM ${table}`

  // WHERE clause
  const conditions = []
  for (const [key, value] of Object.entries(match)) {
    if (value && typeof value === 'object' && '$in' in value) {
      conditions.push(`"${key}" = ANY($${paramIdx++})`)
      params.push(value.$in)
    } else if (value && typeof value === 'object' && '$nin' in value) {
      conditions.push(`NOT ("${key}" = ANY($${paramIdx++}))`)
      params.push(value.$nin)
    } else if (value && typeof value === 'object' && '$ne' in value) {
      conditions.push(`"${key}" != $${paramIdx++}`)
      params.push(value.$ne)
    } else if (value && typeof value === 'object' && '$gt' in value) {
      conditions.push(`"${key}" > $${paramIdx++}`)
      params.push(value.$gt)
    } else if (value && typeof value === 'object' && '$gte' in value) {
      conditions.push(`"${key}" >= $${paramIdx++}`)
      params.push(value.$gte)
    } else if (value && typeof value === 'object' && '$lt' in value) {
      conditions.push(`"${key}" < $${paramIdx++}`)
      params.push(value.$lt)
    } else if (value && typeof value === 'object' && '$lte' in value) {
      conditions.push(`"${key}" <= $${paramIdx++}`)
      params.push(value.$lte)
    } else if (value && typeof value === 'object' && '$regex' in value) {
      conditions.push(`"${key}" ~ $${paramIdx++}`)
      params.push(value.$regex)
    } else if (value && typeof value === 'object' && '$exists' in value) {
      if (value.$exists) {
        conditions.push(`"${key}" IS NOT NULL`)
      } else {
        conditions.push(`"${key}" IS NULL`)
      }
    } else {
      conditions.push(`"${key}" = $${paramIdx++}`)
      params.push(value)
    }
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`
  }

  // GROUP BY
  if (group._id) {
    sql += ` GROUP BY _id`
  }

  // ORDER BY
  if (sort && typeof sort === 'object') {
    const orderClauses = []
    for (const [key, dir] of Object.entries(sort)) {
      orderClauses.push(`"${key}" ${dir === -1 ? 'DESC' : 'ASC'}`)
    }
    if (orderClauses.length > 0) {
      sql += ` ORDER BY ${orderClauses.join(', ')}`
    }
  }

  // LIMIT
  if (limit) {
    sql += ` LIMIT ${parseInt(limit, 10)}`
  }

  return pool.query(sql, params)
}
