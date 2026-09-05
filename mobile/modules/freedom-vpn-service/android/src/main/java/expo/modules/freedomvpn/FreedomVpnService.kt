package expo.modules.freedomvpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
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

    // TUN output is written from multiple DNS worker threads; serialize writes
    // so packets are never interleaved.
    @Volatile private var tunOutput: FileOutputStream? = null
    private val tunWriteLock = Any()

    // DNS is forwarded upstream OFF the packet-reader thread. Blocking the
    // reader on each query's round-trip serialized all device DNS and was the
    // cause of severe slowdowns / apps failing to load.
    private var dnsExecutor: java.util.concurrent.ExecutorService? = null

    // One buffer per forwarding-pool thread instead of one per query.
    private val dnsResponseBuffer: ThreadLocal<ByteArray> = ThreadLocal.withInitial { ByteArray(MAX_PACKET_SIZE) }

    companion object {
        private const val TAG = "FreedomVPN"
        private const val CHANNEL_ID = "freedom_vpn"
        private const val NOTIFICATION_ID = 2001
        private const val MTU = 1500
        private const val MAX_PACKET_SIZE = 32767

        // Cloudflare Family DNS — blocks malware AND adult content
        private const val DNS_PRIMARY = "1.1.1.1"
        private const val DNS_SECONDARY = "1.0.0.1"
        private const val DNS_PRIMARY_V6 = "2606:4700:4700::1111"
        private const val DNS_SECONDARY_V6 = "2606:4700:4700::1001"
        private const val TUN_ADDRESS_V6 = "fd00:1:1::2"
        // Kept short so a dead upstream frees its worker quickly instead of
        // holding it (and its socket) for seconds.
        private const val DNS_TIMEOUT_MS = 2000

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

        internal val DEFAULT_BYPASSED_PACKAGES = listOf(
            "com.whatsapp",
            "com.whatsapp.w4b"
        )

        private const val IPV4_HEADER_MIN_SIZE = 20
        private const val IPV6_HEADER_SIZE = 40
        private const val PROTOCOL_UDP = 17
        private const val PROTOCOL_TCP = 6
        private const val TCP_HEADER_SIZE = 20
        private const val TCP_FLAG_SYN = 0x02
        private const val TCP_FLAG_RST = 0x04
        private const val TCP_FLAG_ACK = 0x10

        /** IP and UDP header fields needed to answer a captured DNS query. */
        internal class UdpPacket(
            val srcIp: ByteArray,
            val dstIp: ByteArray,
            val srcPort: Int,
            val dstPort: Int,
            val udpOffset: Int
        )

        /**
         * Parse the IP and UDP headers of a captured packet.
         *
         * Returns null when the packet is not UDP over IPv4/IPv6, or is too
         * short to hold a UDP header. `srcIp`/`dstIp` are 4 bytes for IPv4 and
         * 16 for IPv6, which is what the response builder dispatches on.
         */
        internal fun parseUdpPacket(data: ByteArray, length: Int): UdpPacket? {
            if (length < IPV4_HEADER_MIN_SIZE) return null

            return when ((data[0].toInt() and 0xFF) shr 4) {
                4 -> parseIpv4Udp(data, length)
                6 -> parseIpv6Udp(data, length)
                else -> null
            }
        }

        private fun parseIpv4Udp(data: ByteArray, length: Int): UdpPacket? {
            // IP Header Length (in 32-bit words)
            val ihl = (data[0].toInt() and 0xF) * 4
            if (length < ihl + 8) return null // Not enough data for UDP header
            if ((data[9].toInt() and 0xFF) != PROTOCOL_UDP) return null

            val srcIp = ByteArray(4)
            val dstIp = ByteArray(4)
            System.arraycopy(data, 12, srcIp, 0, 4)
            System.arraycopy(data, 16, dstIp, 0, 4)

            return udpPacketAt(data, srcIp, dstIp, ihl)
        }

        /**
         * IPv6 has a fixed 40-byte header: byte 6 is Next Header, bytes 8-23
         * the source address and 24-39 the destination.
         *
         * ponytail: a Next Header that is not UDP is dropped rather than walked
         * as an extension-header chain. Device DNS queries do not carry
         * extension headers, and a Fragment header would need reassembly this
         * service cannot do. Walk the chain if real traffic ever needs it.
         */
        private fun parseIpv6Udp(data: ByteArray, length: Int): UdpPacket? {
            if (length < IPV6_HEADER_SIZE + 8) return null
            if ((data[6].toInt() and 0xFF) != PROTOCOL_UDP) return null

            val srcIp = ByteArray(16)
            val dstIp = ByteArray(16)
            System.arraycopy(data, 8, srcIp, 0, 16)
            System.arraycopy(data, 24, dstIp, 0, 16)

            return udpPacketAt(data, srcIp, dstIp, IPV6_HEADER_SIZE)
        }

        private fun udpPacketAt(
            data: ByteArray,
            srcIp: ByteArray,
            dstIp: ByteArray,
            udpOffset: Int
        ) = UdpPacket(
            srcIp,
            dstIp,
            // Source port (bytes 0-1 of UDP header)
            ((data[udpOffset].toInt() and 0xFF) shl 8) or (data[udpOffset + 1].toInt() and 0xFF),
            // Destination port (bytes 2-3 of UDP header)
            ((data[udpOffset + 2].toInt() and 0xFF) shl 8) or (data[udpOffset + 3].toInt() and 0xFF),
            udpOffset
        )

        /**
         * Build a complete IP+UDP packet wrapping a DNS response payload, in
         * the same address family as the query it answers.
         */
        internal fun buildResponseIpPacket(
            dnsResponse: ByteArray,
            srcIp: ByteArray,   // Source IP (DNS server)
            dstIp: ByteArray,   // Destination IP (device)
            srcPort: Int,        // Source port (53)
            dstPort: Int         // Destination port (original query source port)
        ): ByteArray =
            if (srcIp.size == 16) {
                buildIpv6ResponsePacket(dnsResponse, srcIp, dstIp, srcPort, dstPort)
            } else {
                buildIpv4ResponsePacket(dnsResponse, srcIp, dstIp, srcPort, dstPort)
            }

        private fun buildIpv4ResponsePacket(
            dnsResponse: ByteArray,
            srcIp: ByteArray,
            dstIp: ByteArray,
            srcPort: Int,
            dstPort: Int
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
            writeUdpHeader(packet, udpOffset, srcPort, dstPort, udpLength)
            packet[udpOffset + 6] = 0x00.toByte() // UDP checksum (optional for IPv4)
            packet[udpOffset + 7] = 0x00.toByte()

            // DNS response payload
            System.arraycopy(dnsResponse, 0, packet, 28, dnsResponse.size)

            return packet
        }

        private fun buildIpv6ResponsePacket(
            dnsResponse: ByteArray,
            srcIp: ByteArray,
            dstIp: ByteArray,
            srcPort: Int,
            dstPort: Int
        ): ByteArray {
            val udpLength = 8 + dnsResponse.size
            val packet = ByteArray(IPV6_HEADER_SIZE + udpLength)

            // === IPv6 Header (40 bytes) ===
            packet[0] = 0x60.toByte()                   // Version 6, traffic class 0
            packet[4] = (udpLength shr 8).toByte()      // Payload length (excludes header)
            packet[5] = (udpLength and 0xFF).toByte()
            packet[6] = PROTOCOL_UDP.toByte()           // Next header: UDP
            packet[7] = 0x40.toByte()                   // Hop limit: 64
            System.arraycopy(srcIp, 0, packet, 8, 16)
            System.arraycopy(dstIp, 0, packet, 24, 16)

            // === UDP Header (8 bytes) ===
            val udpOffset = IPV6_HEADER_SIZE
            writeUdpHeader(packet, udpOffset, srcPort, dstPort, udpLength)

            // DNS response payload
            System.arraycopy(dnsResponse, 0, packet, udpOffset + 8, dnsResponse.size)

            // RFC 8200 section 8.1: the UDP checksum is mandatory over IPv6 and
            // a receiver discards a datagram carrying a zero checksum, so a
            // computed zero is transmitted as 0xFFFF.
            var checksum = ipv6UdpChecksum(packet, udpOffset, udpLength, srcIp, dstIp)
            if (checksum == 0) checksum = 0xFFFF
            packet[udpOffset + 6] = (checksum shr 8).toByte()
            packet[udpOffset + 7] = (checksum and 0xFF).toByte()

            return packet
        }

        private fun writeUdpHeader(
            packet: ByteArray,
            udpOffset: Int,
            srcPort: Int,
            dstPort: Int,
            udpLength: Int
        ) {
            packet[udpOffset] = (srcPort shr 8).toByte()
            packet[udpOffset + 1] = (srcPort and 0xFF).toByte()
            packet[udpOffset + 2] = (dstPort shr 8).toByte()
            packet[udpOffset + 3] = (dstPort and 0xFF).toByte()
            packet[udpOffset + 4] = (udpLength shr 8).toByte()
            packet[udpOffset + 5] = (udpLength and 0xFF).toByte()
        }

        /**
         * UDP checksum over the IPv6 pseudo-header (RFC 8200 section 8.1):
         * source and destination addresses, 4-byte upper-layer length, three
         * zero bytes and the next header value, followed by the UDP header
         * (checksum field zeroed) and payload.
         *
         * Caller must not have written the checksum field yet.
         */
        private fun ipv6UdpChecksum(
            packet: ByteArray,
            udpOffset: Int,
            udpLength: Int,
            srcIp: ByteArray,
            dstIp: ByteArray
        ): Int {
            val pseudo = ByteArray(40 + udpLength)
            System.arraycopy(srcIp, 0, pseudo, 0, 16)
            System.arraycopy(dstIp, 0, pseudo, 16, 16)
            pseudo[32] = (udpLength ushr 24).toByte()
            pseudo[33] = (udpLength ushr 16).toByte()
            pseudo[34] = (udpLength ushr 8).toByte()
            pseudo[35] = (udpLength and 0xFF).toByte()
            pseudo[39] = PROTOCOL_UDP.toByte()
            System.arraycopy(packet, udpOffset, pseudo, 40, udpLength)

            return calculateChecksum(pseudo, 0, pseudo.size)
        }

        /**
         * Calculate a one's-complement checksum (RFC 1071).
         */
        internal data class TcpSyn(
            val srcIp: ByteArray,
            val dstIp: ByteArray,
            val srcPort: Int,
            val dstPort: Int,
            val seq: Long
        )

        /** A TCP segment with SYN set and ACK clear, i.e. a connection attempt. Anything else is null. */
        internal fun parseTcpSyn(data: ByteArray, length: Int): TcpSyn? {
            if (length < IPV4_HEADER_MIN_SIZE) return null
            val srcIp: ByteArray
            val dstIp: ByteArray
            val tcpOffset: Int
            when ((data[0].toInt() and 0xFF) shr 4) {
                4 -> {
                    if ((data[9].toInt() and 0xFF) != PROTOCOL_TCP) return null
                    srcIp = data.copyOfRange(12, 16)
                    dstIp = data.copyOfRange(16, 20)
                    tcpOffset = (data[0].toInt() and 0xF) * 4
                }
                6 -> {
                    if (length < IPV6_HEADER_SIZE) return null
                    if ((data[6].toInt() and 0xFF) != PROTOCOL_TCP) return null
                    srcIp = data.copyOfRange(8, 24)
                    dstIp = data.copyOfRange(24, 40)
                    tcpOffset = IPV6_HEADER_SIZE
                }
                else -> return null
            }
            if (length < tcpOffset + TCP_HEADER_SIZE) return null
            val flags = data[tcpOffset + 13].toInt() and 0xFF
            if (flags and TCP_FLAG_SYN == 0 || flags and TCP_FLAG_ACK != 0) return null
            val seq = ((data[tcpOffset + 4].toLong() and 0xFF) shl 24) or
                ((data[tcpOffset + 5].toLong() and 0xFF) shl 16) or
                ((data[tcpOffset + 6].toLong() and 0xFF) shl 8) or
                (data[tcpOffset + 7].toLong() and 0xFF)
            return TcpSyn(
                srcIp,
                dstIp,
                ((data[tcpOffset].toInt() and 0xFF) shl 8) or (data[tcpOffset + 1].toInt() and 0xFF),
                ((data[tcpOffset + 2].toInt() and 0xFF) shl 8) or (data[tcpOffset + 3].toInt() and 0xFF),
                seq
            )
        }

        /** RST|ACK back to the client: seq 0, ack = syn.seq + 1, ports and addresses swapped. */
        internal fun buildTcpRstPacket(syn: TcpSyn): ByteArray {
            val v6 = syn.srcIp.size == 16
            val ipHeader = if (v6) IPV6_HEADER_SIZE else 20
            val packet = ByteArray(ipHeader + TCP_HEADER_SIZE)
            if (v6) {
                packet[0] = 0x60.toByte()
                packet[4] = (TCP_HEADER_SIZE shr 8).toByte()
                packet[5] = (TCP_HEADER_SIZE and 0xFF).toByte()
                packet[6] = PROTOCOL_TCP.toByte()
                packet[7] = 0x40.toByte()
                System.arraycopy(syn.dstIp, 0, packet, 8, 16)
                System.arraycopy(syn.srcIp, 0, packet, 24, 16)
            } else {
                packet[0] = 0x45.toByte()
                packet[2] = (packet.size shr 8).toByte()
                packet[3] = (packet.size and 0xFF).toByte()
                packet[6] = 0x40.toByte()
                packet[8] = 0x40.toByte()
                packet[9] = PROTOCOL_TCP.toByte()
                System.arraycopy(syn.dstIp, 0, packet, 12, 4)
                System.arraycopy(syn.srcIp, 0, packet, 16, 4)
                val ipChecksum = calculateChecksum(packet, 0, 20)
                packet[10] = (ipChecksum shr 8).toByte()
                packet[11] = (ipChecksum and 0xFF).toByte()
            }
            val t = ipHeader
            packet[t] = (syn.dstPort shr 8).toByte()
            packet[t + 1] = (syn.dstPort and 0xFF).toByte()
            packet[t + 2] = (syn.srcPort shr 8).toByte()
            packet[t + 3] = (syn.srcPort and 0xFF).toByte()
            val ack = (syn.seq + 1) and 0xFFFFFFFFL
            packet[t + 8] = (ack shr 24).toByte()
            packet[t + 9] = (ack shr 16).toByte()
            packet[t + 10] = (ack shr 8).toByte()
            packet[t + 11] = ack.toByte()
            packet[t + 12] = 0x50.toByte()
            packet[t + 13] = (TCP_FLAG_RST or TCP_FLAG_ACK).toByte()
            val checksum = transportChecksum(packet, t, TCP_HEADER_SIZE, syn.dstIp, syn.srcIp, PROTOCOL_TCP)
            packet[t + 16] = (checksum shr 8).toByte()
            packet[t + 17] = (checksum and 0xFF).toByte()
            return packet
        }

        /** One's-complement checksum over the IPv4 or IPv6 pseudo-header plus the transport segment. */
        internal fun transportChecksum(
            packet: ByteArray,
            offset: Int,
            length: Int,
            srcIp: ByteArray,
            dstIp: ByteArray,
            protocol: Int
        ): Int {
            val pseudo: ByteArray
            if (srcIp.size == 16) {
                pseudo = ByteArray(40 + length)
                System.arraycopy(srcIp, 0, pseudo, 0, 16)
                System.arraycopy(dstIp, 0, pseudo, 16, 16)
                pseudo[34] = (length ushr 8).toByte()
                pseudo[35] = (length and 0xFF).toByte()
                pseudo[39] = protocol.toByte()
                System.arraycopy(packet, offset, pseudo, 40, length)
            } else {
                pseudo = ByteArray(12 + length)
                System.arraycopy(srcIp, 0, pseudo, 0, 4)
                System.arraycopy(dstIp, 0, pseudo, 4, 4)
                pseudo[9] = protocol.toByte()
                pseudo[10] = (length ushr 8).toByte()
                pseudo[11] = (length and 0xFF).toByte()
                System.arraycopy(packet, offset, pseudo, 12, length)
            }
            return calculateChecksum(pseudo, 0, pseudo.size)
        }

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
     * We configure the VPN to capture DNS traffic by setting the VPN's DNS
     * servers and routing only those DNS server IPs through the tunnel.
     * VpnService routes by address, not port, so routing 0.0.0.0/0 would send
     * all app and system traffic here. This service only forwards DNS packets,
     * so full-device routing can break non-DNS traffic such as carrier/IMS
     * services on some phones.
     *
     * IPv6 is configured the same narrow way. Some devices and configurations
     * reject IPv6 on a tunnel, so a failure there deliberately falls back to an
     * IPv4-only tunnel: losing IPv6 filtering is far better than losing all
     * filtering.
     */
    private fun establishVpn(): Boolean {
        vpnInterface = tryEstablish(withIpv6 = true) ?: tryEstablish(withIpv6 = false)

        return if (vpnInterface == null) {
            Log.e(TAG, "VPN interface is null — permission may have been revoked")
            false
        } else {
            Log.i(TAG, "VPN interface established successfully")
            true
        }
    }

    private fun tryEstablish(withIpv6: Boolean): ParcelFileDescriptor? {
        return try {
            val builder = Builder()
                .setSession("LibreAscent")
                .setMtu(MTU)
                // Assign a private IP to the TUN interface
                .addAddress("10.0.0.2", 32)
                // Route only our configured DNS resolvers through the VPN.
                .addRoute(DNS_PRIMARY, 32)
                .addRoute(DNS_SECONDARY, 32)
                // Set our own DNS servers (these trigger DNS through the tunnel)
                .addDnsServer(DNS_PRIMARY)
                .addDnsServer(DNS_SECONDARY)
                // Block connections without VPN if tunnel goes down
                .setBlocking(true)

            if (withIpv6) {
                builder.addAddress(TUN_ADDRESS_V6, 128)
                    .addRoute(DNS_PRIMARY_V6, 128)
                    .addRoute(DNS_SECONDARY_V6, 128)
                    .addDnsServer(DNS_PRIMARY_V6)
                    .addDnsServer(DNS_SECONDARY_V6)
            }

            addBypassedApplication(builder, packageName)
            DEFAULT_BYPASSED_PACKAGES.forEach { addBypassedApplication(builder, it) }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                builder.setMetered(false)
            }

            builder.establish()
        } catch (e: Exception) {
            if (withIpv6) {
                Log.w(TAG, "VPN establish failed with IPv6, retrying without: ${e.message}")
            } else {
                Log.e(TAG, "Failed to establish VPN interface", e)
            }
            null
        }
    }

    private fun addBypassedApplication(builder: Builder, packageName: String) {
        try {
            builder.addDisallowedApplication(packageName)
            Log.i(TAG, "Bypassing VPN for package: $packageName")
        } catch (e: PackageManager.NameNotFoundException) {
            Log.d(TAG, "Bypass package not installed: $packageName")
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
        tunOutput = outputStream
        dnsExecutor = java.util.concurrent.Executors.newFixedThreadPool(16)
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

                // Process the IP packet (DNS forwarding is dispatched to the
                // worker pool, so this returns without blocking on the network).
                processIpPacket(packet, length)

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
     * We only care about UDP packets to port 53 (DNS), over IPv4 or IPv6.
     *
     * ponytail: DoH/DoT bypass the tunnel entirely. DoH bootstrap hostnames
     * are refused by DomainBlocklist; hardcoded-IP resolvers remain a hole.
     */
    private fun processIpPacket(
        packet: ByteBuffer,
        length: Int
    ) {
        val rawData = packet.array()

        val ip = parseUdpPacket(rawData, length)
        if (ip == null) {
            // Everything addressed to the resolver /32s enters this tunnel, but
            // only UDP DNS is served. A TCP SYN here is either a DNS-over-TCP
            // fallback or Android's opportunistic Private DNS probing DoT on
            // :853; dropping it left the client hanging until its timeout on
            // every network change. Answer with RST so it fails in milliseconds
            // and the resolver falls back to UDP, which is filtered.
            // ponytail: RST, not a relay. Serving TCP DNS would mean a userspace
            // TCP stack; add one only if a truncated (TC) answer ever matters.
            parseTcpSyn(rawData, length)?.let { syn ->
                Log.d(TAG, "TCP SYN to :${syn.dstPort} in tunnel, replying RST")
                writeToTun(buildTcpRstPacket(syn))
            }
            return
        }
        val srcIp = ip.srcIp
        val dstIp = ip.dstIp
        val srcPort = ip.srcPort
        val dstPort = ip.dstPort

        // Only process DNS (port 53)
        if (dstPort != DnsInterceptor.DNS_PORT) return

        // DNS payload starts after UDP header (8 bytes)
        val dnsOffset = ip.udpOffset + 8
        val dnsLength = length - dnsOffset
        if (dnsLength < DnsInterceptor.DNS_HEADER_SIZE) return

        // Extract DNS payload
        val dnsPayload = ByteArray(dnsLength)
        System.arraycopy(rawData, dnsOffset, dnsPayload, 0, dnsLength)

        // Process through DNS interceptor
        val result = dnsInterceptor.processQuery(dnsPayload, dnsLength)

        if (result == null) {
            // Malformed or unsupported — forward to upstream off-thread
            dnsExecutor?.execute {
                forwardDnsQuery(dnsPayload, dnsLength, srcIp, dstIp, srcPort)
            }
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
            writeToTun(responsePacket)
        } else {
            // NOT BLOCKED — forward to real DNS off-thread so the reader loop
            // keeps pumping while this query's upstream round-trip is in flight.
            dnsExecutor?.execute {
                forwardDnsQuery(dnsPayload, dnsLength, srcIp, dstIp, srcPort)
            }
        }
    }

    /**
     * Serialize writes to the TUN interface across the reader thread and all
     * DNS worker threads. Concurrent unsynchronized writes would interleave
     * bytes from different packets.
     */
    private fun writeToTun(packet: ByteArray) {
        synchronized(tunWriteLock) {
            try {
                tunOutput?.let {
                    it.write(packet)
                    it.flush()
                }
            } catch (e: Exception) {
                Log.w(TAG, "TUN write failed: ${e.message}")
            }
        }
    }

    /**
     * Forward a DNS query to the upstream DNS server and write
     * the response back to the TUN interface.
     */
    private fun forwardDnsQuery(
        dnsPayload: ByteArray,
        dnsLength: Int,
        srcIp: ByteArray,
        dstIp: ByteArray,
        srcPort: Int
    ) {
        // An IPv6 query prefers the IPv6 upstreams but falls back to the IPv4
        // ones: the tunnel advertises IPv6 resolvers even on a network with no
        // IPv6 route, where those sends fail with ENETUNREACH. The DNS payload
        // is family-agnostic and buildResponseIpPacket rebuilds the answer in
        // the client's family from the captured srcIp, so a v6 client can be
        // answered from a v4 resolver.
        val dnsServers = if (srcIp.size == 16) {
            listOf(DNS_PRIMARY_V6, DNS_SECONDARY_V6, DNS_PRIMARY, DNS_SECONDARY)
        } else {
            listOf(DNS_PRIMARY, DNS_SECONDARY)
        }

        for (server in dnsServers) {
            try {
                DatagramSocket().use { socket ->
                    protect(socket) // Prevent VPN loop

                    socket.soTimeout = DNS_TIMEOUT_MS

                    // Send to upstream DNS
                    val dnsServer = InetAddress.getByName(server)
                    val sendPacket = DatagramPacket(dnsPayload, dnsLength,
                        InetSocketAddress(dnsServer, DnsInterceptor.DNS_PORT))
                    socket.send(sendPacket)

                    // Receive response
                    val responseBuffer = dnsResponseBuffer.get()!!
                    val receivePacket = DatagramPacket(responseBuffer, responseBuffer.size)
                    socket.receive(receivePacket)

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
                    writeToTun(responseIpPacket)
                }
                return // Success — no need to try secondary

            } catch (e: Exception) {
                Log.w(TAG, "DNS query to $server failed: ${e.message}")
            }
        }

        Log.w(TAG, "All DNS servers failed for query")
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
                "LibreAscent VPN",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when LibreAscent VPN is filtering DNS traffic"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun createNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("LibreAscent is protecting you")
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

        // Stop DNS workers before closing the TUN they write to
        dnsExecutor?.shutdownNow()
        dnsExecutor = null
        tunOutput = null

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

        dnsExecutor?.shutdownNow()
        dnsExecutor = null
        tunOutput = null

        vpnInterface?.close()
        vpnInterface = null

        broadcastVpnStatus(false)
        stopSelf()
    }
}
