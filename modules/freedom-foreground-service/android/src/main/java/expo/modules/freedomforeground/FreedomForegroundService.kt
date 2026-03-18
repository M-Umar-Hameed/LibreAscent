package expo.modules.freedomforeground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager

/**
 * Freedom Foreground Service — Keeps the app alive via persistent notification.
 *
 * Features:
 * - Persistent "Freedom is protecting you" notification
 * - Dynamic notification text updates (blocked count)
 * - Tapping notification opens the app
 * - Listens for domain blocked events to update counter
 * - START_STICKY for automatic restart by Android
 */
class FreedomForegroundService : Service() {

    private var blockedDomainReceiver: BroadcastReceiver? = null
    private var blockedCount: Int = 0

    companion object {
        private const val TAG = "FreedomForeground"
        const val CHANNEL_ID = "freedom_protection"
        const val NOTIFICATION_ID = 1001
        const val ACTION_UPDATE_NOTIFICATION = "expo.modules.freedomforeground.UPDATE"
        const val EXTRA_TITLE = "title"
        const val EXTRA_TEXT = "text"

        @Volatile
        var isRunning: Boolean = false
            private set
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        registerBlockedReceiver()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        isRunning = true

        // Check if this is an update request
        val action = intent?.action
        if (action == ACTION_UPDATE_NOTIFICATION) {
            val title = intent.getStringExtra(EXTRA_TITLE)
            val text = intent.getStringExtra(EXTRA_TEXT)
            updateNotification(title, text)
            return START_STICKY
        }

        // Normal start — show notification
        startForeground(NOTIFICATION_ID, createNotification())
        Log.i(TAG, "Foreground service started")

        return START_STICKY
    }

    /**
     * Update the notification text dynamically.
     */
    private fun updateNotification(title: String?, text: String?) {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title ?: "Freedom is protecting you")
            .setContentText(text ?: "Content blocking is active • $blockedCount blocked")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(createOpenAppIntent())
            .build()

        val manager = getSystemService(NotificationManager::class.java)
        manager?.notify(NOTIFICATION_ID, notification)
    }

    private fun createNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Freedom is protecting you")
            .setContentText("Content blocking is active")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(createOpenAppIntent())
            .build()
    }

    /**
     * Create a PendingIntent that opens the app when notification is tapped.
     */
    private fun createOpenAppIntent(): PendingIntent {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            ?: Intent()
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }

        return PendingIntent.getActivity(this, 0, launchIntent, flags)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Freedom Protection",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when Freedom is actively protecting you"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    /**
     * Listen for domain blocked events from VPN service to update counter.
     */
    private fun registerBlockedReceiver() {
        blockedDomainReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                blockedCount++
                // Update notification every 5 blocks to avoid excessive updates
                if (blockedCount % 5 == 0) {
                    updateNotification(null, "Content blocking active • $blockedCount blocked today")
                }
            }
        }
        LocalBroadcastManager.getInstance(this).registerReceiver(
            blockedDomainReceiver!!,
            IntentFilter("expo.modules.freedomvpn.DOMAIN_BLOCKED")
        )
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        isRunning = false
        blockedDomainReceiver?.let {
            LocalBroadcastManager.getInstance(this).unregisterReceiver(it)
        }
        Log.i(TAG, "Foreground service stopped")
        super.onDestroy()
    }
}
