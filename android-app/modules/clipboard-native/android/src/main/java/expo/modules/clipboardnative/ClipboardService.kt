package expo.modules.clipboardnative

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*

class ClipboardService : Service() {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var lastKnownText: String? = null

    override fun onCreate() {
        super.onCreate()
        isRunning = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureNotificationChannel()

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Clipboard Sync")
            .setContentText("Monitoring clipboard...")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .setSilent(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        startPolling()
        return START_STICKY
    }

    private fun startPolling() {
        scope.launch {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            while (isActive) {
                checkClipboard(cm)
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    private fun checkClipboard(cm: ClipboardManager) {
        try {
            val text = cm.primaryClip?.getItemAt(0)?.text?.toString()
            if (!text.isNullOrEmpty() && text != lastKnownText) {
                Log.d(TAG, "Clipboard changed: ${text.length} chars at ${System.currentTimeMillis()}")
                lastKnownText = text
                onClipboardChanged?.invoke(text)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Clipboard read error", e)
        }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        Log.d(TAG, "Task removed - foreground service continues")
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
        isRunning = false
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Clipboard Monitoring",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                setSound(null, null)
                enableVibration(false)
            }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }
    }

    companion object {
        private const val TAG = "ClipboardService"
        private const val CHANNEL_ID = "clipboard_sync"
        private const val NOTIFICATION_ID = 1001
        private const val POLL_INTERVAL_MS = 1000L

        @Volatile var isRunning = false
        @Volatile var onClipboardChanged: ((String) -> Unit)? = null
    }
}
