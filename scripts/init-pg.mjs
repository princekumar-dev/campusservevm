import 'dotenv/config'
import { Client } from 'pg'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

const PG_USER = process.env.PG_USER || 'postgres'
const PG_PASS = process.env.PG_PASS || '472313'
const PG_HOST = process.env.PG_HOST || 'localhost'
const PG_PORT = process.env.PG_PORT || 5432
const DB_NAME = process.env.DB_NAME || 'Campusserve'

const adminUrl = `postgresql://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/postgres`
const dbUrl = `postgresql://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${DB_NAME}`

function log(msg) { console.log(`[init] ${msg}`) }
function err(msg) { console.error(`[error] ${msg}`) }

// ── Step 1: Create database if not exists ─────────────────────────────────────
async function createDatabase() {
  log('Connecting to PostgreSQL server...')
  const client = new Client({ connectionString: adminUrl })
  await client.connect()

  const exists = await client.query(
    `SELECT 1 FROM pg_database WHERE datname = $1`, [DB_NAME]
  )

  if (exists.rows.length === 0) {
    log(`Creating database "${DB_NAME}"...`)
    await client.query(`CREATE DATABASE "${DB_NAME}"`)
    log(`Database "${DB_NAME}" created`)
  } else {
    log(`Database "${DB_NAME}" already exists`)
  }

  await client.end()
}

// ── Step 2: Run schema.sql ────────────────────────────────────────────────────
async function runSchema() {
  log('Running schema.sql...')
  const client = new Client({ connectionString: dbUrl })
  await client.connect()

  // Drop all existing tables first for clean init
  log('Dropping existing tables...')
  const { rows: tables } = await client.query(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `)
  for (const t of tables) {
    await client.query(`DROP TABLE IF EXISTS "${t.tablename}" CASCADE`)
  }
  log(`Dropped ${tables.length} tables`)

  const schemaPath = path.join(rootDir, 'schema.sql')
  if (!fs.existsSync(schemaPath)) {
    err('schema.sql not found!')
    process.exit(1)
  }

  const schema = fs.readFileSync(schemaPath, 'utf8')
  await client.query(schema)
  log('Schema initialized')

  const { rows } = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `)
  log(`${rows.length} tables created`)

  await client.end()
}

// ── Step 3: Seed users ────────────────────────────────────────────────────────
async function seedUsers() {
  log('Seeding users...')
  const client = new Client({ connectionString: dbUrl })
  await client.connect()

  const users = [
    { name: 'Super Admin', email: 'super@msec.edu.in', role: 'super_admin', department: 'SYSTEM', phone: '+91-9876543200' },
    { name: 'Campus Admin', email: 'admin@msec.edu.in', role: 'admin', department: 'ADMIN', phone: '+91-9876543201' },
    { name: 'Service Manager John', email: 'manager@msec.edu.in', role: 'manager', department: 'MAINTENANCE', phone: '+91-9876543202' },
    { name: 'Technician Dave', email: 'tech@msec.edu.in', role: 'technician', department: 'ELECTRICAL', phone: '+91-9876543203' },
    { name: 'Accounts Officer Sarah', email: 'accounts@msec.edu.in', role: 'accounts', department: 'ACCOUNTS', phone: '+91-9876543204' },
    { name: 'Dr. Helen (Faculty Requester)', email: 'faculty@msec.edu.in', role: 'requester', department: 'CSE', phone: '+91-9876543205', institution: 'msec' },
    { name: 'Gate Security Guard', email: 'gate@msec.edu.in', role: 'gate', department: 'SECURITY', phone: '+91-9876543206' },
    { name: 'Receiving Officer Kumar', email: 'receiving@msec.edu.in', role: 'receiving_officer', department: 'STORES', phone: '+91-9876543207' },
    { name: 'MSEC Maintenance Service', email: 'service2@msec.edu.in', role: 'service_provider', department: 'MAINTENANCE', phone: '+91-9876543209' },
    { name: 'Dr. Rajesh Kumar', email: 'hod.cse@msec.edu.in', role: 'hod', department: 'CSE', phone: '+91-9876543210', institution: 'msec' },
    { name: 'Dr. Priya Sharma', email: 'hod.ece@msec.edu.in', role: 'hod', department: 'ECE', phone: '+91-9876543211', institution: 'msec' },
    { name: 'Dr. Amit Patel', email: 'hod.mech@msec.edu.in', role: 'hod', department: 'MECH', phone: '+91-9876543212', institution: 'msec' },
    { name: 'Dr. Sunita Reddy', email: 'hod.civil@msec.edu.in', role: 'hod', department: 'CIVIL', phone: '+91-9876543213', institution: 'msec' },
    { name: 'Dr. Vikram Singh', email: 'hod.eee@msec.edu.in', role: 'hod', department: 'EEE', phone: '+91-9876543214', institution: 'msec' },
    { name: 'Dr. Latha Narayanan', email: 'hod.hns@msec.edu.in', role: 'hod', department: 'HNS', phone: '+91-9876543230', institution: 'msec' },
    { name: 'Prof. Anita Desai', email: 'anita.desai@msec.edu.in', role: 'staff', department: 'CSE', phone: '+91-9876543215', institution: 'msec' },
    { name: 'Prof. Ramesh Gupta', email: 'ramesh.gupta@msec.edu.in', role: 'staff', department: 'CSE', phone: '+91-9876543216', institution: 'msec' },
    { name: 'Prof. Meera Joshi', email: 'meera.joshi@msec.edu.in', role: 'staff', department: 'ECE', phone: '+91-9876543217', institution: 'msec' },
    { name: 'Prof. Suresh Kumar', email: 'suresh.kumar@msec.edu.in', role: 'staff', department: 'ECE', phone: '+91-9876543218', institution: 'msec' },
    { name: 'Prof. Kavitha Nair', email: 'kavitha.nair@msec.edu.in', role: 'staff', department: 'MECH', phone: '+91-9876543219', institution: 'msec' },
    { name: 'Prof. Ravi Krishnan', email: 'ravi.krishnan@msec.edu.in', role: 'staff', department: 'MECH', phone: '+91-9876543220', institution: 'msec' },
    { name: 'Prof. Deepa Mehta', email: 'deepa.mehta@msec.edu.in', role: 'staff', department: 'CIVIL', phone: '+91-9876543221', institution: 'msec' },
    { name: 'Prof. Arun Verma', email: 'arun.verma@msec.edu.in', role: 'staff', department: 'CIVIL', phone: '+91-9876543222', institution: 'msec' },
    { name: 'Prof. Lakshmi Pillai', email: 'lakshmi.pillai@msec.edu.in', role: 'staff', department: 'EEE', phone: '+91-9876543223', institution: 'msec' },
    { name: 'Prof. Manoj Tiwari', email: 'manoj.tiwari@msec.edu.in', role: 'staff', department: 'EEE', phone: '+91-9876543224', institution: 'msec' },
    { name: 'Prof. Maya Krishnan', email: 'maya.krishnan@msec.edu.in', role: 'staff', department: 'HNS', phone: '+91-9876543231', institution: 'msec' },
    { name: 'Prof. S. Ramesh', email: 's.ramesh@msec.edu.in', role: 'staff', department: 'HNS', phone: '+91-9876543232', institution: 'msec' },
  ]

  const defaultPassword = await bcrypt.hash('123', 10)
  let created = 0
  let skipped = 0

  for (const u of users) {
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [u.email])
    if (existing.rows.length > 0) {
      skipped++
      continue
    }

    await client.query(
      `INSERT INTO users (email, password, role, name, institution, department, phone_number, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
      [u.email, defaultPassword, u.role, u.name, u.institution || null, u.department, u.phone]
    )
    created++
    log(`  Created [${u.role}] ${u.name} (${u.email})`)
  }

  log(`${created} users created, ${skipped} skipped (already exist)`)
  await client.end()
}

// ── Step 4: Seed system settings ──────────────────────────────────────────────
async function seedSettings() {
  log('Seeding system settings...')
  const client = new Client({ connectionString: dbUrl })
  await client.connect()

  const existing = await client.query('SELECT id FROM system_settings WHERE key = $1', ['global'])
  if (existing.rows.length === 0) {
    const institutions = JSON.stringify([
      { id: 'msec', shortName: 'MSEC', fullName: 'Meenakshi Sundararajan Engineering College', emailDomain: '@msec.edu.in', defaultDepartment: 'CSE', affiliation: 'Anna University', documentAddress: 'MSEC Campus, Chennai', contactLine: '+91-44-12345678', website: 'https://msec.edu.in' },
      { id: 'nest', shortName: 'NEST', fullName: 'NEST International School', emailDomain: '@nest.edu.in', defaultDepartment: 'Primary Years', affiliation: 'CBSE', documentAddress: 'NEST Campus, Chennai', contactLine: '+91-44-23456789', website: 'https://nest.edu.in' },
      { id: 'mcw', shortName: 'MCW', fullName: 'Meenakshi College for Women', emailDomain: '@mcw.edu.in', defaultDepartment: 'Administration', affiliation: 'Autonomous', documentAddress: 'MCW Campus, Chennai', contactLine: '+91-44-34567890', website: 'https://mcw.edu.in' },
      { id: 'mssm', shortName: 'MSSM', fullName: 'MSSM Business School', emailDomain: '@mssm.edu.in', defaultDepartment: 'General Management', affiliation: 'Autonomous', documentAddress: 'MSSM Campus, Chennai', contactLine: '+91-44-45678901', website: 'https://mssm.edu.in' },
      { id: 'iic', shortName: 'IIC', fullName: 'Innovation & Incubation Centre', emailDomain: '@iic.edu.in', defaultDepartment: 'Innovation Council', affiliation: 'MSEC Group', documentAddress: 'IIC Campus, Chennai', contactLine: '+91-44-56789012', website: 'https://iic.edu.in' }
    ])

    await client.query(
      `INSERT INTO system_settings (key, institutions, college_name, college_full_name, email_domain, default_department)
       VALUES ($1, $2, 'MSEC', 'Meenakshi Sundararajan Engineering College', '@msec.edu.in', 'MAINTENANCE')`,
      ['global', institutions]
    )
    log('System settings created')
  } else {
    log('System settings already exist')
  }

  await client.end()
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('')
  console.log('  CampusServe Pro - PostgreSQL Initializer')
  console.log('  ========================================')
  console.log('')

  try {
    await createDatabase()
    await runSchema()
    await seedUsers()
    await seedSettings()

    console.log('')
    log('All done! Database is ready.')
    console.log('')
    log('Default login credentials (password: 123):')
    log('  super@msec.edu.in  (Super Admin)')
    log('  admin@msec.edu.in  (Admin)')
    log('  manager@msec.edu.in (Manager)')
    log('  tech@msec.edu.in   (Technician)')
    log('  faculty@msec.edu.in (Faculty/Requester)')
    log('  gate@msec.edu.in   (Gate Security)')
    log('  service2@msec.edu.in (Service Provider)')
    log('  receiving@msec.edu.in (Receiving Officer)')
    console.log('')
    log('Start the server: node server.js')
    console.log('')
  } catch (e) {
    err(e.message)
    process.exit(1)
  }
}

main()
