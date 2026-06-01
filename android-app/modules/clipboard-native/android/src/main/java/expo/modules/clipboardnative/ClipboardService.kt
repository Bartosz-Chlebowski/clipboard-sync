package expo.modules.clipboardnative

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.*
import okhttp3.*
import okio.ByteString
import org.json.JSONObject
import java.security.SecureRandom
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyFactory
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class ClipboardService : Service() {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var pollingJob: Job? = null
    private var lastKnownText: String? = null

    // Native WebSocket
    private var httpClient: OkHttpClient? = null
    private var webSocket: WebSocket? = null
    private var reconnectJob: Job? = null
    private var discoveryJob: Job? = null
    private var reconnectDelayMs = RECONNECT_BASE_MS
    private var discoverBeforeNextConnect = false
    private var keyPair: KeyPair? = null
    private var sessionKey: SecretKeySpec? = null

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        triggerSend = { text -> sendClipboardToMac(text) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Read URL from intent; fall back to saved value
        val urlFromIntent = intent?.getStringExtra(EXTRA_WS_URL)
        if (urlFromIntent != null) {
            currentWsUrl = urlFromIntent
            getPrefs().edit().putString(PREF_WS_URL, urlFromIntent).apply()
        } else if (currentWsUrl == null) {
            currentWsUrl = getPrefs().getString(PREF_WS_URL, null)
        }
        discoverBeforeNextConnect = currentWsUrl.isNullOrBlank()

        ensureNotificationChannel()
        updateNotification()
        startPolling()
        connectWebSocket()
        return START_STICKY
    }

    // MARK: - Polling

    private fun startPolling() {
        if (pollingJob?.isActive == true) return
        pollingJob = scope.launch(Dispatchers.IO) {
            while (isActive) {
                checkClipboard()
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    private fun checkClipboard() {
        try {
            val text = ShizukuClipboardBridge.readClipboard(this) ?: return
            if (text.isEmpty() || text == lastKnownText) return
            Log.d(TAG, "Clipboard changed: ${text.length} chars")
            lastKnownText = text
            emitClipboardChanged(text)
            sendClipboardToMac(text)
        } catch (e: Exception) {
            Log.e(TAG, "Clipboard read error", e)
        }
    }

    // MARK: - WebSocket

    private fun connectWebSocket() {
        val url = currentWsUrl
        if (url.isNullOrBlank() || discoverBeforeNextConnect) {
            discoverAndConnect(url)
            return
        }

        openWebSocket(url)
    }

    private fun discoverAndConnect(fallbackUrl: String?) {
        discoveryJob?.cancel()
        reconnectJob?.cancel()
        webSocket?.close(1000, "discovering")
        webSocket = null
        wsConnected = false
        sessionKey = null

        emitWsStatus("connecting")
        emitDiscoveryStatus("searching", null)
        Log.d(TAG, "Discovering Mac service")

        discoveryJob = scope.launch(Dispatchers.IO) {
            val discoveredUrl = MacServiceDiscovery.discoverWsUrl(this@ClipboardService)
            withContext(Dispatchers.Main) {
                discoverBeforeNextConnect = false
                val nextUrl = discoveredUrl ?: fallbackUrl

                if (discoveredUrl != null) {
                    currentWsUrl = discoveredUrl
                    getPrefs().edit().putString(PREF_WS_URL, discoveredUrl).apply()
                    emitDiscoveryStatus("found", discoveredUrl)
                    updateNotification()
                } else {
                    emitDiscoveryStatus("not_found", null)
                }

                if (nextUrl.isNullOrBlank()) {
                    emitWsStatus("reconnecting")
                    scheduleReconnect(discoverFirst = true)
                    return@withContext
                }

                openWebSocket(nextUrl)
            }
        }
    }

    private fun openWebSocket(url: String) {
        reconnectJob?.cancel()
        webSocket?.close(1000, "reconnecting")
        webSocket = null
        wsConnected = false
        sessionKey = null
        keyPair = generateKeyPair()

        if (httpClient == null) {
            httpClient = OkHttpClient.Builder()
                .pingInterval(20, TimeUnit.SECONDS)
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(0, TimeUnit.SECONDS)
                .build()
        }

        emitWsStatus("connecting")
        Log.d(TAG, "WS connecting to $url")

        val request = Request.Builder().url(url).build()
        webSocket = httpClient!!.newWebSocket(request, object : WebSocketListener() {

            override fun onOpen(ws: WebSocket, response: Response) {
                reconnectDelayMs = RECONNECT_BASE_MS
                val publicKey = keyPair?.public?.encoded
                if (publicKey == null) {
                    ws.close(1011, "key exchange unavailable")
                    return
                }
                ws.send(JSONObject().apply {
                    put("type", "key_exchange")
                    put("version", 1)
                    put("alg", "P-256-ECDH+HKDF-SHA256")
                    put("publicKey", Base64.encodeToString(publicKey, Base64.NO_WRAP))
                }.toString())
                Log.d(TAG, "WS opened, key exchange sent")
            }

            override fun onMessage(ws: WebSocket, text: String) = handleMessage(text)
            override fun onMessage(ws: WebSocket, bytes: ByteString) = handleMessage(bytes.utf8())

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WS failure: ${t.message}")
                wsConnected = false
                emitWsStatus("reconnecting")
                scheduleReconnect(discoverFirst = true)
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WS closed $code")
                wsConnected = false
                if (code != 1000) {
                    emitWsStatus("reconnecting")
                    scheduleReconnect(discoverFirst = true)
                } else {
                    emitWsStatus("disconnected")
                }
            }
        })
    }

    private fun handleMessage(raw: String) {
        try {
            val wireJson = JSONObject(raw)
            if (wireJson.optString("type") == "key_exchange_ack") {
                handleKeyExchangeAck(wireJson)
                return
            }

            val json = when (wireJson.optString("type")) {
                "encrypted" -> decryptEnvelope(wireJson)
                else -> null
            } ?: run {
                Log.w(TAG, "Rejected unencrypted or invalid WS message")
                return
            }

            when (json.optString("type")) {
                "hello_ack" -> {
                    wsConnected = true
                    emitWsStatus("connected")
                    Log.d(TAG, "WS connected (hello_ack)")
                }
                "ping" -> {
                    sendEncrypted(JSONObject().apply {
                        put("type", "pong")
                        put("timestamp", json.optLong("timestamp"))
                    })
                }
                "clipboard_update" -> {
                    val text = json.optString("text")
                    if (text.isNotEmpty()) {
                        Log.d(TAG, "Received encrypted clipboard from Mac: ${text.length} chars")
                        lastKnownText = text  // prevent echo
                        setLocalClipboard(text)
                        emitClipboardReceived(text)
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Message parse error", e)
        }
    }

    private fun handleKeyExchangeAck(json: JSONObject) {
        val remotePublicKey = json.optString("publicKey", "")
        if (remotePublicKey.isBlank()) {
            Log.w(TAG, "Invalid key exchange ack")
            webSocket?.close(1002, "invalid key exchange")
            return
        }

        try {
            sessionKey = deriveSessionKey(remotePublicKey)
            Log.d(TAG, "WS session key established")
            sendEncrypted(JSONObject().apply {
                put("type", "hello")
                put("sourceDeviceId", readDeviceId())
                put("deviceName", getPrefs().getString(PREF_DEVICE_NAME, DEFAULT_DEVICE_NAME))
                put("protocolVersion", 1)
            })
        } catch (e: Exception) {
            Log.e(TAG, "Key exchange failed", e)
            webSocket?.close(1011, "key exchange failed")
        }
    }

    private fun setLocalClipboard(text: String) {
        try {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("clipboard", text))
        } catch (e: Exception) {
            Log.e(TAG, "Set clipboard failed", e)
        }
    }

    private fun emitClipboardChanged(text: String) {
        onClipboardChanged?.invoke(text)
        sendServiceEvent(ACTION_CLIPBOARD_CHANGE) {
            putExtra(EXTRA_TEXT, text)
        }
    }

    private fun emitClipboardReceived(text: String) {
        onClipboardReceived?.invoke(text)
        sendServiceEvent(ACTION_CLIPBOARD_RECEIVED) {
            putExtra(EXTRA_TEXT, text)
        }
    }

    private fun emitWsStatus(status: String) {
        onWsStatusChanged?.invoke(status)
        sendServiceEvent(ACTION_WS_STATUS) {
            putExtra(EXTRA_STATUS, status)
        }
    }

    private fun emitDiscoveryStatus(status: String, url: String?) {
        onDiscoveryStatusChanged?.invoke(status, url)
        sendServiceEvent(ACTION_DISCOVERY_STATUS) {
            putExtra(EXTRA_STATUS, status)
            putExtra(EXTRA_URL, url)
        }
    }

    private fun sendServiceEvent(action: String, extras: Intent.() -> Unit) {
        sendBroadcast(Intent(action).apply {
            setPackage(packageName)
            extras()
        })
    }

    fun sendClipboardNow(text: String): Boolean {
        if (!wsConnected) return false
        sendClipboardToMac(text)
        return true
    }

    private fun sendClipboardToMac(text: String) {
        if (!wsConnected) return
        try {
            sendEncrypted(JSONObject().apply {
                put("type", "clipboard_update")
                put("eventId", UUID.randomUUID().toString())
                put("sourceDeviceId", readDeviceId())
                put("source", "android")
                put("text", text)
                put("timestamp", System.currentTimeMillis())
            })
        } catch (e: Exception) {
            Log.e(TAG, "WS send error", e)
        }
    }

    private fun scheduleReconnect(discoverFirst: Boolean = false) {
        reconnectJob?.cancel()
        discoverBeforeNextConnect = discoverBeforeNextConnect || discoverFirst
        val delay = reconnectDelayMs
        reconnectDelayMs = minOf(delay * 2, RECONNECT_MAX_MS)
        reconnectJob = scope.launch {
            delay(delay)
            if (isActive) connectWebSocket()
        }
    }

    private fun readDeviceId(): String =
        getPrefs().getString(PREF_DEVICE_ID, DEFAULT_DEVICE_ID) ?: DEFAULT_DEVICE_ID

    private fun getPrefs() = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun sendEncrypted(message: JSONObject): Boolean {
        val ws = webSocket ?: return false
        return sendEncrypted(ws, message)
    }

    private fun sendEncrypted(ws: WebSocket, message: JSONObject): Boolean {
        val key = sessionKey ?: return false
        val envelope = encryptEnvelope(message, key)
        return ws.send(envelope.toString())
    }

    private fun encryptEnvelope(message: JSONObject, key: SecretKeySpec): JSONObject {
        val nonce = ByteArray(GCM_NONCE_BYTES)
        SecureRandom().nextBytes(nonce)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, nonce))
        val encrypted = cipher.doFinal(message.toString().toByteArray(Charsets.UTF_8))
        val combined = nonce + encrypted

        return JSONObject().apply {
            put("type", "encrypted")
            put("version", 1)
            put("alg", "AES-256-GCM")
            put("payload", Base64.encodeToString(combined, Base64.NO_WRAP))
        }
    }

    private fun decryptEnvelope(envelope: JSONObject): JSONObject? {
        val key = sessionKey ?: return null
        val payload = envelope.optString("payload", "")
        val combined = try {
            Base64.decode(payload, Base64.NO_WRAP)
        } catch (_: IllegalArgumentException) {
            return null
        }
        if (combined.size <= GCM_NONCE_BYTES + GCM_TAG_BYTES) return null

        val nonce = combined.copyOfRange(0, GCM_NONCE_BYTES)
        val encrypted = combined.copyOfRange(GCM_NONCE_BYTES, combined.size)

        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, nonce))
            val plain = cipher.doFinal(encrypted)
            JSONObject(String(plain, Charsets.UTF_8))
        } catch (e: Exception) {
            Log.w(TAG, "Encrypted WS message failed authentication")
            null
        }
    }

    private fun generateKeyPair(): KeyPair {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"))
        return generator.generateKeyPair()
    }

    private fun deriveSessionKey(remotePublicKeyBase64: String): SecretKeySpec {
        val localKeyPair = keyPair ?: throw IllegalStateException("Local key pair missing")
        val remotePublicKeyBytes = Base64.decode(remotePublicKeyBase64, Base64.NO_WRAP)
        val remotePublicKey = KeyFactory.getInstance("EC")
            .generatePublic(X509EncodedKeySpec(remotePublicKeyBytes))
        val agreement = KeyAgreement.getInstance("ECDH")
        agreement.init(localKeyPair.private)
        agreement.doPhase(remotePublicKey, true)
        val sharedSecret = agreement.generateSecret()
        return SecretKeySpec(hkdfSha256(sharedSecret, SESSION_SALT, ByteArray(0), 32), "AES")
    }

    private fun hkdfSha256(inputKeyMaterial: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(salt, "HmacSHA256"))
        val pseudorandomKey = mac.doFinal(inputKeyMaterial)

        var previous = ByteArray(0)
        val output = ArrayList<Byte>(length)
        var counter = 1
        while (output.size < length) {
            mac.init(SecretKeySpec(pseudorandomKey, "HmacSHA256"))
            mac.update(previous)
            mac.update(info)
            mac.update(counter.toByte())
            previous = mac.doFinal()
            for (b in previous) {
                if (output.size == length) break
                output.add(b)
            }
            counter += 1
        }
        return output.toByteArray()
    }

    private fun updateNotification() {
        val status = if (currentWsUrl != null) "Monitoring clipboard..." else "Waiting for server URL…"
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Clipboard Sync")
            .setContentText(status)
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setSilent(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        Log.d(TAG, "Task removed – service continues")
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        super.onDestroy()
        pollingJob?.cancel()
        reconnectJob?.cancel()
        discoveryJob?.cancel()
        webSocket?.close(1000, "service destroyed")
        httpClient?.dispatcher?.executorService?.shutdown()
        scope.cancel()
        isRunning = false
        wsConnected = false
        sessionKey = null
        keyPair = null
        currentWsUrl = null
        triggerSend = null
        onDiscoveryStatusChanged = null
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "Clipboard Monitoring", NotificationManager.IMPORTANCE_LOW
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
        private const val RECONNECT_BASE_MS = 2000L
        private const val RECONNECT_MAX_MS = 30_000L
        private const val GCM_NONCE_BYTES = 12
        private const val GCM_TAG_BYTES = 16
        private const val GCM_TAG_BITS = 128
        private val SESSION_SALT = "ClipboardSyncSessionV1".toByteArray(Charsets.UTF_8)

        const val EXTRA_WS_URL = "ws_url"
        const val PREFS_NAME = "clipboard_sync_prefs"
        const val PREF_WS_URL = "ws_url"
        const val PREF_DEVICE_ID = "device_id"
        const val PREF_DEVICE_NAME = "device_name"
        const val DEFAULT_DEVICE_ID = "samsung-s23-plus"
        const val DEFAULT_DEVICE_NAME = "Android"

        const val ACTION_CLIPBOARD_CHANGE = "expo.modules.clipboardnative.CLIPBOARD_CHANGE"
        const val ACTION_CLIPBOARD_RECEIVED = "expo.modules.clipboardnative.CLIPBOARD_RECEIVED"
        const val ACTION_WS_STATUS = "expo.modules.clipboardnative.WS_STATUS"
        const val ACTION_DISCOVERY_STATUS = "expo.modules.clipboardnative.DISCOVERY_STATUS"
        const val EXTRA_TEXT = "text"
        const val EXTRA_STATUS = "status"
        const val EXTRA_URL = "url"

        @Volatile var isRunning = false
        @Volatile var wsConnected = false
        @Volatile var currentWsUrl: String? = null

        // JS → service callbacks
        @Volatile var onClipboardChanged: ((String) -> Unit)? = null
        @Volatile var onWsStatusChanged: ((String) -> Unit)? = null
        @Volatile var onClipboardReceived: ((String) -> Unit)? = null
        @Volatile var onDiscoveryStatusChanged: ((String, String?) -> Unit)? = null

        // Registered by the running service instance so the module can call it directly
        @Volatile var triggerSend: ((String) -> Unit)? = null
    }
}
