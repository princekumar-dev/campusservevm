import { connectToDatabase } from '../lib/pg.js'
import { PushSubscription, Notification } from '../db/index.js'

// Store push subscription
export async function storePushSubscription(subscription, userEmail) {
	await connectToDatabase()

	try {
		console.log(`📝 Storing subscription for ${userEmail}`)
		console.log(`🔗 Endpoint: ${subscription.endpoint.substring(0, 50)}...`)

		// CRITICAL: First, deactivate ALL subscriptions for ALL users with this endpoint
		const existingByEndpoint = await PushSubscription.find({
			'subscription.endpoint': subscription.endpoint
		})

		if (existingByEndpoint.length > 0) {
			console.log(`🔄 Found ${existingByEndpoint.length} existing subscription(s) for this endpoint`)

			await PushSubscription.updateMany(
				{ 'subscription.endpoint': subscription.endpoint },
				{
					$set: {
						active: false,
						status: 'expired',
						deactivatedAt: new Date(),
						statusUpdatedAt: new Date(),
						deactivatedReason: 'endpoint_reassigned'
					}
				}
			)

			console.log(`✅ Deactivated all existing subscriptions for this endpoint`)
		}

		// Now deactivate ALL existing subscriptions for this specific user
		await PushSubscription.updateMany(
			{ userEmail },
			{
				$set: {
					active: false,
					status: 'expired',
					deactivatedAt: new Date(),
					statusUpdatedAt: new Date(),
					deactivatedReason: 'new_subscription_created'
				}
			}
		)

		// Store the new subscription as active
		const result = await PushSubscription.create({
			userEmail,
			subscription,
			createdAt: new Date(),
			updatedAt: new Date(),
			active: true,
			status: 'active',
			statusUpdatedAt: new Date()
		})

		console.log(`✅ New subscription created for ${userEmail}`)
		return { success: true, created: true, id: result.id }
	} catch (error) {
		console.error('❌ Error storing push subscription:', error)
		return { success: false, error: error.message }
	}
}

// Remove push subscription (now marks expired instead of deleting)
export async function removePushSubscription(endpoint, userEmail) {
	await connectToDatabase()

	try {
		const res = await PushSubscription.updateOne({
			userEmail,
			'subscription.endpoint': endpoint
		}, {
			$set: {
				active: false,
				status: 'expired',
				deactivatedAt: new Date(),
				statusUpdatedAt: new Date(),
				deactivatedReason: 'user_unsubscribe'
			}
		})

		if (res.matchedCount === 0) {
			await PushSubscription.deleteOne({ userEmail, 'subscription.endpoint': endpoint })
		}

		return { success: true }
	} catch (error) {
		console.error('Error removing push subscription:', error)
		return { success: false, error: error.message }
	}
}

// Get all active subscriptions for a user
export async function getUserSubscriptions(userEmail) {
	await connectToDatabase()

	try {
		console.log(`🔍 Looking for active subscriptions for: ${userEmail}`)

		// First ensure subscription integrity
		await ensureSubscriptionIntegrity();

		// Now get the user's active subscriptions (after cleanup)
		const subscriptions = await PushSubscription.find({
			userEmail,
			$or: [ { active: true }, { status: 'active' } ]
		})

		console.log(`📱 Found ${subscriptions.length} active subscription(s) for ${userEmail}`)

		return { success: true, subscriptions }
	} catch (error) {
		console.error('❌ Error getting user subscriptions:', error);
		return { success: false, error: error.message, subscriptions: [] };
	}
}


// Utility function to ensure subscription integrity - no endpoint active for multiple users
async function ensureSubscriptionIntegrity() {
	try {
		console.log('🔒 Ensuring subscription integrity...')

		// Get all active subscriptions (by status or flag)
		const activeSubscriptions = await PushSubscription.find({ $or: [ { active: true }, { status: 'active' } ] });

		// Group by endpoint
		const endpointGroups = {};
		activeSubscriptions.forEach(sub => {
			const endpoint = sub.subscription?.endpoint;
			if (endpoint) {
				if (!endpointGroups[endpoint]) {
					endpointGroups[endpoint] = [];
				}
				endpointGroups[endpoint].push(sub);
			}
		});

		let integrityIssues = 0;

		// Check each endpoint group
		for (const [endpoint, subscriptions] of Object.entries(endpointGroups)) {
			if (subscriptions.length > 1) {
				console.log(`⚠️  Endpoint ${endpoint.substring(0, 50)}... has ${subscriptions.length} active subscriptions!`);

				// Sort by creation/update time, keep the most recent
				subscriptions.sort((a, b) => {
					const aTime = a.updatedAt || a.createdAt || new Date(0);
					const bTime = b.updatedAt || b.createdAt || new Date(0);
					return bTime - aTime;
				});

				const keepActive = subscriptions[0];
				const toDeactivate = subscriptions.slice(1);

				console.log(`   ✅ Keeping active for: ${keepActive.userEmail}`);
				console.log(`   ❌ Deactivating ${toDeactivate.length} others`);

				for (const sub of toDeactivate) {
					await PushSubscription.updateOne(
						{ id: sub.id },
						{
							$set: {
								active: false,
								status: 'expired',
								statusUpdatedAt: new Date(),
								deactivatedAt: new Date(),
								deactivatedReason: 'integrity_fix_multiple_active'
							}
						}
					);
					integrityIssues++;
				}
			}
		}

		if (integrityIssues > 0) {
			console.log(`🔧 Fixed ${integrityIssues} subscription integrity issues`);
		} else {
			console.log('✅ Subscription integrity OK');
		}

		return true;
	} catch (error) {
		console.error('❌ Error ensuring subscription integrity:', error);
		return false;
	}
}

// Utility function to clean up duplicate and stale subscriptions
async function cleanupSubscriptions() {
	try {
		// Get all subscriptions
		const allSubscriptions = await PushSubscription.find({});
		
		// Find duplicate endpoints assigned to different users
		const endpoints = new Map();
		const duplicateEndpoints = new Set();
		
		allSubscriptions.forEach(sub => {
			const endpoint = sub.subscription?.endpoint;
			if (endpoint) {
				if (endpoints.has(endpoint)) {
					duplicateEndpoints.add(endpoint);
				} else {
					endpoints.set(endpoint, sub);
				}
			}
		});
		
		// If we found duplicates, clean them up
		if (duplicateEndpoints.size > 0) {
			console.log(`⚠️ Found ${duplicateEndpoints.size} duplicate subscription endpoints - cleaning up...`);
			
			for (const endpoint of duplicateEndpoints) {
				const subs = allSubscriptions.filter(sub => sub.subscription?.endpoint === endpoint);
				const activeSubs = subs.filter(sub => sub.active === true || sub.status === 'active');
				
				if (activeSubs.length > 1) {
					activeSubs.sort((a, b) => {
						const aDate = a.updatedAt || a.createdAt;
						const bDate = b.updatedAt || b.createdAt;
						return bDate - aDate;
					});
					
					const mostRecent = activeSubs[0];
					console.log(`✅ Keeping active subscription for ${mostRecent.userEmail} (most recent)`);
					
					for (let i = 1; i < activeSubs.length; i++) {
						const oldSub = activeSubs[i];
						console.log(`❌ Deactivating duplicate active subscription for ${oldSub.userEmail}`);
						await PushSubscription.updateOne(
							{ id: oldSub.id },
							{ 
								$set: { 
									active: false,
									status: 'expired',
									statusUpdatedAt: new Date(),
									deactivatedAt: new Date(),
									deactivatedReason: 'duplicate_endpoint_cleanup'
								} 
							} 
						);
					}
				} else if (activeSubs.length === 0 && subs.length > 0) {
					console.log(`ℹ️ Found ${subs.length} inactive subscriptions for endpoint - leaving as is`);
				}
			}
		}
		
		return true;
	} catch (error) {
		console.error('❌ Error cleaning up subscriptions:', error);
		return false;
	}
}

// Get all active subscriptions (for broadcasting)
export async function getAllActiveSubscriptions() {
	await connectToDatabase()

	try {
		await ensureSubscriptionIntegrity();
		await cleanupSubscriptions();

		const subscriptions = await PushSubscription.find({
			$or: [ { active: true }, { status: 'active' } ]
		})

		return { success: true, subscriptions }
	} catch (error) {
		console.error('Error getting all subscriptions:', error)
		return { success: false, error: error.message }
	}
}

// Store notification in database
export async function storeNotification(notification) {
	await connectToDatabase()

	try {
		const result = await Notification.create({
			...notification,
			userEmail: String(notification.userEmail || '').trim().toLowerCase(),
			createdAt: new Date(),
			read: false
		})

		return { success: true, id: result.id }
	} catch (error) {
		console.error('Error storing notification:', error)
		return { success: false, error: error.message }
	}
}

// Get notifications for a user
export async function getUserNotifications(userEmail, limit = 50) {
	await connectToDatabase()

	try {
		const normalizedEmail = String(userEmail || '').trim().toLowerCase()
		const notifications = await Notification.find(
			{ userEmail: normalizedEmail },
			{ sort: { createdAt: -1 }, limit }
		)

		return { success: true, notifications }
	} catch (error) {
		console.error('Error getting notifications:', error)
		return { success: false, error: error.message }
	}
}

// Count unread notifications without loading full notification documents.
export async function getUnreadNotificationCount(userEmail) {
	await connectToDatabase()

	try {
		const normalizedEmail = String(userEmail || '').trim().toLowerCase()
		if (!normalizedEmail) return { success: true, unreadCount: 0 }
		const notifications = await Notification.find({
			userEmail: normalizedEmail,
			read: { $ne: true }
		})
		return { success: true, unreadCount: notifications.length }
	} catch (error) {
		console.error('Error counting unread notifications:', error)
		return { success: false, error: error.message, unreadCount: 0 }
	}
}

// Mark notification as read
export async function markNotificationAsRead(notificationId, userEmail = '') {
	await connectToDatabase()

	try {
		const query = { id: notificationId }
		if (userEmail) query.userEmail = String(userEmail).trim().toLowerCase()
		await Notification.updateOne(
			query,
			{ $set: { read: true, readAt: new Date() } }
		)

		return { success: true }
	} catch (error) {
		console.error('Error marking notification as read:', error)
		return { success: false, error: error.message }
	}
}

// Mark every unread notification for a user as read. This must happen in the
// database rather than only against the limited page loaded by the UI.
export async function markAllNotificationsAsRead(userEmail) {
	await connectToDatabase()

	try {
		const normalizedEmail = String(userEmail || '').trim().toLowerCase()
		if (!normalizedEmail) {
			return { success: false, error: 'User email is required' }
		}

		const result = await Notification.updateMany(
			{ userEmail: normalizedEmail, read: { $ne: true } },
			{ $set: { read: true, readAt: new Date() } }
		)

		return { success: true, modifiedCount: result.modifiedCount }
	} catch (error) {
		console.error('Error marking all notifications as read:', error)
		return { success: false, error: error.message }
	}
}

// Mark all notifications of a specific type for a user as read
export async function markNotificationTypeAsRead(userEmail, type) {
	await connectToDatabase()

	try {
		await Notification.updateMany(
			{ userEmail, type },
			{ $set: { read: true, readAt: new Date() } }
		)

		return { success: true }
	} catch (error) {
		console.error('Error marking notifications as read:', error)
		return { success: false, error: error.message }
	}
}
