package expo.modules.freedomoverlay

import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.net.Uri
import android.widget.ImageView
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

    private fun loadThemeFromPrefs(): org.json.JSONObject {
        val prefs = getSharedPreferences("freedom_settings", MODE_PRIVATE)
        val json = prefs.getString("overlay_theme", null)
        return if (json != null) {
            try { org.json.JSONObject(json) } catch (_: Exception) { org.json.JSONObject() }
        } else org.json.JSONObject()
    }

    /**
     * Create the overlay view programmatically.
     * Reads theme colors and texts from SharedPreferences.
     */
    private fun createOverlayView(): FrameLayout {
        val theme = loadThemeFromPrefs()
        val bgColor = theme.optString("bgColor", "#0B1215")
        val accentColor = theme.optString("accentColor", "#2DD4BF")
        val textColor = theme.optString("textColor", "#FFFFFF")
        val mutedTextColor = theme.optString("mutedTextColor", "#CBD5E1")
        val cardBgColor = theme.optString("cardBgColor", "#1A2421")
        val titleStr = theme.optString("title", "Blocked!")
        val subtitleStr = theme.optString("subtitle", "Stay Sharp - Stay Disciplined")
        val headingStr = theme.optString("heading", "You are on a mission to build a better future!")
        val bodyStr = theme.optString("body", "Giving in to cheap dopamine is not an option. Back away right now, get back to the grind, and crush your goals today!")

        val customImagePath = theme.optString("customImagePath", "")

        val container = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor(bgColor))
            isClickable = true
        }

        // Background image + scrim
        if (customImagePath.isNotEmpty()) {
            try {
                val uri = Uri.parse(customImagePath)
                val stream = contentResolver.openInputStream(uri)
                val bitmap = BitmapFactory.decodeStream(stream)
                stream?.close()
                if (bitmap != null) {
                    val bgImage = ImageView(this).apply {
                        setImageBitmap(bitmap)
                        scaleType = ImageView.ScaleType.CENTER_CROP
                        layoutParams = FrameLayout.LayoutParams(
                            FrameLayout.LayoutParams.MATCH_PARENT,
                            FrameLayout.LayoutParams.MATCH_PARENT
                        )
                    }
                    container.addView(bgImage)
                    // 40% dark scrim over the image
                    val scrim = android.view.View(this).apply {
                        setBackgroundColor(Color.parseColor("#66000000"))
                        layoutParams = FrameLayout.LayoutParams(
                            FrameLayout.LayoutParams.MATCH_PARENT,
                            FrameLayout.LayoutParams.MATCH_PARENT
                        )
                    }
                    container.addView(scrim)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to load overlay background image: ${e.message}")
            }
        }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(60), dp(24), dp(60))
        }

        // Accent circle with icon
        val iconRing = FrameLayout(this).apply {
            val size = dp(128)
            layoutParams = LinearLayout.LayoutParams(size, size).apply { gravity = Gravity.CENTER; bottomMargin = dp(24) }
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(Color.parseColor(accentColor) and 0x1AFFFFFF or 0x1A000000)
                setStroke(dp(3), Color.parseColor(accentColor) and 0x80FFFFFF.toInt() or -0x80000000)
            }
        }
        val iconInner = TextView(this).apply {
            text = "\u26A1"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 56f)
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
                Gravity.CENTER
            )
        }
        iconRing.addView(iconInner)

        // Title
        val titleText = TextView(this).apply {
            text = titleStr
            setTextColor(Color.parseColor(textColor))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 40f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            isAllCaps = true
            letterSpacing = 0.15f
            setPadding(0, 0, 0, dp(4))
        }

        // Subtitle
        val subtitleText = TextView(this).apply {
            text = subtitleStr
            setTextColor(Color.parseColor(accentColor))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            isAllCaps = true
            letterSpacing = 0.12f
            setPadding(0, 0, 0, dp(32))
        }

        // Card
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor(cardBgColor))
                cornerRadius = dp(16).toFloat()
            }
            background = bg
            setPadding(dp(24), dp(20), dp(24), dp(20))
        }

        // Card accent top bar
        val accentBar = android.view.View(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(4)).apply {
                bottomMargin = dp(16)
            }
            setBackgroundColor(Color.parseColor(accentColor))
        }

        val cardHeading = TextView(this).apply {
            text = headingStr
            tag = "messageText"
            setTextColor(Color.parseColor(textColor))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(8))
        }

        val cardBody = TextView(this).apply {
            text = bodyStr
            setTextColor(Color.parseColor(mutedTextColor))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 0)
        }

        card.addView(accentBar)
        card.addView(cardHeading)
        card.addView(cardBody)

        val cardParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )

        // Footer pill
        val footer = TextView(this).apply {
            text = "Return to safety to dismiss"
            setTextColor(Color.parseColor(mutedTextColor))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            typeface = Typeface.DEFAULT_BOLD
            isAllCaps = true
            letterSpacing = 0.1f
            gravity = Gravity.CENTER
            val bg = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor(cardBgColor) and 0xCCFFFFFF.toInt() or 0x00000000)
                cornerRadius = dp(20).toFloat()
            }
            background = bg
            setPadding(dp(24), dp(12), dp(24), dp(12))
        }
        val footerParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            topMargin = dp(48)
            gravity = Gravity.CENTER
        }

        content.addView(iconRing)
        content.addView(titleText)
        content.addView(subtitleText)
        content.addView(card, cardParams)
        content.addView(footer, footerParams)

        val contentParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
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
