package expo.modules.clipboardnative

import android.content.ComponentName
import android.content.Context
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.IBinder
import android.os.Parcel
import android.util.Log
import rikka.shizuku.Shizuku
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

object ShizukuClipboardBridge {
    private const val TAG = "ShizukuClipboardBridge"
    private const val BIND_TIMEOUT_MS = 2500L

    @Volatile private var remote: IBinder? = null
    @Volatile private var binding = false

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, service: IBinder) {
            Log.d(TAG, "Shizuku clipboard service connected")
            remote = service
            binding = false
        }

        override fun onServiceDisconnected(name: ComponentName) {
            Log.d(TAG, "Shizuku clipboard service disconnected")
            remote = null
            binding = false
        }
    }

    fun isReady(): Boolean {
        return hasPermission() && remote?.isBinderAlive == true
    }

    fun readClipboard(context: Context): String? {
        if (!hasPermission()) {
            Log.w(TAG, "Shizuku is not ready or permission is missing")
            return null
        }

        val binder = remote?.takeIf { it.isBinderAlive } ?: bind(context) ?: return null
        val data = Parcel.obtain()
        val reply = Parcel.obtain()
        return try {
            binder.transact(ShizukuClipboardUserService.TRANSACTION_READ_CLIPBOARD, data, reply, 0)
            reply.readException()
            reply.readString()
        } catch (e: Throwable) {
            Log.e(TAG, "Shizuku clipboard transact failed", e)
            remote = null
            null
        } finally {
            data.recycle()
            reply.recycle()
        }
    }

    private fun bind(context: Context): IBinder? {
        if (binding) {
            Log.d(TAG, "Shizuku clipboard service bind already in progress")
            return null
        }
        binding = true

        val latch = CountDownLatch(1)
        val oneShotConnection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName, service: IBinder) {
                connection.onServiceConnected(name, service)
                latch.countDown()
            }

            override fun onServiceDisconnected(name: ComponentName) {
                connection.onServiceDisconnected(name)
            }
        }

        return try {
            Log.d(TAG, "Binding Shizuku clipboard service")
            val component = ComponentName(context.packageName, ShizukuClipboardUserService::class.java.name)
            val args = Shizuku.UserServiceArgs(component)
                .daemon(false)
                .debuggable(true)
                .processNameSuffix("clipboard")
                .tag("clipboard")
                .version(1)
            Shizuku.bindUserService(args, oneShotConnection)
            val connected = latch.await(BIND_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            Log.d(TAG, "Shizuku clipboard service bind result: connected=$connected")
            remote?.takeIf { it.isBinderAlive }
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to bind Shizuku clipboard service", e)
            null
        } finally {
            binding = false
        }
    }

    private fun hasPermission(): Boolean {
        return try {
            val ping = Shizuku.pingBinder()
            val permission = if (ping) Shizuku.checkSelfPermission() else PackageManager.PERMISSION_DENIED
            Log.d(TAG, "Shizuku status: ping=$ping permission=$permission uid=${if (ping) Shizuku.getUid() else null}")
            ping && permission == PackageManager.PERMISSION_GRANTED
        } catch (e: Throwable) {
            Log.e(TAG, "Shizuku permission check failed", e)
            false
        }
    }
}
