package expo.modules.freedomoverlay

import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.os.Build
import android.os.IBinder
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.localbroadcastmanager.content.LocalBroadcastManager

/**
 * Overlay Service — Draws a full-screen "Stay Away" overlay.
 *
 * This is Layer 4 of the content blocking architecture.
 * When the VPN or Accessibility Service detects blocked content,
 * this service draws an opaque overlay covering the entire screen.
 *
 * The overlay:
 * - Covers status bar and navigation bar
 * - Cannot be dismissed by Back/Home/Recent buttons
 * - Shows a motivational "Stay Away" message
 * - Auto-hides when the Accessibility Service confirms safe navigation
 */
class OverlayService : Service() {

    private var windowManager: WindowManager? = null
    private var overlayView: FrameLayout? = null
    private var isOverlayShowing = false
    private var currentMessage: String = "This content is blocked"
    private var lastShowTime: Long = 0
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())

    private var urlBlockedReceiver: BroadcastReceiver? = null
    private var reelsDetectedReceiver: BroadcastReceiver? = null

    companion object {
        private const val TAG = "FreedomOverlay"
        private const val MIN_DISPLAY_MS = 5000L // Overlay stays for at least 5 seconds
        const val EXTRA_MESSAGE = "message"
        const val ACTION_SHOW = "expo.modules.freedomoverlay.SHOW"
        const val ACTION_HIDE = "expo.modules.freedomoverlay.HIDE"

        @Volatile
        var isShowing: Boolean = false
            private set
    }

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        registerBlockingReceivers()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action

        when (action) {
            ACTION_SHOW -> {
                val message = intent.getStringExtra(EXTRA_MESSAGE)
                showOverlay(message)
            }
            ACTION_HIDE -> {
                hideOverlay()
            }
            else -> {
                // Default: show overlay
                val message = intent?.getStringExtra(EXTRA_MESSAGE)
                showOverlay(message)
            }
        }

        return START_NOT_STICKY
    }

    /**
     * Show the full-screen overlay.
     */
    private fun showOverlay(message: String?) {
        if (isOverlayShowing) {
            // Update message if overlay is already showing
            if (message != null) {
                currentMessage = message
                updateOverlayMessage()
            }
            return
        }

        if (message != null) {
            currentMessage = message
        }

        try {
            val params = createLayoutParams()
            overlayView = createOverlayView()
            windowManager?.addView(overlayView, params)
            isOverlayShowing = true
            isShowing = true
            lastShowTime = System.currentTimeMillis()
            Log.i(TAG, "Overlay shown: $currentMessage")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to show overlay", e)
        }
    }

    /**
     * Hide the overlay. Enforces a minimum display time so the overlay
     * isn't immediately dismissed by app-switch events caused by our own blocking.
     */
    private fun hideOverlay() {
        if (!isOverlayShowing) return

        val elapsed = System.currentTimeMillis() - lastShowTime
        if (elapsed < MIN_DISPLAY_MS) {
            // Defer the hide until minimum time has passed
            handler.postDelayed({ hideOverlayNow() }, MIN_DISPLAY_MS - elapsed)
            Log.d(TAG, "Deferring overlay hide for ${MIN_DISPLAY_MS - elapsed}ms")
            return
        }

        hideOverlayNow()
    }

    private fun hideOverlayNow() {
        if (!isOverlayShowing) return

        try {
            overlayView?.let { windowManager?.removeView(it) }
        } catch (e: Exception) {
            Log.w(TAG, "Error removing overlay view", e)
        }

        overlayView = null
        isOverlayShowing = false
        isShowing = false
        Log.i(TAG, "Overlay hidden")
    }

    /**
     * Update the message text on an existing overlay.
     */
    private fun updateOverlayMessage() {
        overlayView?.let { view ->
            val textView = view.findViewWithTag<TextView>("messageText")
            textView?.text = currentMessage
        }
    }

    /**
     * Create WindowManager layout params for full-screen overlay.
     */
    private fun createLayoutParams(): WindowManager.LayoutParams {
        val overlayType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
        }

        return WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            overlayType,
            // Cover everything, no touch passthrough, no focus steal for dismiss
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.CENTER
            // Cover status bar and nav bar
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
    }

    /**
     * Create the overlay view programmatically.
     * Dark semi-transparent background with centered "Stay Away" message.
     */
    private fun createOverlayView(): FrameLayout {
        val container = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#F0121212")) // Near-opaque dark
            isClickable = true // Absorb all touches
        }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(40), dp(60), dp(40), dp(60))
        }

        // Shield icon (emoji)
        val iconText = TextView(this).apply {
            text = "🛡️"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 72f)
            gravity = Gravity.CENTER
        }

        // Title
        val titleText = TextView(this).apply {
            text = "Stay Away"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 36f)
            typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
            gravity = Gravity.CENTER
            setPadding(0, dp(24), 0, dp(12))
        }

        // Message
        val messageText = TextView(this).apply {
            text = currentMessage
            tag = "messageText"
            setTextColor(Color.parseColor("#B0B0B0"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(32))
        }

        // Motivational quote
        val quoteText = TextView(this).apply {
            text = "\"Every moment of resistance makes you stronger.\""
            setTextColor(Color.parseColor("#808080"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            typeface = Typeface.create("sans-serif", Typeface.ITALIC)
            gravity = Gravity.CENTER
            setPadding(dp(20), 0, dp(20), dp(40))
        }

        // Dismiss Button
        val dismissButton = android.widget.Button(this).apply {
            text = "I Understand"
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#E94560")) // Freedom accent color
            setPadding(dp(24), dp(12), dp(24), dp(12))
            isAllCaps = false
            textSize = 16f
            setOnClickListener {
                hideOverlay()
            }
        }

        val buttonParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            topMargin = dp(24)
            gravity = Gravity.CENTER
        }

        content.addView(iconText)
        content.addView(titleText)
        content.addView(messageText)
        content.addView(quoteText)
        content.addView(dismissButton, buttonParams)

        val contentParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.CENTER
        }

        container.addView(content, contentParams)

        return container
    }

    /**
     * Register receivers to auto-show overlay when blocking events arrive.
     */
    private fun registerBlockingReceivers() {
        val lbm = LocalBroadcastManager.getInstance(this)

        // Listen for URL blocked events from Accessibility Service
        urlBlockedReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val url = intent?.getStringExtra("url") ?: "Blocked content"
                val domain = intent?.getStringExtra("domain") ?: ""
                showOverlay("$domain is blocked")
            }
        }
        lbm.registerReceiver(
            urlBlockedReceiver!!,
            IntentFilter("expo.modules.freedomaccessibility.URL_BLOCKED")
        )

        // Listen for reels detection events
        reelsDetectedReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val isInReels = intent?.getBooleanExtra("is_in_reels", false) ?: false
                val appName = intent?.getStringExtra("app_name") ?: "App"

                if (isInReels) {
                    showOverlay("$appName Reels/Shorts blocked")
                } else {
                    hideOverlay()
                }
            }
        }
        lbm.registerReceiver(
            reelsDetectedReceiver!!,
            IntentFilter("expo.modules.freedomaccessibility.REELS_DETECTED")
        )
    }

    private fun unregisterBlockingReceivers() {
        val lbm = LocalBroadcastManager.getInstance(this)
        urlBlockedReceiver?.let { lbm.unregisterReceiver(it) }
        reelsDetectedReceiver?.let { lbm.unregisterReceiver(it) }
    }

    /**
     * Convert dp to pixels.
     */
    private fun dp(dp: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            dp.toFloat(),
            resources.displayMetrics
        ).toInt()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        hideOverlay()
        unregisterBlockingReceivers()
        super.onDestroy()
    }
}
