const baseUrl = String(process.env.DEPLOY_URL || process.argv[2] || '').replace(/\/$/, '')
if (!baseUrl) {
  console.error('Usage: node scripts/verify-deployment.mjs https://your-domain')
  process.exit(2)
}
if (!baseUrl.startsWith('https://')) {
  console.error('Deployment URL must use HTTPS')
  process.exit(2)
}

async function check(path, validate) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: 'error' })
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
  await validate(response)
  console.log(`PASS ${path}`)
}

await check('/api/health', async response => {
  const body = await response.json()
  if (!body.ok || body.database !== 'connected') throw new Error('Database readiness check failed')
})

await check('/', async response => {
  const html = await response.text()
  if (!html.includes('<div id="root"></div>')) throw new Error('Frontend HTML was not served')
})

const httpUrl = baseUrl.replace(/^https:/, 'http:')
const redirect = await fetch(httpUrl, { redirect: 'manual' })
if (![301, 302, 307, 308].includes(redirect.status) || !String(redirect.headers.get('location')).startsWith('https://')) {
  throw new Error('HTTP does not redirect to HTTPS')
}
console.log('PASS HTTP to HTTPS redirect')
console.log('Deployment verification completed successfully')
