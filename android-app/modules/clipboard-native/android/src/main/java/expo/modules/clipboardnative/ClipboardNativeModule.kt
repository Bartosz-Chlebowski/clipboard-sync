package expo.modules.clipboardnative

import android.app.AppOpsManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import android.content.pm.PackageManager
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import rikka.shizuku.Shizuku

class ClipboardNativeModule : Module() {
    private val shizukuPermissionRequestCode = 2107

    override fun definition() = ModuleDefinition {
        Name("ClipboardNative")

        Events("clipboardChange", "clipboardReceived", "wsStatus", "discoveryStatus")

        OnCreate {
            // Wire callbacks for when service is already running after process restart
            ClipboardService.onClipboardChanged = { text ->
                sendEvent("clipboardChange", mapOf("text" to text))
            }
            ClipboardService.onWsStatusChanged = { status ->
                sendEvent("wsStatus", mapOf("status" to status))
            }
            ClipboardService.onClipboardReceived = { text ->
                sendEvent("clipboardReceived", mapOf("text" to text))
            }
            ClipboardService.onDiscoveryStatusChanged = { status, url ->
                sendEvent("discoveryStatus", mapOf("status" to status, "url" to url))
            }

            // Emit current WS state immediately so UI syncs on app open
            if (ClipboardService.isRunning) {
                val status = if (ClipboardService.wsConnected) "connected" else "connecting"
                sendEvent("wsStatus", mapOf("status" to status))
            } else {
                sendEvent("wsStatus", mapOf("status" to "disconnected"))
            }
        }

        OnDestroy {
            ClipboardService.onClipboardChanged = null
            ClipboardService.onWsStatusChanged = null
            ClipboardService.onClipboardReceived = null
            ClipboardService.onDiscoveryStatusChanged = null
        }

        AsyncFunction("getClipboardText") {
            appContext.reactContext?.let { ctx ->
                val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.primaryClip?.getItemAt(0)?.text?.toString()
            }
        }

        AsyncFunction("setClipboardText") { text: String ->
            appContext.reactContext?.let { ctx ->
                val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = ClipData.newPlainText("clipboard", text)
                cm.setPrimaryClip(clip)
            }
        }

        AsyncFunction("startClipboardService") { wsUrl: String? ->
            val ctx = appContext.reactContext ?: return@AsyncFunction null

            if (wsUrl != null) {
                ctx.getSharedPreferences(ClipboardService.PREFS_NAME, Context.MODE_PRIVATE)
                    .edit().putString(ClipboardService.PREF_WS_URL, wsUrl).apply()
            }

            val intent = Intent(ctx, ClipboardService::class.java).apply {
                val url = wsUrl
                    ?: ctx.getSharedPreferences(ClipboardService.PREFS_NAME, Context.MODE_PRIVATE)
                        .getString(ClipboardService.PREF_WS_URL, null)
                if (url != null) putExtra(ClipboardService.EXTRA_WS_URL, url)
            }

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(intent)
                } else {
                    ctx.startService(intent)
                }
            } catch (e: Exception) {
                throw Exception("Failed to start service: ${e.message}")
            }
            true
        }

        AsyncFunction("stopClipboardService") {
            appContext.reactContext?.let { ctx ->
                val intent = Intent(ctx, ClipboardService::class.java)
                ctx.stopService(intent)
            }
        }

        AsyncFunction("isServiceRunning") {
            ClipboardService.isRunning
        }

        AsyncFunction("isWsConnected") {
            ClipboardService.wsConnected
        }

        AsyncFunction("discoverMacWsUrl") Coroutine { timeoutMs: Int? ->
            val ctx = appContext.reactContext ?: return@Coroutine null
            withContext(Dispatchers.IO) {
                MacServiceDiscovery.discoverWsUrl(ctx, (timeoutMs ?: 8000).toLong())
            }?.also { url ->
                ctx.getSharedPreferences(ClipboardService.PREFS_NAME, Context.MODE_PRIVATE)
                    .edit().putString(ClipboardService.PREF_WS_URL, url).apply()
            }
        }

        AsyncFunction("sendClipboardNow") { text: String ->
            ClipboardService.triggerSend?.invoke(text)
            ClipboardService.wsConnected
        }

        AsyncFunction("isReadClipboardAllowed") {
            val ctx = appContext.reactContext ?: return@AsyncFunction false
            val appOps = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                appOps.unsafeCheckOpNoThrow(
                    "android:read_clipboard",
                    Process.myUid(),
                    ctx.packageName,
                )
            } else {
                AppOpsManager.MODE_ALLOWED
            }
            mode == AppOpsManager.MODE_ALLOWED
        }

        AsyncFunction("getShizukuStatus") {
            val ctx = appContext.reactContext ?: return@AsyncFunction mapOf(
                "available" to false,
                "permissionGranted" to false,
                "uid" to null,
            )

            val available = try { Shizuku.pingBinder() } catch (_: Throwable) { false }
            val permissionGranted = if (available) {
                try { Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED } catch (_: Throwable) { false }
            } else false
            val uid = if (available && permissionGranted) {
                try { Shizuku.getUid() } catch (_: Throwable) { null }
            } else null

            mapOf(
                "available" to available,
                "permissionGranted" to permissionGranted,
                "uid" to uid,
                "packageName" to ctx.packageName,
            )
        }

        AsyncFunction("requestShizukuPermission") {
            val available = try { Shizuku.pingBinder() } catch (_: Throwable) { false }
            if (!available || Shizuku.isPreV11()) return@AsyncFunction false
            if (Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED) return@AsyncFunction true
            if (Shizuku.shouldShowRequestPermissionRationale()) return@AsyncFunction false
            Shizuku.requestPermission(shizukuPermissionRequestCode)
            false
        }

        AsyncFunction("isIgnoringBatteryOptimizations") {
            appContext.reactContext?.let { ctx ->
                val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
                pm.isIgnoringBatteryOptimizations(ctx.packageName)
            } ?: false
        }

        AsyncFunction("requestBatteryOptimizationExemption") {
            appContext.reactContext?.let { ctx ->
                val intent = Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:${ctx.packageName}"),
                ).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK }
                ctx.startActivity(intent)
            }
        }
    }
}
