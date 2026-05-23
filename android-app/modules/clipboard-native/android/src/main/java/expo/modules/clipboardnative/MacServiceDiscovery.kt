package expo.modules.clipboardnative

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

object MacServiceDiscovery {
    private const val TAG = "MacServiceDiscovery"
    private const val SERVICE_TYPE = "_clipboard-sync._tcp."
    private const val DEFAULT_TIMEOUT_MS = 8000L

    fun discoverWsUrl(context: Context, timeoutMs: Long = DEFAULT_TIMEOUT_MS): String? {
        val appContext = context.applicationContext
        val nsdManager = appContext.getSystemService(Context.NSD_SERVICE) as NsdManager
        val latch = CountDownLatch(1)
        val resolvedUrl = AtomicReference<String?>(null)
        val resolving = AtomicBoolean(false)
        val multicastLock = acquireMulticastLock(appContext)

        var discoveryListener: NsdManager.DiscoveryListener? = null
        discoveryListener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {
                Log.d(TAG, "Discovery started for $serviceType")
            }

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                if (!serviceInfo.serviceType.equals(SERVICE_TYPE, ignoreCase = true)) return
                if (!resolving.compareAndSet(false, true)) return

                Log.d(TAG, "Found service ${serviceInfo.serviceName}")
                nsdManager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                        Log.w(TAG, "Resolve failed for ${serviceInfo.serviceName}: $errorCode")
                        resolving.set(false)
                    }

                    override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                        buildWsUrl(serviceInfo)?.let { url ->
                            Log.d(TAG, "Resolved Mac service to $url")
                            resolvedUrl.set(url)
                            latch.countDown()
                        } ?: resolving.set(false)
                    }
                })
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                Log.d(TAG, "Service lost ${serviceInfo.serviceName}")
            }

            override fun onDiscoveryStopped(serviceType: String) {
                Log.d(TAG, "Discovery stopped for $serviceType")
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.w(TAG, "Discovery start failed: $errorCode")
                tryStopDiscovery(nsdManager, this)
                latch.countDown()
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.w(TAG, "Discovery stop failed: $errorCode")
            }
        }

        return try {
            nsdManager.discoverServices(
                SERVICE_TYPE,
                NsdManager.PROTOCOL_DNS_SD,
                discoveryListener,
            )
            latch.await(timeoutMs, TimeUnit.MILLISECONDS)
            resolvedUrl.get()
        } catch (e: Exception) {
            Log.e(TAG, "Discovery error", e)
            null
        } finally {
            discoveryListener?.let { tryStopDiscovery(nsdManager, it) }
            multicastLock?.release()
        }
    }

    private fun buildWsUrl(serviceInfo: NsdServiceInfo): String? {
        val host = chooseHost(serviceInfo) ?: return null
        val port = serviceInfo.port.takeIf { it > 0 } ?: return null
        val path = serviceInfo.attributes["path"]?.toString(Charsets.UTF_8)?.takeIf {
            it.startsWith("/")
        } ?: "/ws"

        return "ws://${formatHost(host)}:$port$path"
    }

    private fun chooseHost(serviceInfo: NsdServiceInfo): InetAddress? {
        if (Build.VERSION.SDK_INT >= 34) {
            val addresses = serviceInfo.hostAddresses
            addresses.firstOrNull { it is Inet4Address }?.let { return it }
            addresses.firstOrNull { it is Inet6Address }?.let { return it }
        }
        @Suppress("DEPRECATION")
        return serviceInfo.host
    }

    private fun formatHost(host: InetAddress): String {
        val raw = host.hostAddress ?: host.hostName
        val withoutScope = raw.substringBefore('%')
        return if (withoutScope.contains(":")) "[$withoutScope]" else withoutScope
    }

    private fun acquireMulticastLock(context: Context): WifiManager.MulticastLock? {
        return try {
            val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            wifi.createMulticastLock("clipboard-sync-discovery").apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not acquire multicast lock", e)
            null
        }
    }

    private fun tryStopDiscovery(
        nsdManager: NsdManager,
        listener: NsdManager.DiscoveryListener,
    ) {
        try {
            nsdManager.stopServiceDiscovery(listener)
        } catch (_: Exception) {
            // Discovery may already be stopped by Android after a start failure.
        }
    }
}
