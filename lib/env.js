const MIN_SECRET_LENGTH = 32

function required(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function validateHttpsUrl(name, value) {
  let parsed
  try { parsed = new URL(value) } catch { throw new Error(`${name} must be a valid URL`) }
  if (parsed.protocol !== 'https:') throw new Error(`${name} must use HTTPS in production`)
}

function validateSecret(name, value) {
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} must contain at least ${MIN_SECRET_LENGTH} characters`)
  }
  if (/change|default|replace|example|secret/i.test(value)) {
    throw new Error(`${name} still appears to contain a placeholder value`)
  }
}

export function parseAllowedOrigins() {
  const configured = String(process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || '')
    .split(',')
    .map(value => value.trim().replace(/\/$/, ''))
    .filter(Boolean)

  if (process.env.NODE_ENV !== 'production') {
    configured.push('http://localhost:3000', 'http://localhost:5173')
  }

  return [...new Set(configured)]
}

export function validateProductionEnvironment() {
  if (process.env.NODE_ENV !== 'production') return

  const mongoUri = String(process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL || '').trim()
  if (!mongoUri) throw new Error('Missing required environment variable: MONGODB_URI')

  const jwtSecret = required('JWT_SECRET')
  const qrSecret = required('PO_QR_SECRET')
  const emailSecret = required('EMAIL_VERIFICATION_SECRET')
  validateSecret('JWT_SECRET', jwtSecret)
  validateSecret('PO_QR_SECRET', qrSecret)
  validateSecret('EMAIL_VERIFICATION_SECRET', emailSecret)
  if (new Set([jwtSecret, qrSecret, emailSecret]).size !== 3) {
    throw new Error('JWT_SECRET, PO_QR_SECRET, and EMAIL_VERIFICATION_SECRET must be different')
  }

  const frontendUrl = required('FRONTEND_URL').replace(/\/$/, '')
  const publicBaseUrl = required('PUBLIC_BASE_URL').replace(/\/$/, '')
  validateHttpsUrl('FRONTEND_URL', frontendUrl)
  validateHttpsUrl('PUBLIC_BASE_URL', publicBaseUrl)

  const allowedOrigins = parseAllowedOrigins()
  if (!allowedOrigins.length) throw new Error('ALLOWED_ORIGINS or FRONTEND_URL must be configured')
  allowedOrigins.forEach(origin => validateHttpsUrl('ALLOWED_ORIGINS entry', origin))

  const vapidPublic = String(process.env.VAPID_PUBLIC_KEY || '').trim()
  const vapidPrivate = String(process.env.VAPID_PRIVATE_KEY || '').trim()
  if (Boolean(vapidPublic) !== Boolean(vapidPrivate)) {
    throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together')
  }

  const serviceEmail = String(process.env.SERVICE_PORTAL_EMAIL || '').trim()
  const servicePassword = String(process.env.SERVICE_PORTAL_PASSWORD || '')
  if (Boolean(serviceEmail) !== Boolean(servicePassword)) {
    throw new Error('SERVICE_PORTAL_EMAIL and SERVICE_PORTAL_PASSWORD must be set together')
  }
  if (servicePassword && servicePassword.length < 12) {
    throw new Error('SERVICE_PORTAL_PASSWORD must contain at least 12 characters')
  }
}

