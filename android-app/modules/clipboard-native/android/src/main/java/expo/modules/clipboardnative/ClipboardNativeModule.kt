package expo.modules.clipboardnative

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ClipboardNativeModule : Module() {

    override fun definition() = ModuleDefinition {
        Name("ClipboardNative")

        Events("clipboardChange")

        OnCreate {
            // Reconnect callback if service survived a process restart
            if (ClipboardService.isRunning) {
                ClipboardService.onClipboardChanged = { text ->
                    sendEvent("clipboardChange", mapOf("text" to text))
                }
            }
        }

        OnDestroy {
            ClipboardService.onClipboardChanged = null
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

        AsyncFunction("startClipboardService") {
            appContext.reactContext?.let { ctx ->
                ClipboardService.onClipboardChanged = { text ->
                    sendEvent("clipboardChange", mapOf("text" to text))
                }
                val intent = Intent(ctx, ClipboardService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(intent)
                } else {
                    ctx.startService(intent)
                }
            }
        }

        AsyncFunction("stopClipboardService") {
            appContext.reactContext?.let { ctx ->
                ClipboardService.onClipboardChanged = null
                val intent = Intent(ctx, ClipboardService::class.java)
                ctx.stopService(intent)
            }
        }

        AsyncFunction("isServiceRunning") {
            ClipboardService.isRunning
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
                )
                intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                ctx.startActivity(intent)
            }
        }
    }
}
