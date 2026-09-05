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
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager

/**
 * Freedom Foreground Service — Keeps the app alive via persistent notification.
 *
 * Features:
 * - Persistent "LibreAscent is protecting you" notification
 * - Dynamic notification text updates (blocked count)
 * - Tapping notification opens the app
 * - Listens for domain blocked events to update counter
 * - START_STICKY for automatic restart by Android
 */
class FreedomForegroundService : Service() {

    private var blockedDomainReceiver: BroadcastReceiver? = null
    private var blockedCount: Int = 0
    private var cachedOpenAppIntent: PendingIntent? = null
    private var lastBlockedNotifyAt: Long = 0
    private var pendingNotify = false
    private val notifyHandler = Handler(Looper.getMainLooper())

    private val trailingNotify = Runnable {
        pendingNotify = false
        updateBlockedNotification()
    }

    private fun updateBlockedNotification() {
        lastBlockedNotifyAt = SystemClock.elapsedRealtime()
        updateNotification(null, "Content blocking active • $blockedCount blocked today")
    }

    companion object {
        private const val TAG = "FreedomForeground"
        private const val BLOCKED_NOTIFY_INTERVAL_MS = 30_000L
        const val CHANNEL_ID = "freedom_protection"
        const val NOTIFICATION_ID = 1001
        const val ACTION_UPDATE_NOTIFICATION = "expo.modules.freedomforeground.UPDATE"
        const val EXTRA_TITLE = "title"
        const val EXTRA_TEXT = "text"

        @Volatile
        var isRunning: Boolean = false
            private set
    }

    private val bankingGuard by lazy { BankingAppGuard(this) }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        registerBlockedReceiver()
        // Blocked apps are otherwise unguarded while banking mode has the
        // accessibility service switched off. Hosted here so it survives that
        // service being destroyed and the app process being swiped away.
        bankingGuard.start()
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
            .setContentTitle(title ?: "LibreAscent is protecting you")
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
            .setContentTitle("LibreAscent is protecting you")
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
        cachedOpenAppIntent?.let { return it }

        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            ?: Intent()
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }

        return PendingIntent.getActivity(this, 0, launchIntent, flags)
            .also { cachedOpenAppIntent = it }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "LibreAscent Protection",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when LibreAscent is actively protecting you"
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
                // Rate-limit rebuilds: a burst of blocks is one update now plus a
                // trailing one at the interval boundary, so the count is never left stale.
                val elapsed = SystemClock.elapsedRealtime() - lastBlockedNotifyAt
                if (elapsed >= BLOCKED_NOTIFY_INTERVAL_MS) {
                    updateBlockedNotification()
                } else if (!pendingNotify) {
                    pendingNotify = true
                    notifyHandler.postDelayed(
                        trailingNotify,
                        BLOCKED_NOTIFY_INTERVAL_MS - elapsed
                    )
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
        bankingGuard.stop()
        notifyHandler.removeCallbacks(trailingNotify)
        blockedDomainReceiver?.let {
            LocalBroadcastManager.getInstance(this).unregisterReceiver(it)
        }
        Log.i(TAG, "Foreground service stopped")
        super.onDestroy()
    }
}
