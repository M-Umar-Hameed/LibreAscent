package expo.modules.freedomaccessibility

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import android.util.Log

/**
 * Steps the accessibility service aside while a banking app is open: banks
 * refuse to sign in while any accessibility service is on. The tunnel already
 * bypasses them. Device admin stays active.
 */
object BankingModeManager {
    private const val TAG = "BankingMode"
    private const val PREFS = "freedom_settings"
    private const val KEY_UNTIL = "banking_until"
    private const val KEY_SAVED = "banking_saved_services"
    // Read by BankingAppGuard, which restores once this app leaves the foreground.
    private const val KEY_AUTO_PACKAGE = "banking_auto_package"
    private const val ALARM_REQUEST_CODE = 24603

    const val AUTO_MAX_MS = 30 * 60_000L
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

    /**
     * Steps the service aside while [bankPackage] is in front. BankingAppGuard
     * restores it once the user has left the bank, which it can only see with
     * usage access, so without that grant nothing happens.
     */
    fun startAuto(context: Context, bankPackage: String) {
        if (!hasWriteSecureSettings(context) || !hasUsageAccess(context) || isActive(context)) return
        val until = System.currentTimeMillis() + AUTO_MAX_MS
        val resolver = context.contentResolver
        val current = Settings.Secure.getString(
            resolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: ""
        val component = serviceComponent(context)
        val filtered = current.split(":")
            .filter { it.isNotBlank() && it != component }
            .joinToString(":")

        prefs(context).edit()
            .putString(KEY_SAVED, current)
            .putLong(KEY_UNTIL, until)
            .putString(KEY_AUTO_PACKAGE, bankPackage)
            .commit()

        try {
            Settings.Secure.putString(
                resolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, filtered
            )
        } catch (e: SecurityException) {
            prefs(context).edit().remove(KEY_UNTIL).remove(KEY_SAVED).remove(KEY_AUTO_PACKAGE).commit()
            Log.w(TAG, "Banking pause refused: ${e.message}")
            return
        }
        scheduleAlarm(context, until)
        Log.i(TAG, "Banking pause for $bankPackage")
    }

    private fun hasUsageAccess(context: Context): Boolean {
        val ops = context.getSystemService(Context.APP_OPS_SERVICE) as? android.app.AppOpsManager ?: return false
        return ops.unsafeCheckOpNoThrow(
            android.app.AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), context.packageName
        ) == android.app.AppOpsManager.MODE_ALLOWED
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
        // The window closes even if the write fails, so the user can still
        // turn the service back on by hand.
        try {
            Settings.Secure.putString(
                resolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, target
            )
            Settings.Secure.putInt(resolver, Settings.Secure.ACCESSIBILITY_ENABLED, 1)
        } catch (e: SecurityException) {
            Log.w(TAG, "Banking restore could not re-enable the service: ${e.message}")
        }
        prefs(context).edit().remove(KEY_UNTIL).remove(KEY_SAVED).remove(KEY_AUTO_PACKAGE).commit()
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
