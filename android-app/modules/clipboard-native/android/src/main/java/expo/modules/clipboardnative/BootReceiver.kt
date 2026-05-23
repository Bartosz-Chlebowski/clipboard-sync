package expo.modules.clipboardnative

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != "android.intent.action.QUICKBOOT_POWERON") return

        val prefs = context.getSharedPreferences(ClipboardService.PREFS_NAME, Context.MODE_PRIVATE)
        val wsUrl = prefs.getString(ClipboardService.PREF_WS_URL, null) ?: run {
            Log.d("BootReceiver", "No WS URL saved; skipping auto-start")
            return
        }

        // Android 15+ blocks BOOT_COMPLETED receivers from launching dataSync
        // foreground services for apps targeting API 35+. Treat boot restore as
        // best effort and let the user start Auto sync from the app if blocked.
        if (Build.VERSION.SDK_INT >= 35) {
            Log.w("BootReceiver", "Skipping boot auto-start on Android 15+; dataSync foreground service boot starts are restricted")
            return
        }

        Log.d("BootReceiver", "Boot completed; starting ClipboardService")
        val serviceIntent = Intent(context, ClipboardService::class.java).apply {
            putExtra(ClipboardService.EXTRA_WS_URL, wsUrl)
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
        } catch (e: IllegalStateException) {
            Log.w("BootReceiver", "Foreground service auto-start was blocked by the system", e)
        } catch (e: SecurityException) {
            Log.w("BootReceiver", "Foreground service auto-start is missing a required permission or app-op", e)
        }
    }
}
