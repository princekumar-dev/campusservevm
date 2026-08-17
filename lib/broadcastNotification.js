import webpush from 'web-push'
import { getAllActiveSubscriptions } from '../lib/notificationService.js'

/**
 * Send a broadcast notification to all active users
 * This will trigger push notifications on all browsers with active subscriptions
 */
export async function sendBroadcastNotification(title, body, data = {}) {
  try {
    const { subscriptions } = await getAllActiveSubscriptions()
    const activeSubs = (subscriptions || []).filter(s => s.active === true || s.status === 'active')

    if (!activeSubs || activeSubs.length === 0) {
      console.log('ℹ️ No active subscriptions for broadcast')
      return { success: true, count: 0 }
    }

    const payload = JSON.stringify({
      title,
      body,
      icon: '/images/android-chrome-192x192.png',
      badge: '/images/favicon-32x32.png',
      tag: 'msec-broadcast',
      data: {
        type: data.type || 'broadcast',
        ...data,
        timestamp: Date.now()
      }
    })

    console.log(`📢 Sending broadcast to ${activeSubs.length} subscriber(s)...`)
    
    const promises = activeSubs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub.subscription, payload)
        return { success: true }
      } catch (error) {
        console.error('Failed to send to subscription:', error.message)
        return { success: false, error: error.message }
      }
    })

    const results = await Promise.all(promises)
    const successCount = results.filter(r => r.success).length

    console.log(`✅ Broadcast sent to ${successCount}/${activeSubs.length} subscribers`)

    return { success: true, count: successCount }
  } catch (error) {
    console.error('Broadcast notification error:', error)
    return { success: false, error: error.message }
  }
}
