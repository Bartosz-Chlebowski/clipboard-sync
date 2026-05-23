package expo.modules.clipboardnative

import android.content.ClipData
import android.content.Context
import android.os.Binder
import android.os.IBinder
import android.os.Parcel
import android.util.Log

class ShizukuClipboardUserService() : Binder() {
    private var context: Context? = null

    constructor(context: Context) : this() {
        this.context = context
    }

    override fun onTransact(code: Int, data: Parcel, reply: Parcel?, flags: Int): Boolean {
        if (code == TRANSACTION_READ_CLIPBOARD) {
            val text = readClipboardText()
            reply?.writeNoException()
            reply?.writeString(text)
            return true
        }
        return super.onTransact(code, data, reply, flags)
    }

    private fun readClipboardText(): String? {
        return readViaIClipboard()
    }

    private fun readViaIClipboard(): String? {
        return try {
            val serviceManager = Class.forName("android.os.ServiceManager")
            val rawBinder = serviceManager
                .getMethod("getService", String::class.java)
                .invoke(null, "clipboard") as IBinder
            val stub = Class.forName("android.content.IClipboard\$Stub")
            val clipboard = stub
                .getMethod("asInterface", IBinder::class.java)
                .invoke(null, rawBinder)
            val method = clipboard.javaClass.methods.firstOrNull {
                it.name == "getPrimaryClip" && it.returnType == ClipData::class.java
            } ?: clipboard.javaClass.methods.firstOrNull { it.name == "getPrimaryClip" }
                ?: return null
            Log.d(TAG, "Using IClipboard.${method.name}(${method.parameterTypes.joinToString { it.simpleName }})")
            val args = method.parameterTypes.map { argumentFor(it) }.toTypedArray()
            val clip = method.invoke(clipboard, *args) as? ClipData
            val item = clip?.getItemAt(0) ?: return null
            val text = item.text?.toString() ?: context?.let { item.coerceToText(it)?.toString() }
            Log.d(TAG, "IClipboard read result: ${text?.length ?: 0} chars")
            text
        } catch (e: Throwable) {
            Log.e(TAG, "IClipboard read failed", e)
            null
        }
    }

    private fun argumentFor(type: Class<*>): Any? {
        return when {
            type == String::class.java -> "com.android.shell"
            type == Integer.TYPE -> 0
            type == java.lang.Boolean.TYPE -> false
            type == java.lang.Long.TYPE -> 0L
            type.name == "android.content.AttributionSource" -> createAttributionSource()
            else -> null
        }
    }

    private fun createAttributionSource(): Any? {
        return try {
            val builderClass = Class.forName("android.content.AttributionSource\$Builder")
            val builder = builderClass
                .getConstructor(Integer.TYPE)
                .newInstance(2000)
            builderClass
                .getMethod("setPackageName", String::class.java)
                .invoke(builder, "com.android.shell")
            builderClass.getMethod("build").invoke(builder)
        } catch (e: Throwable) {
            Log.d(TAG, "AttributionSource creation failed", e)
            null
        }
    }

    companion object {
        private const val TAG = "ShizukuClipboardUserService"
        const val TRANSACTION_READ_CLIPBOARD = IBinder.FIRST_CALL_TRANSACTION
    }
}
