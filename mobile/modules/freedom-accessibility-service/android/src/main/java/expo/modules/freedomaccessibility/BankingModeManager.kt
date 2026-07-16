package expo.modules.freedomaccessibility

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import android.util.Log

/**
 * Time-boxed pause of LibreAscent's own accessibility service so that
 * accessibility-hostile banking apps can run. Only the accessibility service
 * is touched; the VPN/DNS blocklist and device admin stay active.
 */
object BankingModeManager {
    private const val TAG = "BankingMode"
    private const val PREFS = "freedom_settings"
    private const val KEY_UNTIL = "banking_until"
    private const val KEY_SAVED = "banking_saved_services"
    private const val ALARM_REQUEST_CODE = 24603

    const val BANKING_DURATION_MS = 300_000L
    const val ACTION_RESTORE = "expo.modules.freedomaccessibility.BANKING_RESTORE"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun serviceComponent(context: Context): String =
        "${context.packageName}/expo.modules.freedomaccessibility.FreedomAccessibilityService"

    fun hasWriteSecureSettings(context: Context): Boolean =
        context.checkSelfPermission(android.Manifest.permission.WRITE_SECURE_SETTINGS) ==
            PackageManager.PERMISSION_GRANTED

    fun isActive(context: Context): Boolean {
        val until = prefs(context).getLong(KEY_UNTIL, 0L)
        return until > 0L && System.currentTimeMillis() < until
    }

    fun remainingMs(context: Context): Long {
        val until = prefs(context).getLong(KEY_UNTIL, 0L)
        return if (until > 0L) maxOf(0L, until - System.currentTimeMillis()) else 0L
    }

    fun start(context: Context) {
        if (!hasWriteSecureSettings(context)) {
            throw SecurityException("WRITE_SECURE_SETTINGS not granted")
        }
        val resolver = context.contentResolver
        val current = Settings.Secure.getString(
            resolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: ""
        val component = serviceComponent(context)
        val filtered = current.split(":")
            .filter { it.isNotBlank() && it != component }
            .joinToString(":")

        val until = System.currentTimeMillis() + BANKING_DURATION_MS
        prefs(context).edit()
            .putString(KEY_SAVED, current)
            .putLong(KEY_UNTIL, until)
            .commit()

        Settings.Secure.putString(
            resolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, filtered
        )
        scheduleAlarm(context, until)
        Log.i(TAG, "Banking mode started until $until")
    }

    fun restore(context: Context) {
        val saved = prefs(context).getString(KEY_SAVED, null)
        val until = prefs(context).getLong(KEY_UNTIL, 0L)
        // Nothing to restore — avoid rewriting the a11y service list (which would
        // drop the user's other accessibility services) on a spurious/duplicate call.
        if (until == 0L && saved == null) return
        val resolver = context.contentResolver
        val component = serviceComponent(context)
        val target = when {
            saved.isNullOrBlank() -> component
            saved.split(":").any { it == component } -> saved
            else -> "$saved:$component"
        }
        Settings.Secure.putString(
            resolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, target
        )
        Settings.Secure.putInt(resolver, Settings.Secure.ACCESSIBILITY_ENABLED, 1)
        prefs(context).edit().remove(KEY_UNTIL).remove(KEY_SAVED).apply()
        cancelAlarm(context)
        Log.i(TAG, "Banking mode restored")
    }

    /** Restore only if the window has already elapsed (app-launch backstop). */
    fun enforceExpiry(context: Context) {
        val until = prefs(context).getLong(KEY_UNTIL, 0L)
        if (until > 0L && System.currentTimeMillis() >= until) restore(context)
    }

    /** A reboot ends any banking session immediately (boot backstop). */
    fun restoreIfPending(context: Context) {
        if (prefs(context).getLong(KEY_UNTIL, 0L) > 0L) restore(context)
    }

    private fun scheduleAlarm(context: Context, triggerAt: Long) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        // Inexact on purpose: exact alarms need SCHEDULE_EXACT_ALARM on API 31+.
        // A few minutes of Doze slack is fine here; the app-launch and boot
        // backstops restore precisely when the user next opens the app / reboots.
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, alarmIntent(context))
    }

    private fun cancelAlarm(context: Context) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.cancel(alarmIntent(context))
    }

    private fun alarmIntent(context: Context): PendingIntent {
        val intent = Intent(context, BankingRestoreReceiver::class.java)
            .setAction(ACTION_RESTORE)
        return PendingIntent.getBroadcast(
            context,
            ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
