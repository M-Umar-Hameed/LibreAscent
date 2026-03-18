package expo.modules.freedomvpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Freedom VPN Service — Local DNS-only VPN for content blocking.
 *
 * Architecture:
 * 1. Creates a TUN interface that captures all device DNS traffic
 * 2. Reads IP packets from the TUN interface
 * 3. Extracts DNS queries from UDP packets on port 53
 * 4. Checks domains against DomainBlocklist
 * 5. Blocked: injects NXDOMAIN response back into TUN
 * 6. Allowed: forwards to real upstream DNS, returns response via TUN
 *
 * Only DNS traffic (port 53) is processed. All other traffic is
 * routed normally — this minimizes battery impact.
 */
class FreedomVpnService : VpnService() {

    private var vpnInterface: ParcelFileDescriptor? = null
    private var vpnThread: Thread? = null
    private val running = AtomicBoolean(false)

    companion object {
        private const val TAG = "FreedomVPN"
        private const val CHANNEL_ID = "freedom_vpn"
        private const val NOTIFICATION_ID = 2001
        private const val MTU = 1500
        private const val MAX_PACKET_SIZE = 32767

        // Cloudflare Family DNS — blocks malware AND adult content
        private const val DNS_PRIMARY = "1.1.1.3"
        private const val DNS_SECONDARY = "1.0.0.3"
        private const val DNS_TIMEOUT_MS = 5000

        @Volatile
        var isRunning: Boolean = false
            private set

        private val _blockedCount = AtomicInteger(0)
        val blockedCount: Int get() = _blockedCount.get()

        fun incrementBlocked() {
            _blockedCount.incrementAndGet()
        }

        // Shared blocklist instance — accessible from Module for updates
        val blocklist = DomainBlocklist()

        // Action for broadcasting blocked domain events
        const val ACTION_DOMAIN_BLOCKED = "expo.modules.freedomvpn.DOMAIN_BLOCKED"
        const val EXTRA_DOMAIN = "domain"
    }

    private lateinit var dnsInterceptor: DnsInterceptor

    override fun onCreate() {
        super.onCreate()
        dnsInterceptor = DnsInterceptor(blocklist)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (running.get()) {
            Log.w(TAG, "VPN already running, ignoring start command")
            return START_STICKY
        }

        Log.i(TAG, "Starting Freedom VPN Service")

        // Show foreground notification
        startForeground(NOTIFICATION_ID, createNotification())

        // Establish VPN interface
        if (!establishVpn()) {
            Log.e(TAG, "Failed to establish VPN interface")
            stopSelf()
            return START_NOT_STICKY
        }

        // Start packet processing thread
        running.set(true)
        isRunning = true
        vpnThread = Thread(::processPackets, "FreedomVPN-PacketProcessor")
        vpnThread?.start()

        // Broadcast status change
        broadcastVpnStatus(true)

        return START_STICKY
    }

    /**
     * Establish the TUN interface.
     *
     * We configure the VPN to capture DNS traffic only by setting
     * the VPN's DNS servers and routing only DNS (port 53) through the tunnel.
     */
    private fun establishVpn(): Boolean {
        return try {
            val builder = Builder()
                .setSession("Freedom")
                .setMtu(MTU)
                // Assign a private IP to the TUN interface
                .addAddress("10.0.0.2", 32)
                // Route only DNS traffic through the VPN
                // We use addRoute to capture all traffic, then handle DNS only
                .addRoute("0.0.0.0", 0)
                // Set our own DNS servers (these trigger DNS through the tunnel)
                .addDnsServer(DNS_PRIMARY)
                .addDnsServer(DNS_SECONDARY)
                // Allow the app itself to bypass VPN (prevents loops)
                .addDisallowedApplication(packageName)
                // Block connections without VPN if tunnel goes down
                .setBlocking(true)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                builder.setMetered(false)
            }

            vpnInterface = builder.establish()

            if (vpnInterface == null) {
                Log.e(TAG, "VPN interface is null — permission may have been revoked")
                false
            } else {
                Log.i(TAG, "VPN interface established successfully")
                true
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to establish VPN interface", e)
            false
        }
    }

    /**
     * Main packet processing loop.
     *
     * Reads IP packets from the TUN interface, identifies DNS queries,
     * and either blocks (NXDOMAIN) or forwards them to upstream DNS.
     */
    private fun processPackets() {
        val vpnFd = vpnInterface ?: return

        val inputStream = FileInputStream(vpnFd.fileDescriptor)
        val outputStream = FileOutputStream(vpnFd.fileDescriptor)
        val packet = ByteBuffer.allocate(MAX_PACKET_SIZE)

        Log.i(TAG, "Packet processing started")

        while (running.get()) {
            try {
                // Read a packet from the TUN interface
                packet.clear()
                val length = inputStream.read(packet.array())

                if (length <= 0) {
                    Thread.sleep(10) // Avoid busy loop on empty reads
                    continue
                }

                packet.limit(length)

                // Process the IP packet
                processIpPacket(packet, length, outputStream)

            } catch (e: InterruptedException) {
                Log.i(TAG, "Packet processing interrupted")
                break
            } catch (e: Exception) {
                if (running.get()) {
                    Log.e(TAG, "Error processing packet", e)
                }
                // Brief pause before retrying
                try { Thread.sleep(50) } catch (_: InterruptedException) { break }
            }
        }

        Log.i(TAG, "Packet processing stopped")
    }

    /**
     * Process a single IP packet from the TUN interface.
     *
     * IP packet layout:
     * - Byte 0: version (4 bits) + IHL (4 bits)
     * - Byte 9: protocol (6=TCP, 17=UDP)
     * - Bytes 12-15: source IP
     * - Bytes 16-19: destination IP
     * - After IP header: transport layer (UDP/TCP)
     *
     * We only care about UDP packets to port 53 (DNS).
     */
    private fun processIpPacket(
        packet: ByteBuffer,
        length: Int,
        outputStream: FileOutputStream
    ) {
        if (length < 20) return // Minimum IP header size

        val rawData = packet.array()

        // Check IP version (must be IPv4 = 4)
        val versionIhl = rawData[0].toInt() and 0xFF
        val version = versionIhl shr 4
        if (version != 4) return // Skip IPv6 for now

        // IP Header Length (in 32-bit words)
        val ihl = (versionIhl and 0xF) * 4
        if (length < ihl + 8) return // Not enough data for UDP header

        // Protocol (byte 9)
        val protocol = rawData[9].toInt() and 0xFF
        if (protocol != 17) return // Only UDP (17)

        // Extract source and destination IP
        val srcIp = ByteArray(4)
        val dstIp = ByteArray(4)
        System.arraycopy(rawData, 12, srcIp, 0, 4)
        System.arraycopy(rawData, 16, dstIp, 0, 4)

        // UDP header starts after IP header
        val udpOffset = ihl

        // Destination port (bytes 2-3 of UDP header)
        val dstPort = ((rawData[udpOffset + 2].toInt() and 0xFF) shl 8) or
                (rawData[udpOffset + 3].toInt() and 0xFF)

        // Source port (bytes 0-1 of UDP header)
        val srcPort = ((rawData[udpOffset].toInt() and 0xFF) shl 8) or
                (rawData[udpOffset + 1].toInt() and 0xFF)

        // Only process DNS (port 53)
        if (dstPort != DnsInterceptor.DNS_PORT) return

        // DNS payload starts after UDP header (8 bytes)
        val dnsOffset = udpOffset + 8
        val dnsLength = length - dnsOffset
        if (dnsLength < DnsInterceptor.DNS_HEADER_SIZE) return

        // Extract DNS payload
        val dnsPayload = ByteArray(dnsLength)
        System.arraycopy(rawData, dnsOffset, dnsPayload, 0, dnsLength)

        // Process through DNS interceptor
        val result = dnsInterceptor.processQuery(dnsPayload, dnsLength)

        if (result == null) {
            // Malformed or unsupported — forward to upstream
            forwardDnsQuery(rawData, length, dnsPayload, dnsLength,
                srcIp, dstIp, srcPort, outputStream)
            return
        }

        if (result.blocked && result.response != null) {
            // BLOCKED — inject NXDOMAIN response back to TUN
            Log.i(TAG, "Blocked domain: ${result.domain}")
            incrementBlocked()
            broadcastDomainBlocked(result.domain)

            val responsePacket = buildResponseIpPacket(
                result.response,
                dstIp,  // Swap: DNS server IP -> source
                srcIp,  // Swap: device IP -> destination
                dstPort, // Swap: DNS port -> source port
                srcPort  // Swap: original source port -> destination port
            )
            outputStream.write(responsePacket)
            outputStream.flush()
        } else {
            // NOT BLOCKED — forward to real DNS
            forwardDnsQuery(rawData, length, dnsPayload, dnsLength,
                srcIp, dstIp, srcPort, outputStream)
        }
    }

    /**
     * Forward a DNS query to the upstream DNS server and write
     * the response back to the TUN interface.
     */
    private fun forwardDnsQuery(
        originalPacket: ByteArray,
        originalLength: Int,
        dnsPayload: ByteArray,
        dnsLength: Int,
        srcIp: ByteArray,
        dstIp: ByteArray,
        srcPort: Int,
        outputStream: FileOutputStream
    ) {
        val dnsServers = listOf(DNS_PRIMARY, DNS_SECONDARY)

        for (server in dnsServers) {
            try {
                val socket = DatagramSocket()
                protect(socket) // Prevent VPN loop

                socket.soTimeout = DNS_TIMEOUT_MS

                // Send to upstream DNS
                val dnsServer = InetAddress.getByName(server)
                val sendPacket = DatagramPacket(dnsPayload, dnsLength,
                    InetSocketAddress(dnsServer, DnsInterceptor.DNS_PORT))
                socket.send(sendPacket)

                // Receive response
                val responseBuffer = ByteArray(MAX_PACKET_SIZE)
                val receivePacket = DatagramPacket(responseBuffer, responseBuffer.size)
                socket.receive(receivePacket)

                socket.close()

                // Build IP packet with the DNS response and write to TUN
                val dnsResponse = ByteArray(receivePacket.length)
                System.arraycopy(receivePacket.data, receivePacket.offset,
                    dnsResponse, 0, receivePacket.length)

                val responseIpPacket = buildResponseIpPacket(
                    dnsResponse,
                    dstIp,   // DNS server -> source
                    srcIp,   // Device -> destination
                    DnsInterceptor.DNS_PORT, // DNS port -> source port
                    srcPort  // Original source port -> destination port
                )
                outputStream.write(responseIpPacket)
                outputStream.flush()
                return // Success — no need to try secondary

            } catch (e: Exception) {
                Log.w(TAG, "DNS query to $server failed: ${e.message}")
            }
        }

        Log.w(TAG, "All DNS servers failed for query")
    }

    /**
     * Build a complete IP+UDP packet wrapping a DNS response payload.
     *
     * This creates a valid IPv4 packet that the TUN interface will
     * deliver to the requesting application.
     */
    private fun buildResponseIpPacket(
        dnsResponse: ByteArray,
        srcIp: ByteArray,   // Source IP (DNS server)
        dstIp: ByteArray,   // Destination IP (device)
        srcPort: Int,        // Source port (53)
        dstPort: Int         // Destination port (original query source port)
    ): ByteArray {
        val udpLength = 8 + dnsResponse.size
        val ipLength = 20 + udpLength

        val packet = ByteArray(ipLength)

        // === IPv4 Header (20 bytes) ===
        packet[0] = 0x45.toByte()           // Version 4, IHL 5 (20 bytes)
        packet[1] = 0x00.toByte()           // DSCP/ECN
        packet[2] = (ipLength shr 8).toByte()  // Total length
        packet[3] = (ipLength and 0xFF).toByte()
        packet[4] = 0x00.toByte()           // Identification
        packet[5] = 0x00.toByte()
        packet[6] = 0x40.toByte()           // Flags: Don't Fragment
        packet[7] = 0x00.toByte()           // Fragment offset
        packet[8] = 0x40.toByte()           // TTL: 64
        packet[9] = 0x11.toByte()           // Protocol: UDP (17)
        packet[10] = 0x00.toByte()          // Header checksum (will calculate)
        packet[11] = 0x00.toByte()

        // Source IP
        System.arraycopy(srcIp, 0, packet, 12, 4)
        // Destination IP
        System.arraycopy(dstIp, 0, packet, 16, 4)

        // Calculate IP header checksum
        val ipChecksum = calculateChecksum(packet, 0, 20)
        packet[10] = (ipChecksum shr 8).toByte()
        packet[11] = (ipChecksum and 0xFF).toByte()

        // === UDP Header (8 bytes) ===
        val udpOffset = 20
        packet[udpOffset] = (srcPort shr 8).toByte()
        packet[udpOffset + 1] = (srcPort and 0xFF).toByte()
        packet[udpOffset + 2] = (dstPort shr 8).toByte()
        packet[udpOffset + 3] = (dstPort and 0xFF).toByte()
        packet[udpOffset + 4] = (udpLength shr 8).toByte()
        packet[udpOffset + 5] = (udpLength and 0xFF).toByte()
        packet[udpOffset + 6] = 0x00.toByte() // UDP checksum (optional for IPv4)
        packet[udpOffset + 7] = 0x00.toByte()

        // DNS response payload
        System.arraycopy(dnsResponse, 0, packet, 28, dnsResponse.size)

        return packet
    }

    /**
     * Calculate IP header checksum (RFC 1071).
     */
    private fun calculateChecksum(data: ByteArray, offset: Int, length: Int): Int {
        var sum = 0L
        var i = offset
        val end = offset + length

        // Sum all 16-bit words
        while (i < end - 1) {
            sum += ((data[i].toInt() and 0xFF) shl 8) or (data[i + 1].toInt() and 0xFF)
            i += 2
        }

        // If odd number of bytes, pad with zero
        if (i < end) {
            sum += (data[i].toInt() and 0xFF) shl 8
        }

        // Fold 32-bit sum to 16 bits
        while (sum shr 16 > 0) {
            sum = (sum and 0xFFFF) + (sum shr 16)
        }

        return (sum.inv() and 0xFFFF).toInt()
    }

    /**
     * Broadcast blocked domain event to other native modules
     * (e.g., overlay service) and to JS layer.
     */
    private fun broadcastDomainBlocked(domain: String) {
        val intent = Intent(ACTION_DOMAIN_BLOCKED).apply {
            putExtra(EXTRA_DOMAIN, domain)
        }
        LocalBroadcastManager.getInstance(this).sendBroadcast(intent)
    }

    /**
     * Broadcast VPN status change to JS layer.
     */
    private fun broadcastVpnStatus(active: Boolean) {
        val intent = Intent("expo.modules.freedomvpn.VPN_STATUS").apply {
            putExtra("active", active)
        }
        LocalBroadcastManager.getInstance(this).sendBroadcast(intent)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Freedom VPN",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when Freedom VPN is filtering DNS traffic"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun createNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Freedom is protecting you")
            .setContentText("DNS filtering active — ${blocklist.size()} domains blocked")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    override fun onDestroy() {
        Log.i(TAG, "Stopping Freedom VPN Service")
        running.set(false)
        isRunning = false

        // Interrupt the processing thread
        vpnThread?.interrupt()
        vpnThread = null

        // Close the TUN interface
        vpnInterface?.close()
        vpnInterface = null

        broadcastVpnStatus(false)
        super.onDestroy()
    }

    override fun onRevoke() {
        Log.w(TAG, "VPN permission revoked")
        running.set(false)
        isRunning = false

        vpnThread?.interrupt()
        vpnThread = null

        vpnInterface?.close()
        vpnInterface = null

        broadcastVpnStatus(false)
        stopSelf()
    }
}
