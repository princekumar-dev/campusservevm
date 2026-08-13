/**
 * One-way, non-destructive MongoDB -> PostgreSQL migration.
 *
 * Source documents are stored as Extended JSON so ObjectIds, dates, binary
 * values and nested arrays/objects survive the move exactly.  MongoDB is
 * only read from; this script contains no MongoDB mutation calls.
 *
 * Required environment variables:
 *   MONGODB_URI   existing MongoDB connection URI
 *   POSTGRES_URL  destination PostgreSQL connection URI
 *
 * Optional:
 *   PGSSLMODE=require   enable TLS (also enabled automatically for Render)
 *   MIGRATION_BATCH_SIZE=500
 */
import 'dotenv/config'
import dns from 'node:dns'
import process from 'node:process'
import { MongoClient } from 'mongodb'
import { EJSON } from 'bson'
import pg from 'pg'

const { Pool } = pg
const sourceUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL
const postgresUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL
const batchSize = Math.max(1, Number(process.env.MIGRATION_BATCH_SIZE || 500))
const schema = 'campusserve_mongo_backup'

if (!sourceUri) throw new Error('MONGODB_URI (or MONGO_URI/MONGODB_URL) is required')
if (!postgresUrl) throw new Error('POSTGRES_URL (or DATABASE_URL) is required')

const dnsServers = String(process.env.DNS_SERVERS || '').split(',').map(value => value.trim()).filter(Boolean)
if (dnsServers.length) dns.setServers(dnsServers)

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function tableName(collectionName) {
  // A deterministic, safe name that remains readable and avoids collisions
  // with PostgreSQL system objects. Mongo collection names are retained in
  // the manifest as the authoritative source name.
  return `mongo_${collectionName.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}`
}

async function ensureDestination(pool) {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(schema)}.migration_manifest (
      collection_name text PRIMARY KEY,
      target_table text NOT NULL,
      source_count bigint NOT NULL,
      migrated_count bigint NOT NULL,
      verified_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

async function ensureCollectionTable(pool, collectionName) {
  const target = tableName(collectionName)
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(target)}`
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${qualified} (
      mongo_id text PRIMARY KEY,
      document jsonb NOT NULL,
      migrated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${target}_document_gin`)} ON ${qualified} USING gin (document)`)
  return target
}

async function migrateCollection(mongoDb, pool, name) {
  const collection = mongoDb.collection(name)
  const sourceCount = await collection.countDocuments({})
  const target = await ensureCollectionTable(pool, name)
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(target)}`
  const cursor = collection.find({}, { batchSize })
  let batch = []
  let copied = 0

  async function flush() {
    if (!batch.length) return
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const values = []
      const placeholders = batch.map((entry, index) => {
        const position = index * 2
        values.push(entry.id, entry.document)
        return `($${position + 1}, $${position + 2}::jsonb, now())`
      })
      await client.query(
        `INSERT INTO ${qualified} (mongo_id, document, migrated_at) VALUES ${placeholders.join(', ')}
         ON CONFLICT (mongo_id) DO UPDATE SET document = EXCLUDED.document, migrated_at = EXCLUDED.migrated_at`,
        values
      )
      await client.query('COMMIT')
      copied += batch.length
      batch = []
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  for await (const document of cursor) {
    batch.push({
      id: String(document._id),
      // Canonical Extended JSON is lossless for BSON-specific values.
      document: EJSON.stringify(document, { relaxed: false })
    })
    if (batch.length >= batchSize) await flush()
  }
  await flush()

  const { rows: [{ count: targetCount }] } = await pool.query(`SELECT count(*)::bigint AS count FROM ${qualified}`)
  if (Number(targetCount) < sourceCount) {
    throw new Error(`${name}: verification failed (Mongo=${sourceCount}, PostgreSQL=${targetCount})`)
  }
  await pool.query(
    `INSERT INTO ${quoteIdentifier(schema)}.migration_manifest
      (collection_name, target_table, source_count, migrated_count, verified_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (collection_name) DO UPDATE SET
      target_table = EXCLUDED.target_table, source_count = EXCLUDED.source_count,
      migrated_count = EXCLUDED.migrated_count, verified_at = EXCLUDED.verified_at`,
    [name, target, sourceCount, copied]
  )
  console.log(`${name}: Mongo=${sourceCount}, copied=${copied}, PostgreSQL=${targetCount} ✓`)
}

const mongo = new MongoClient(sourceUri, {
  // A primary read prevents taking a stale secondary snapshot during cutover.
  readPreference: 'primary',
  serverSelectionTimeoutMS: 30_000,
  connectTimeoutMS: 30_000
})
const pool = new Pool({
  connectionString: postgresUrl,
  ssl: process.env.PGSSLMODE === 'require' || /render\.com|supabase\.co|neon\.tech/i.test(postgresUrl)
    ? { rejectUnauthorized: false }
    : undefined
})

try {
  await mongo.connect()
  await ensureDestination(pool)
  const db = mongo.db()
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map(collection => collection.name)
    .sort()
  if (!collections.length) throw new Error('The MongoDB database has no collections to migrate')
  console.log(`Migrating ${collections.length} MongoDB collections into PostgreSQL schema ${schema}...`)
  for (const name of collections) await migrateCollection(db, pool, name)
  console.log('Migration completed. MongoDB was never modified.')
} finally {
  await mongo.close()
  await pool.end()
}
