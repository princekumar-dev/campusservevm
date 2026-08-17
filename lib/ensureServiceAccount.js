import bcrypt from 'bcryptjs'
import { User } from '../db/index.js'

export async function ensureServiceAccount() {
  const email = String(process.env.SERVICE_PORTAL_EMAIL || '').trim().toLowerCase()
  const password = String(process.env.SERVICE_PORTAL_PASSWORD || '')
  if (!email && !password) return null
  if (!email || !password) throw new Error('SERVICE_PORTAL_EMAIL and SERVICE_PORTAL_PASSWORD must be configured together')
  if (password.length < 12) throw new Error('SERVICE_PORTAL_PASSWORD must contain at least 12 characters')
  const existing = await User.findOne({ email })
  if (existing) return existing

  return User.create({
    name: 'MSEC Service Provider',
    email,
    password: await bcrypt.hash(password, 10),
    role: 'service_provider',
    department: 'MAINTENANCE',
    phoneNumber: process.env.SERVICE_PORTAL_PHONE || '',
    isActive: true
  })
}
