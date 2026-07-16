package expo.modules.freedomaccessibility

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Restores the accessibility service when the banking window ends (alarm) or
 * when the device boots with a pending window (a reboot ends the session).
 */
class BankingRestoreReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED -> BankingModeManager.restoreIfPending(context)
            else -> BankingModeManager.restore(context)
        }
    }
}
