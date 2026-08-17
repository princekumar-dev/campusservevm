import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { connectToDatabase } from '../lib/pg.js'
import { User, PurchaseOrder, ServiceRequest } from '../db/index.js'

const defaults = {
  gate: {
    name: 'Gate Security Guard',
    email: String(process.env.GATE_USER_EMAIL || 'gate@msec.edu.in').trim().toLowerCase(),
    password: String(process.env.GATE_USER_PASSWORD || '123'),
    role: 'gate',
    department: 'SECURITY',
    phoneNumber: String(process.env.GATE_USER_PHONE || '')
  },
  service: {
    name: 'MSEC Service Provider',
    email: String(process.env.SERVICE_PROVIDER_EMAIL || 'service2@msec.edu.in').trim().toLowerCase(),
    password: String(process.env.SERVICE_PROVIDER_PASSWORD || '123'),
    role: 'service_provider',
    department: 'MAINTENANCE',
    phoneNumber: String(process.env.SERVICE_PROVIDER_PHONE || '')
  }
}

async function ensureUser({ name, email, password, role, department, phoneNumber }) {
  if (!email || !password) throw new Error(`Missing credentials for ${role}`)

  const existing = await User.findOne({ email })
  if (existing) {
    const updateData = {
      role,
      isActive: true,
      department: existing.department || department,
      name: existing.name || name
    }
    if (!existing.phoneNumber && phoneNumber) updateData.phoneNumber = phoneNumber
    if (password) updateData.password = await bcrypt.hash(password, 10)

    await User.updateOne({ id: existing.id }, { $set: updateData })
    console.log(`Updated ${role} login: ${email}`)
    return await User.findOne({ email })
  }

  await User.create({
    name,
    email,
    password: await bcrypt.hash(password, 10),
    role,
    department,
    phoneNumber,
    isActive: true
  })
  console.log(`Created ${role} login: ${email}`)
  return await User.findOne({ email })
}

async function assignExistingMaintenancePos(serviceProvider) {
  const maintenanceRequests = await ServiceRequest.find({ 'adminAssessment.requirementType': 'MAINTENANCE' }, { select: 'id' })
  const requestIds = maintenanceRequests.map(request => request.id)
  if (!requestIds.length) return 0

  const maintenancePos = await PurchaseOrder.find({ requestId: { $in: requestIds } }, { select: 'id serviceProviderId serviceProviderEmail' })
  let updated = 0
  for (const po of maintenancePos) {
    if (String(po.serviceProviderId || '') === String(serviceProvider.id) && String(po.serviceProviderEmail || '').toLowerCase() === serviceProvider.email) continue
    await PurchaseOrder.updateOne({ id: po.id }, { $set: {
      serviceProviderId: serviceProvider.id,
      serviceProviderName: serviceProvider.name,
      serviceProviderEmail: serviceProvider.email,
      vendorName: serviceProvider.name,
      vendorEmail: serviceProvider.email
    } })
    updated += 1
  }
  return updated
}

await connectToDatabase()
await ensureUser(defaults.gate)
const serviceProvider = await ensureUser(defaults.service)
const reassignedCount = await assignExistingMaintenancePos(serviceProvider)

console.log(`Gate + service-provider logins are ready. ${reassignedCount} maintenance PO(s) assigned to ${serviceProvider.email}.`)
process.exit(0)
