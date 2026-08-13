import mongoose from 'mongoose'
import dotenv from 'dotenv'
import dns from 'node:dns'

// Load environment variables
dotenv.config()

// Use the VM/system resolver by default. DNS_SERVERS is an explicit escape
// hatch for environments whose resolver blocks MongoDB Atlas SRV lookups.
const configuredDnsServers = String(process.env.DNS_SERVERS || '').split(',').map(value => value.trim()).filter(Boolean)
if (configuredDnsServers.length) dns.setServers(configuredDnsServers)

const MONGODB_URI = process.env.MONGODB_URI || 
  process.env.MONGO_URI || 
  process.env.MONGODB_URL || 
  null

console.log('🔗 MongoDB URI:', MONGODB_URI ? MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@') : 'NOT SET')

if (!MONGODB_URI || MONGODB_URI.includes('undefined')) {
  console.error('lib/mongo.js: No valid MONGODB_URI found. Set MONGODB_URI in your .env file.')
}

// Use a global variable to cache the connection in serverless environments
let cached = global.mongoose

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null, indexesPromise: null }
}

async function ensureOperationalIndexes(connection) {
  if (!cached.indexesPromise) {
    const definitions = [
      ['notifications', { userEmail: 1, read: 1, createdAt: -1 }, { name: 'notifications_user_read_created' }],
      ['push_subscriptions', { 'subscription.endpoint': 1 }, { name: 'push_subscription_endpoint' }],
      ['servicerequests', { assignedManagerId: 1, createdAt: -1 }, { name: 'requests_manager_created' }],
      ['users', { role: 1, isActive: 1, name: 1 }, { name: 'users_role_active_name' }],
      ['vendors', { status: 1, legalName: 1 }, { name: 'vendors_status_name' }],
      ['servicerequests', { requesterId: 1, createdAt: -1 }, { name: 'requests_requester_created' }],
      ['servicerequests', { status: 1, createdAt: -1 }, { name: 'requests_status_created' }],
      ['vendorquotations', { assignedManagerId: 1, createdAt: -1 }, { name: 'quotations_manager_created' }],
      ['purchaseorders', { status: 1, createdAt: -1 }, { name: 'purchase_orders_status_created' }],
      ['purchaseorders', { vendorId: 1, createdAt: -1 }, { name: 'purchase_orders_vendor_created' }],
      ['purchaseorders', { requestId: 1, createdAt: -1 }, { name: 'purchase_orders_request_created' }],
      ['goodsreceipts', { grnType: 1, source: 1, poId: 1 }, { name: 'goods_receipts_qr_final_po' }],
      ['goodsreceipts', { source: 1, receivedAt: -1 }, { name: 'goods_receipts_source_received' }],
      ['gateentries', { decision: 1, entryTime: -1 }, { name: 'gate_entries_decision_time' }],
      ['deliveryschedules', { status: 1, scheduledDate: -1 }, { name: 'deliveries_status_scheduled' }]
    ]
    cached.indexesPromise = Promise.all(definitions.map(([name, keys, options]) =>
      ensureIndex(connection.connection.db.collection(name), keys, options)
    )).catch(error => {
      cached.indexesPromise = null
      throw error
    })
  }

  return cached.indexesPromise
}

function keySignature(keys) {
  return JSON.stringify(Object.entries(keys))
}

async function ensureIndex(collection, keys, options = {}) {
  const existingIndexes = await collection.indexes()
  const existing = existingIndexes.find(index => keySignature(index.key) === keySignature(keys))
  if (existing) {
    for (const option of ['unique', 'sparse', 'expireAfterSeconds']) {
      if (options[option] !== undefined && existing[option] !== options[option]) {
        throw new Error(`Index option mismatch on ${collection.collectionName}.${existing.name}: ${option}`)
      }
    }
    return existing.name
  }
  return collection.createIndex(keys, options)
}

async function ensureApplicationCollections(connection) {
  // Create every model collection at startup so a fresh deployment fails
  // early if its database user lacks collection or index permissions.
  await Promise.all(Object.values(mongoose.models).map(async model => {
    await model.createCollection()
    for (const [keys, options] of model.schema.indexes()) {
      await ensureIndex(model.collection, keys, options)
    }
  }))

  const existing = await connection.connection.db.listCollections({ name: 'push_subscriptions' }).hasNext()
  if (!existing) await connection.connection.db.createCollection('push_subscriptions')
}

export async function connectToDatabase() {
  if (cached.conn) {
    await ensureApplicationCollections(cached.conn)
    await ensureOperationalIndexes(cached.conn)
    return cached.conn
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      maxPoolSize: 20,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 10000,
      family: 4, // Force IPv4
      retryWrites: true,
      retryReads: true,
      autoIndex: false
    }

    console.log('🔄 Attempting to connect to MongoDB...')
    cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
      console.log('✅ Successfully connected to MongoDB')
      return mongoose
    })
  }

  try {
    cached.conn = await cached.promise
    // Index maintenance is useful, but login and other API requests must not
    // wait for it when one Atlas replica is temporarily unreachable.
    await ensureApplicationCollections(cached.conn)
    await ensureOperationalIndexes(cached.conn)
  } catch (e) {
    cached.promise = null
    throw e
  }

  return cached.conn
}
