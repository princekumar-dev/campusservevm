import { connectToDatabase } from '../lib/pg.js'
import { queryMany, queryOne } from '../lib/pg.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    await connectToDatabase()
  } catch (dbErr) {
    console.error('DB connect error in stock API:', dbErr.message)
    return res.status(503).json({ success: false, error: 'Database connection failed' })
  }

  try {
    if (req.method === 'GET') {
      const institution = req.query.institution || ''
      const search = req.query.search || ''
      const category = req.query.category || ''

      let whereClause = `WHERE po.status NOT IN ('DRAFT','CANCELLED','REJECTED')`
      const params = []
      let idx = 1

      if (institution) {
        whereClause += ` AND sr.institution = $${idx}`
        params.push(institution)
        idx++
      }

      if (search) {
        whereClause += ` AND poi.description ILIKE $${idx}`
        params.push(`%${search}%`)
        idx++
      }

      if (category) {
        whereClause += ` AND sr.category = $${idx}`
        params.push(category)
        idx++
      }

      // Aggregate stock items from purchase_order_items joined to POs and service_requests
      const stockQuery = `
        SELECT
          poi.description AS item_name,
          sr.institution,
          sr.category,
          sr.location,
          poi.brand,
          poi.model,
          poi.unit,
          SUM(poi.quantity_ordered) AS total_ordered,
          SUM(poi.quantity_accepted) AS total_received,
          SUM(poi.quantity_ordered - poi.quantity_accepted) AS total_pending,
          AVG(poi.unit_price) AS avg_unit_price,
          SUM(poi.line_total) AS total_value
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.po_id
        LEFT JOIN service_requests sr ON sr.id = po.request_id
        ${whereClause}
        GROUP BY poi.description, sr.institution, sr.category, sr.location, poi.brand, poi.model, poi.unit
        ORDER BY total_value DESC
      `
      const stockRows = await queryMany(stockQuery, params)

      // Institution summary
      const instSummaryQuery = `
        SELECT
          sr.institution,
          COUNT(DISTINCT poi.description) AS unique_items,
          SUM(poi.quantity_ordered) AS total_ordered,
          SUM(poi.quantity_accepted) AS total_received,
          SUM(poi.line_total) AS total_value
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.po_id
        LEFT JOIN service_requests sr ON sr.id = po.request_id
        WHERE po.status NOT IN ('DRAFT','CANCELLED','REJECTED')
        GROUP BY sr.institution
        ORDER BY total_value DESC
      `
      const instSummary = await queryMany(instSummaryQuery)

      // Category summary
      const catSummaryQuery = `
        SELECT
          sr.category,
          COUNT(DISTINCT poi.description) AS unique_items,
          SUM(poi.quantity_ordered) AS total_ordered,
          SUM(poi.quantity_accepted) AS total_received,
          SUM(poi.line_total) AS total_value
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.po_id
        LEFT JOIN service_requests sr ON sr.id = po.request_id
        WHERE po.status NOT IN ('DRAFT','CANCELLED','REJECTED')
        GROUP BY sr.category
        ORDER BY total_value DESC
      `
      const catSummary = await queryMany(catSummaryQuery)

      // Overall totals
      const totalsQuery = `
        SELECT
          COUNT(DISTINCT poi.description) AS total_unique_items,
          COALESCE(SUM(poi.quantity_ordered), 0) AS total_ordered,
          COALESCE(SUM(poi.quantity_accepted), 0) AS total_received,
          COALESCE(SUM(poi.quantity_ordered - poi.quantity_accepted), 0) AS total_pending,
          COALESCE(SUM(poi.line_total), 0) AS total_value
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.po_id
        WHERE po.status NOT IN ('DRAFT','CANCELLED','REJECTED')
      `
      const totals = await queryOne(totalsQuery)

      // Format all numeric fields
      const stockItems = stockRows.map(row => ({
        itemName: row.item_name,
        institution: row.institution || 'unassigned',
        category: row.category || 'Uncategorized',
        location: row.location || 'Not specified',
        brand: row.brand || '',
        model: row.model || '',
        unit: row.unit || 'pcs',
        totalOrdered: Number(row.total_ordered) || 0,
        totalReceived: Number(row.total_received) || 0,
        totalPending: Number(row.total_pending) || 0,
        avgUnitPrice: Number(row.avg_unit_price) || 0,
        totalValue: Number(row.total_value) || 0
      }))

      return res.status(200).json({
        success: true,
        stockItems,
        institutionSummary: instSummary.map(r => ({
          institution: r.institution || 'unassigned',
          uniqueItems: Number(r.unique_items) || 0,
          totalOrdered: Number(r.total_ordered) || 0,
          totalReceived: Number(r.total_received) || 0,
          totalValue: Number(r.total_value) || 0
        })),
        categorySummary: catSummary.map(r => ({
          category: r.category || 'Uncategorized',
          uniqueItems: Number(r.unique_items) || 0,
          totalOrdered: Number(r.total_ordered) || 0,
          totalReceived: Number(r.total_received) || 0,
          totalValue: Number(r.total_value) || 0
        })),
        totals: {
          totalUniqueItems: Number(totals?.total_unique_items) || 0,
          totalOrdered: Number(totals?.total_ordered) || 0,
          totalReceived: Number(totals?.total_received) || 0,
          totalPending: Number(totals?.total_pending) || 0,
          totalValue: Number(totals?.total_value) || 0
        }
      })
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' })
  } catch (error) {
    console.error('Error in stock API:', error)
    return res.status(500).json({ success: false, error: 'Internal server error' })
  }
}
