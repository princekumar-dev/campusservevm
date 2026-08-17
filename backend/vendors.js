import { connectToDatabase } from '../lib/pg.js'
import { Vendor, DeliveryPerson, Vehicle, User, PurchaseOrder } from '../db/index.js'

const excludedOrderStatuses = ['CANCELLED', 'REJECTED', 'VENDOR_REJECTED']
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/

async function attachPurchaseOrderStats(vendors) {
  if (!vendors.length) return vendors
  const vendorIds = vendors.map(vendor => vendor.id)
  const orders = await PurchaseOrder.find({
    vendorId: { $in: vendorIds },
    status: { $nin: excludedOrderStatuses }
  }, { select: 'vendorId grandTotal' })
  const totalsByVendor = new Map()
  for (const order of orders) {
    const key = String(order.vendorId)
    const existing = totalsByVendor.get(key) || { totalOrders: 0, totalValue: 0 }
    existing.totalOrders += 1
    existing.totalValue += Number(order.grandTotal || 0)
    totalsByVendor.set(key, existing)
  }
  return vendors.map(vendor => {
    const total = totalsByVendor.get(String(vendor.id))
    return {
      ...vendor,
      totalOrders: total?.totalOrders || 0,
      totalValue: total?.totalValue || 0
    }
  })
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try { await connectToDatabase() } catch (e) {
    return res.status(503).json({ success: false, error: 'Database connection failed' })
  }

  const actorId = req.user ? req.user.id : (req.headers['x-user-id'] || 'system')
  const userRole = req.user ? req.user.role : (req.headers['x-user-role'] || '')
  const actor = req.user || await User.findById(actorId)
  const actorName = actor ? actor.name : 'Unknown'

  try {
    const { id, action, subResource } = req.query

    // ── GET /api/vendors ──────────────────────────────────────────────────────
    if (req.method === 'GET') {
      if (id) {
        // Single vendor with their delivery persons and vehicles
        const vendor = await Vendor.findById(id)
        if (!vendor) return res.status(404).json({ success: false, error: 'Vendor not found' })
        const [vendorWithStats] = await attachPurchaseOrderStats([vendor])
        const deliveryPersons = await DeliveryPerson.find({ vendorId: id })
        const vehicles = await Vehicle.find({ vendorId: id })
        return res.json({ success: true, data: vendorWithStats, deliveryPersons, vehicles })
      }

      // List vendors
      const filter = {}
      if (req.query.status) filter.status = req.query.status
      const vendors = await Vendor.find(filter, { sort: { legalName: 1 } })
      // Active-vendor requests populate selectors and do not display aggregate
      // order statistics. Avoid a second database round trip on that hot path.
      if (req.query.status === 'ACTIVE') {
        return res.json({ success: true, data: vendors, total: vendors.length })
      }
      const vendorsWithStats = await attachPurchaseOrderStats(vendors)
      return res.json({ success: true, data: vendorsWithStats, total: vendorsWithStats.length })
    }

    // ── POST /api/vendors — Create vendor ────────────────────────────────────
    if (req.method === 'POST' && !id && !subResource) {
      const { legalName, contactPerson, email, phone, taxNumber, address } = req.body
      const panNumber = String(req.body.panNumber || '').trim().toUpperCase()
      if (!legalName?.trim() || !contactPerson?.trim() || !email?.trim() || !phone?.trim() || !panNumber) {
        return res.status(400).json({ success: false, error: 'Legal business name, contact person, email, phone and PAN number are required' })
      }
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) return res.status(400).json({ success: false, error: 'Enter a valid email address' })
      if (!PAN_PATTERN.test(panNumber)) return res.status(400).json({ success: false, error: 'Enter a valid PAN number in the format ABCDE1234F' })
      const existingPan = await Vendor.findOne({ panNumber })
      if (existingPan) return res.status(409).json({ success: false, error: 'A vendor with this PAN number is already registered' })
      const year = new Date().getFullYear()
      const rnd = Math.floor(Math.random() * 90000) + 10000
      const vendorCode = `VND-${year}-${rnd}`
      const vendor = await Vendor.create({ vendorCode, legalName: legalName.trim(), contactPerson: contactPerson.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), panNumber, taxNumber: taxNumber?.trim(), address: address?.trim(), createdBy: actorName })
      return res.status(201).json({ success: true, data: vendor })
    }

    // ── POST /api/vendors?id=&action=activate|deactivate|blacklist ────────────
    if (req.method === 'POST' && id && action) {
      if (!['admin', 'super_admin', 'manager'].includes(userRole)) {
        return res.status(403).json({ success: false, error: 'Only admin or manager can change vendor status' })
      }
      const vendor = await Vendor.findById(id)
      if (!vendor) return res.status(404).json({ success: false, error: 'Vendor not found' })
      let newStatus = vendor.status
      if (action === 'activate') newStatus = 'ACTIVE'
      else if (action === 'deactivate') newStatus = 'INACTIVE'
      else if (action === 'blacklist') newStatus = 'BLACKLISTED'
      else return res.status(400).json({ success: false, error: 'Invalid action' })
      await Vendor.updateOne({ id }, { $set: { status: newStatus } })
      vendor.status = newStatus
      return res.json({ success: true, data: vendor })
    }

    // ── POST /api/vendors?subResource=delivery-persons — Add delivery person ──
    if (req.method === 'POST' && subResource === 'delivery-persons') {
      const { vendorId, name, phone, idType, idNumber } = req.body
      if (!name || !phone || !idNumber) {
        return res.status(400).json({ success: false, error: 'name, phone, idNumber are required' })
      }
      const dp = await DeliveryPerson.create({ vendorId, name, phone, idType: idType || 'AADHAR', idNumber })
      return res.status(201).json({ success: true, data: dp })
    }

    // ── POST /api/vendors?subResource=vehicles — Add vehicle ─────────────────
    if (req.method === 'POST' && subResource === 'vehicles') {
      const { vendorId, vehicleNumber, vehicleType } = req.body
      if (!vehicleNumber) return res.status(400).json({ success: false, error: 'vehicleNumber is required' })
      const v = await Vehicle.create({ vendorId, vehicleNumber, vehicleType: vehicleType || 'OTHER' })
      return res.status(201).json({ success: true, data: v })
    }

    // ── GET /api/vendors?subResource=delivery-persons ────────────────────────
    if (req.method === 'GET' && subResource === 'delivery-persons') {
      const filter = {}
      if (req.query.vendorId) filter.vendorId = req.query.vendorId
      const dps = await DeliveryPerson.find(filter)
      return res.json({ success: true, data: dps })
    }

    // ── GET /api/vendors?subResource=vehicles ────────────────────────────────
    if (req.method === 'GET' && subResource === 'vehicles') {
      const filter = {}
      if (req.query.vendorId) filter.vendorId = req.query.vendorId
      const vs = await Vehicle.find(filter)
      return res.json({ success: true, data: vs })
    }

    // ── PATCH /api/vendors?id= — Update vendor ───────────────────────────────
    if (req.method === 'PATCH' && id) {
      const vendor = await Vendor.findById(id)
      if (!vendor) return res.status(404).json({ success: false, error: 'Vendor not found' })
      const allowed = ['legalName', 'contactPerson', 'email', 'phone', 'panNumber', 'taxNumber', 'address', 'notes']
      if (req.body.panNumber !== undefined) {
        const panNumber = String(req.body.panNumber).trim().toUpperCase()
        if (!PAN_PATTERN.test(panNumber)) return res.status(400).json({ success: false, error: 'Enter a valid PAN number in the format ABCDE1234F' })
        const existingPan = await Vendor.findOne({ panNumber, id: { $ne: id } })
        if (existingPan) return res.status(409).json({ success: false, error: 'A vendor with this PAN number is already registered' })
        req.body.panNumber = panNumber
      }
      const updateData = {}
      allowed.forEach(f => { if (req.body[f] !== undefined) { updateData[f] = req.body[f]; vendor[f] = req.body[f] } })
      await Vendor.updateOne({ id }, { $set: updateData })
      return res.json({ success: true, data: vendor })
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' })
  } catch (err) {
    console.error('Vendors API error:', err)
    return res.status(500).json({ success: false, error: 'Internal server error' })
  }
}
