import jwt from 'jsonwebtoken'
import { User } from '../db/index.js'

function getJwtSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not configured')
  return secret
}
const JWT_EXPIRY = '7d'

export function generateToken(user, options = {}) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      ...(options.scanPortal ? { scanPortal: options.scanPortal } : {}),
      ...(options.scanTarget ? { scanTarget: options.scanTarget } : {})
    },
    getJwtSecret(),
    { expiresIn: JWT_EXPIRY }
  )
}

export function verifyToken(token) {
  return jwt.verify(token, getJwtSecret())
}

export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required' })
  }

  const token = authHeader.split(' ')[1]
  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required' })
  }

  try {
    const decoded = verifyToken(token)
    const user = await User.findById(decoded.id)
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, error: 'User not found or deactivated' })
    }
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      institution: user.institution || '',
      department: user.department,
      phoneNumber: user.phoneNumber,
      eSignature: user.eSignature,
      scanPortal: decoded.scanPortal || '',
      scanTarget: decoded.scanTarget || ''
    }
    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Token expired' })
    }
    return res.status(401).json({ success: false, error: 'Invalid token' })
  }
}

export function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' })
    }
    if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' })
    }
    next()
  }
}
