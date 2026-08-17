import { query, queryOne, queryMany, transaction } from '../lib/pg.js'

// ─── Utility: Convert MongoDB-style filter to SQL WHERE clause ────────────────
function buildWhere(filters = {}, paramOffset = 1) {
  const conditions = []
  const params = []
  let idx = paramOffset

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue

    let col
    let jsonKey = null
    if (key.includes('.')) {
      const parts = key.split('.')
      col = toSnake(parts[0])
      jsonKey = toSnake(parts.slice(1).join('.'))
    } else {
      col = key.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
    }
    const colExpr = jsonKey ? `"${col}"->>'${jsonKey}'` : `"${col}"`

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      if ('$in' in value) {
        conditions.push(`${colExpr}::text = ANY($${idx}::text[])`)
        params.push(Array.isArray(value.$in) ? value.$in : [value.$in])
        idx++
      } else if ('$nin' in value) {
        conditions.push(`NOT (${colExpr}::text = ANY($${idx}::text[]))`)
        params.push(Array.isArray(value.$nin) ? value.$nin : [value.$nin])
        idx++
      } else if ('$ne' in value) {
        conditions.push(`${colExpr} != $${idx}`)
        params.push(value.$ne)
        idx++
      } else if ('$gt' in value) {
        conditions.push(`${colExpr} > $${idx}`)
        params.push(value.$gt)
        idx++
      } else if ('$gte' in value) {
        conditions.push(`${colExpr} >= $${idx}`)
        params.push(value.$gte)
        idx++
      } else if ('$lt' in value) {
        conditions.push(`${colExpr} < $${idx}`)
        params.push(value.$lt)
        idx++
      } else if ('$lte' in value) {
        conditions.push(`${colExpr} <= $${idx}`)
        params.push(value.$lte)
        idx++
      } else if ('$exists' in value) {
        if (value.$exists) {
          conditions.push(`${colExpr} IS NOT NULL`)
        } else {
          conditions.push(`${colExpr} IS NULL`)
        }
      } else if ('$or' in value) {
        const orParts = value.$or.map(subFilter => {
          const { conditions: subConds, params: subParams } = buildWhere(subFilter, idx)
          idx += subParams.length
          params.push(...subParams)
          return `(${subConds.join(' AND ')})`
        })
        conditions.push(`(${orParts.join(' OR ')})`)
      }
    } else if (key === '$or' && Array.isArray(value)) {
      const orParts = value.map(subFilter => {
        const { conditions: subConds, params: subParams } = buildWhere(subFilter, idx)
        idx += subParams.length
        params.push(...subParams)
        return `(${subConds.join(' AND ')})`
      })
      conditions.push(`(${orParts.join(' OR ')})`)
    } else {
      conditions.push(`${colExpr} = $${idx}`)
      params.push(value)
      idx++
    }
  }

  return { conditions, params }
}

// Convert camelCase column name to snake_case for PostgreSQL
function toSnake(str) {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
}

// Convert snake_case column name to camelCase for JS
function toCamel(str) {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

// Convert a row from snake_case keys to camelCase keys
function camelRow(row) {
  if (!row) return row
  const result = {}
  for (const [key, value] of Object.entries(row)) {
    result[toCamel(key)] = value
  }
  if (result.id && !result._id) result._id = result.id
  return result
}

// Convert a row from camelCase keys to snake_case keys for SQL
function snakeObj(obj) {
  if (!obj || typeof obj !== 'object') return obj
  const result = {}
  for (const [key, value] of Object.entries(obj)) {
    result[toSnake(key)] = value
  }
  return result
}

// ─── Model Factory ────────────────────────────────────────────────────────────
function createModel(tableName, options = {}) {
  const { idColumn = 'id', camelCase = true } = options

  return {
    tableName,

    // Find one record by filter
    async findOne(filters = {}, selectFields = null) {
      const { conditions, params } = buildWhere(filters)
      const select = selectFields
        ? selectFields.map(f => `"${toSnake(f)}"`).join(', ')
        : '*'
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const sql = `SELECT ${select} FROM ${tableName} ${where} LIMIT 1`
      const result = await queryOne(sql, params)
      return camelCase ? camelRow(result) : result
    },

    // Find by ID
    async findById(id, selectFields = null) {
      if (!id || id === 'undefined' || id === 'null') return null
      const select = selectFields
        ? selectFields.map(f => `"${toSnake(f)}"`).join(', ')
        : '*'
      const sql = `SELECT ${select} FROM ${tableName} WHERE ${idColumn} = $1 LIMIT 1`
      const result = await queryOne(sql, [id])
      return camelCase ? camelRow(result) : result
    },

    // Find many records
    async find(filters = {}, options = {}) {
      const { conditions, params } = buildWhere(filters)
      const selectFields = Array.isArray(options.select)
        ? options.select
        : options.select ? String(options.select).split(/\s+/) : null
      const select = selectFields
        ? (() => {
            const seen = new Set()
            const fields = selectFields.map(f => {
              if (f.includes('.')) {
                const col = toSnake(f.split('.')[0])
                if (seen.has(col)) return null
                seen.add(col)
                return `"${col}"`
              }
              return `"${toSnake(f)}"`
            }).filter(Boolean)
            return fields.join(', ')
          })()
        : '*'
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      let orderBy = ''
      if (options.sort) {
        const sorts = Object.entries(options.sort).map(([k, v]) => `"${toSnake(k)}" ${v === -1 ? 'DESC' : 'ASC'}`)
        orderBy = `ORDER BY ${sorts.join(', ')}`
      } else {
        orderBy = `ORDER BY created_at DESC`
      }
      const limit = options.limit ? `LIMIT ${parseInt(options.limit)}` : ''
      const offset = options.skip ? `OFFSET ${parseInt(options.skip)}` : ''
      const sql = `SELECT ${select} FROM ${tableName} ${where} ${orderBy} ${limit} ${offset}`
      const results = await queryMany(sql, params)
      return camelCase ? results.map(camelRow) : results
    },

    // Create a new record
    async create(data) {
      const fields = Object.keys(data).map(toSnake)
      const placeholders = fields.map((_, i) => `$${i + 1}`)
      const valuesArr = Object.values(data).map(v => (typeof v === 'object' && v !== null) ? JSON.stringify(v) : v)

      const sql = `INSERT INTO ${tableName} (${fields.map(f => `"${f}"`).join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`
      const result = await queryOne(sql, valuesArr)
      return camelCase ? camelRow(result) : result
    },

    // Insert many records
    async insertMany(docs) {
      if (!docs.length) return []
      const fields = Object.keys(docs[0]).map(toSnake)
      const results = []

      for (const doc of docs) {
        const values = Object.values(doc)
        const placeholders = fields.map((_, i) => `$${i + 1}`)
        const sql = `INSERT INTO ${tableName} (${fields.map(f => `"${f}"`).join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`
        const result = await queryOne(sql, values)
        results.push(camelCase ? camelRow(result) : result)
      }
      return results
    },

    // Update by filter
    async updateOne(filters, updateData, options = {}) {
      const { conditions, params } = buildWhere(filters)
      const setClauses = []
      let idx = params.length + 1
      const serialize = v => (typeof v === 'object' && v !== null) ? JSON.stringify(v) : v
      for (const [key, value] of Object.entries(updateData)) {
        if (key.startsWith('$')) {
          // Handle $set, $unset, $push etc
          if (key === '$set') {
            for (const [k, v] of Object.entries(value)) {
              setClauses.push(`"${toSnake(k)}" = $${idx++}`)
              params.push(serialize(v))
            }
          } else if (key === '$unset') {
            for (const k of Object.keys(value)) {
              setClauses.push(`"${toSnake(k)}" = NULL`)
            }
          } else if (key === '$push') {
            for (const [k, v] of Object.entries(value)) {
              setClauses.push(`"${toSnake(k)}" = COALESCE("${toSnake(k)}", '[]'::jsonb) || $${idx}::jsonb`)
              params.push(serialize([v]))
            }
          }
        } else {
          setClauses.push(`"${toSnake(key)}" = $${idx++}`)
          params.push(serialize(value))
        }
      }

      if (setClauses.length === 0) return null

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const returning = options.new !== false ? 'RETURNING *' : ''
      const sql = `UPDATE ${tableName} SET ${setClauses.join(', ')} ${where} ${returning}`
      const result = await queryOne(sql, params)
      return camelCase ? camelRow(result) : result
    },

    // Update by ID
    async findByIdAndUpdate(id, updateData, options = {}) {
      return this.findOneAndUpdate({ [idColumn]: id }, updateData, options)
    },

    // Find and update
    async findOneAndUpdate(filters, updateData, options = {}) {
      const { conditions, params } = buildWhere(filters)
      const setClauses = []
      let idx = params.length + 1

      for (const [key, value] of Object.entries(updateData)) {
        if (key === '$set') {
          for (const [k, v] of Object.entries(value)) {
            setClauses.push(`"${toSnake(k)}" = $${idx++}`)
            params.push(v)
          }
        } else if (key === '$unset') {
          for (const k of Object.keys(value)) {
            setClauses.push(`"${toSnake(k)}" = NULL`)
          }
        } else if (key === '$push') {
          // JSONB append
          for (const [k, v] of Object.entries(value)) {
            const col = toSnake(k)
            if (typeof v === 'object' && '$each' in v) {
              setClauses.push(`"${col}" = "${col}" || $${idx}::jsonb`)
              params.push(JSON.stringify(v.$each))
            } else {
              setClauses.push(`"${col}" = "${col}" || $${idx}::jsonb`)
              params.push(JSON.stringify([v]))
            }
            idx++
          }
        } else if (key === '$addToSet') {
          // JSONB unique add
          for (const [k, v] of Object.entries(value)) {
            const col = toSnake(k)
            setClauses.push(`"${col}" = CASE WHEN "${col}" @> $${idx}::jsonb THEN "${col}" ELSE "${col}" || $${idx}::jsonb END`)
            params.push(JSON.stringify(Array.isArray(v) ? v : [v]))
            idx++
          }
        } else {
          setClauses.push(`"${toSnake(key)}" = $${idx++}`)
          params.push(value)
        }
      }

      if (setClauses.length === 0) return null

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const returning = options.new !== false ? 'RETURNING *' : ''
      const sql = `UPDATE ${tableName} SET ${setClauses.join(', ')} ${where} ${returning}`
      const result = await queryOne(sql, params)
      return camelCase ? camelRow(result) : result
    },

    // Update many records
    async updateMany(filters, updateData) {
      const { conditions, params } = buildWhere(filters)
      const setClauses = []
      let idx = params.length + 1

      for (const [key, value] of Object.entries(updateData)) {
        if (key === '$set') {
          for (const [k, v] of Object.entries(value)) {
            setClauses.push(`"${toSnake(k)}" = $${idx++}`)
            params.push(v)
          }
        } else if (key === '$unset') {
          for (const k of Object.keys(value)) {
            setClauses.push(`"${toSnake(k)}" = NULL`)
          }
        } else {
          setClauses.push(`"${toSnake(key)}" = $${idx++}`)
          params.push(value)
        }
      }

      if (setClauses.length === 0) return { modifiedCount: 0 }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const sql = `UPDATE ${tableName} SET ${setClauses.join(', ')} ${where}`
      const result = await query(sql, params)
      return { modifiedCount: result.rowCount }
    },

    // Delete by filter
    async deleteOne(filters) {
      const { conditions, params } = buildWhere(filters)
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const sql = `DELETE FROM ${tableName} ${where} RETURNING *`
      const result = await queryOne(sql, params)
      return result ? { deletedCount: 1, deleted: result } : { deletedCount: 0 }
    },

    // Delete by ID
    async findByIdAndDelete(id) {
      const sql = `DELETE FROM ${tableName} WHERE ${idColumn} = $1 RETURNING *`
      const result = await queryOne(sql, [id])
      return result ? camelRow(result) : null
    },

    // Delete many
    async deleteMany(filters = {}) {
      const { conditions, params } = buildWhere(filters)
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const sql = `DELETE FROM ${tableName} ${where}`
      const result = await query(sql, params)
      return { deletedCount: result.rowCount }
    },

    // Count documents
    async countDocuments(filters = {}) {
      const { conditions, params } = buildWhere(filters)
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const sql = `SELECT COUNT(*) as count FROM ${tableName} ${where}`
      const result = await queryOne(sql, params)
      return parseInt(result?.count || 0)
    },

    // Distinct
    async distinct(field, filters = {}) {
      const { conditions, params } = buildWhere(filters)
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const col = toSnake(field)
      const sql = `SELECT DISTINCT "${col}" FROM ${tableName} ${where}`
      const results = await queryMany(sql, params)
      return results.map(r => r[col])
    },

    // Exists
    async exists(filters) {
      const { conditions, params } = buildWhere(filters)
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const sql = `SELECT EXISTS(SELECT 1 FROM ${tableName} ${where}) as exists`
      const result = await queryOne(sql, params)
      return result?.exists || false
    },

    // Aggregate (simplified)
    async aggregate(pipeline) {
      // Simplified aggregation for common patterns
      let sql = ''
      let params = []
      let idx = 1

      // For complex aggregations, build raw SQL
      // This is a simplified version; complex ones need custom queries
      return []
    }
  }
}

// ─── Models ───────────────────────────────────────────────────────────────────

export const User = createModel('users')
export const ServiceRequest = createModel('service_requests')
export const Notification = createModel('notifications')
export const Vendor = createModel('vendors')
export const VendorQuotation = createModel('vendor_quotations')
export const PurchaseOrder = createModel('purchase_orders')
export const DeliveryPerson = createModel('delivery_persons')
export const Vehicle = createModel('vehicles')
export const DeliverySchedule = createModel('delivery_schedules')
export const GateEntry = createModel('gate_entries')
export const GoodsReceipt = createModel('goods_receipts')
export const AuditLog = createModel('audit_logs')
export const EmailVerification = createModel('email_verifications')
export const SystemSettings = createModel('system_settings')
export const ServiceRequestPayment = createModel('service_request_payments')
export const PushSubscription = createModel('push_subscriptions')

// ─── Specialized Query Helpers ────────────────────────────────────────────────

// PurchaseOrder aggregate stats (replaces MongoDB aggregation)
export async function getVendorOrderStats(vendorIds, excludedStatuses) {
  const sql = `
    SELECT 
      vendor_id as "_id",
      COUNT(*) as "totalOrders",
      COALESCE(SUM(COALESCE(grand_total, 0)), 0) as "totalValue"
    FROM purchase_orders
    WHERE vendor_id = ANY($1::uuid[])
      AND NOT (status = ANY($2::text[]))
    GROUP BY vendor_id
  `
  const results = await queryMany(sql, [vendorIds, excludedStatuses])
  return results.map(r => ({
    _id: r._id,
    totalOrders: parseInt(r.totalOrders),
    totalValue: parseFloat(r.totalValue)
  }))
}

// Push subscription operations
export const PushSubscriptionOps = {
  async find(filter = {}) {
    let sql = 'SELECT * FROM push_subscriptions'
    const conditions = []
    const params = []
    let idx = 1

    if (filter.userEmail) {
      conditions.push(`user_email = $${idx++}`)
      params.push(filter.userEmail)
    }
    if (filter['subscription.endpoint']) {
      conditions.push(`subscription ->> 'endpoint' = $${idx++}`)
      params.push(filter['subscription.endpoint'])
    }
    if (filter.active !== undefined) {
      conditions.push(`active = $${idx++}`)
      params.push(filter.active)
    }
    if (filter.status) {
      conditions.push(`status = $${idx++}`)
      params.push(filter.status)
    }
    if (filter.$or) {
      const orParts = []
      for (const sub of filter.$or) {
        if (sub.active === true || sub.status === 'active') {
          orParts.push(`(active = true OR status = 'active')`)
        }
      }
      if (orParts.length) conditions.push(`(${orParts.join(' OR ')})`)
    }

    if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`
    sql += ' ORDER BY updated_at DESC'

    return queryMany(sql, params)
  },

  async insertOne(data) {
    const sql = `
      INSERT INTO push_subscriptions (user_email, subscription, active, status, status_updated_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW())
      RETURNING *
    `
    const result = await queryOne(sql, [
      data.userEmail,
      JSON.stringify(data.subscription),
      data.active ?? true,
      data.status ?? 'active'
    ])
    return { insertedId: result?.id, result }
  },

  async updateOne(filter, update) {
    const conditions = []
    const params = []
    let idx = 1

    if (filter.userEmail) {
      conditions.push(`user_email = $${idx++}`)
      params.push(filter.userEmail)
    }
    if (filter['subscription.endpoint']) {
      conditions.push(`subscription ->> 'endpoint' = $${idx++}`)
      params.push(filter['subscription.endpoint'])
    }
    if (filter._id) {
      conditions.push(`id = $${idx++}`)
      params.push(filter._id)
    }

    const setClauses = []
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) {
        const col = toSnake(k)
        setClauses.push(`"${col}" = $${idx++}`)
        params.push(v)
      }
    }

    if (setClauses.length === 0 || conditions.length === 0) {
      return { matchedCount: 0, modifiedCount: 0 }
    }

    const sql = `UPDATE push_subscriptions SET ${setClauses.join(', ')}, updated_at = NOW() WHERE ${conditions.join(' AND ')}`
    const result = await query(sql, params)
    return { matchedCount: result.rowCount, modifiedCount: result.rowCount }
  },

  async updateMany(filter, update) {
    return this.updateOne(filter, update)
  },

  async deleteOne(filter) {
    const conditions = []
    const params = []
    let idx = 1

    if (filter.userEmail) {
      conditions.push(`user_email = $${idx++}`)
      params.push(filter.userEmail)
    }
    if (filter['subscription.endpoint']) {
      conditions.push(`subscription ->> 'endpoint' = $${idx++}`)
      params.push(filter['subscription.endpoint'])
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const sql = `DELETE FROM push_subscriptions ${where}`
    const result = await query(sql, params)
    return { deletedCount: result.rowCount }
  },

  async countDocuments(filter = {}) {
    let sql = 'SELECT COUNT(*) as count FROM push_subscriptions'
    const conditions = []
    const params = []
    let idx = 1

    if (filter.userEmail) {
      conditions.push(`user_email = $${idx++}`)
      params.push(filter.userEmail)
    }
    if (filter.read !== undefined) {
      conditions.push(`active = $${idx++}`)
      params.push(filter.active)
    }

    if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`
    const result = await queryOne(sql, params)
    return parseInt(result?.count || 0)
  }
}

// Notification raw operations (for notificationService)
export const NotificationRaw = {
  async insertOne(data) {
    const sql = `
      INSERT INTO notifications (user_id, user_email, title, message, url, read, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *
    `
    const result = await queryOne(sql, [
      data.userId || null,
      data.userEmail,
      data.title,
      data.message,
      data.url || '/',
      data.read || false
    ])
    return { insertedId: result?.id }
  },

  async find(filter = {}) {
    let sql = 'SELECT * FROM notifications'
    const conditions = []
    const params = []
    let idx = 1

    if (filter.userEmail) {
      conditions.push(`user_email = $${idx++}`)
      params.push(filter.userEmail)
    }
    if (filter._id) {
      conditions.push(`id = $${idx++}`)
      params.push(filter._id)
    }
    if (filter.read !== undefined) {
      if (filter.read && filter.read.$ne) {
        conditions.push(`read != $${idx++}`)
        params.push(filter.read.$ne)
      } else {
        conditions.push(`read = $${idx++}`)
        params.push(filter.read)
      }
    }

    if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`
    sql += ' ORDER BY created_at DESC'

    return queryMany(sql, params)
  },

  async updateOne(filter, update) {
    const conditions = []
    const params = []
    let idx = 1

    if (filter._id) {
      conditions.push(`id = $${idx++}`)
      params.push(filter._id)
    }
    if (filter.userEmail) {
      conditions.push(`user_email = $${idx++}`)
      params.push(filter.userEmail)
    }

    const setClauses = []
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) {
        setClauses.push(`"${toSnake(k)}" = $${idx++}`)
        params.push(v)
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const sql = `UPDATE notifications SET ${setClauses.join(', ')} ${where}`
    const result = await query(sql, params)
    return { matchedCount: result.rowCount, modifiedCount: result.rowCount }
  },

  async updateMany(filter, update) {
    const conditions = []
    const params = []
    let idx = 1

    if (filter.userEmail) {
      conditions.push(`user_email = $${idx++}`)
      params.push(filter.userEmail)
    }
    if (filter.read !== undefined && filter.read.$ne) {
      conditions.push(`read != $${idx++}`)
      params.push(filter.read.$ne)
    }
    if (filter.type) {
      conditions.push(`type = $${idx++}`)
      params.push(filter.type)
    }

    const setClauses = []
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) {
        setClauses.push(`"${toSnake(k)}" = $${idx++}`)
        params.push(v)
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const sql = `UPDATE notifications SET ${setClauses.join(', ')} ${where}`
    const result = await query(sql, params)
    return { modifiedCount: result.rowCount }
  },

  async countDocuments(filter = {}) {
    let sql = 'SELECT COUNT(*) as count FROM notifications'
    const conditions = []
    const params = []
    let idx = 1

    if (filter.userEmail) {
      conditions.push(`user_email = $${idx++}`)
      params.push(filter.userEmail)
    }
    if (filter.read !== undefined && filter.read.$ne) {
      conditions.push(`read != $${idx++}`)
      params.push(filter.read.$ne)
    } else if (filter.read !== undefined) {
      conditions.push(`read = $${idx++}`)
      params.push(filter.read)
    }

    if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`
    const result = await queryOne(sql, params)
    return parseInt(result?.count || 0)
  }
}

// User raw operations (for notifications API)
export const UserRaw = {
  async deleteOne(filter) {
    const conditions = []
    const params = []
    let idx = 1

    if (filter._id) {
      conditions.push(`id = $${idx++}`)
      params.push(filter._id)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const sql = `DELETE FROM users ${where}`
    const result = await query(sql, params)
    return { deletedCount: result.rowCount }
  }
}
