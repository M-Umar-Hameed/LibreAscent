package expo.modules.freedomvpn

import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FreedomVpnServiceTest {

    private val cloudflareV6 = hex("26064700470000000000000000001111")
    private val tunV6 = hex("fd000001000100000000000000000002")

    // Fixed 13-byte payload — odd length, so it also exercises the checksum's
    // trailing-byte padding.
    private val payload = hex("12348183000100000000000007")

    @Test
    fun defaultBypassedPackagesIncludeWhatsAppVariants() {
        assertContains(FreedomVpnService.DEFAULT_BYPASSED_PACKAGES, "com.whatsapp")
        assertContains(FreedomVpnService.DEFAULT_BYPASSED_PACKAGES, "com.whatsapp.w4b")
    }

    @Test
    fun ipv6DnsQueryParsesAndYieldsDomain() {
        val query = dnsQuery("ads.example.com")
        val packet = ipv6UdpPacket(nextHeader = 17, srcPort = 41234, dstPort = 53, payload = query)

        val parsed = assertNotNull(FreedomVpnService.parseUdpPacket(packet, packet.size))
        assertContentEquals(tunV6, parsed.srcIp)
        assertContentEquals(cloudflareV6, parsed.dstIp)
        assertEquals(41234, parsed.srcPort)
        assertEquals(53, parsed.dstPort)
        assertEquals(40, parsed.udpOffset)

        val dns = packet.copyOfRange(parsed.udpOffset + 8, packet.size)
        val result = assertNotNull(DnsInterceptor(DomainBlocklist()).processQuery(dns, dns.size))
        assertEquals("ads.example.com", result.domain)
    }

    @Test
    fun ipv6ExtensionHeaderIsNotMisparsedAsUdp() {
        val query = dnsQuery("ads.example.com")
        // Hop-by-Hop (0), Fragment (44), Destination Options (60), TCP (6).
        for (nextHeader in listOf(0, 44, 60, 6)) {
            val packet = ipv6UdpPacket(nextHeader, 41234, 53, query)
            assertNull(
                FreedomVpnService.parseUdpPacket(packet, packet.size),
                "next header $nextHeader must not parse as UDP"
            )
        }
    }

    @Test
    fun ipv6PacketShorterThanHeaderPlusUdpIsRejected() {
        val truncated = ByteArray(44)
        truncated[0] = 0x60.toByte()
        truncated[6] = 17
        assertNull(FreedomVpnService.parseUdpPacket(truncated, truncated.size))
    }

    @Test
    fun ipv6ResponsePacketHasCorrectHeaderFields() {
        val packet = FreedomVpnService.buildResponseIpPacket(
            payload, cloudflareV6, tunV6, 53, 40000
        )

        assertEquals(40 + 8 + payload.size, packet.size)
        assertEquals(6, (packet[0].toInt() and 0xFF) shr 4)
        assertEquals(0, packet[0].toInt() and 0x0F) // traffic class high nibble
        assertEquals(8 + payload.size, be16(packet, 4)) // payload length excludes header
        assertEquals(17, packet[6].toInt() and 0xFF)   // next header: UDP
        assertEquals(64, packet[7].toInt() and 0xFF)   // hop limit
        assertContentEquals(cloudflareV6, packet.copyOfRange(8, 24))
        assertContentEquals(tunV6, packet.copyOfRange(24, 40))

        assertEquals(53, be16(packet, 40))
        assertEquals(40000, be16(packet, 42))
        assertEquals(8 + payload.size, be16(packet, 44))
        assertContentEquals(payload, packet.copyOfRange(48, packet.size))
    }

    @Test
    fun ipv6UdpChecksumMatchesIndependentlyComputedValue() {
        val packet = FreedomVpnService.buildResponseIpPacket(
            payload, cloudflareV6, tunV6, 53, 40000
        )

        // Computed outside this codebase for this exact vector (see report).
        assertEquals(0x067A, be16(packet, 46))

        // Independent check: the one's-complement sum over the pseudo-header
        // plus the UDP segment, with the checksum in place, must fold to 0xFFFF.
        assertEquals(0xFFFF, verifyIpv6UdpChecksum(packet))
    }

    @Test
    fun ipv6UdpChecksumOfZeroIsSentAsAllOnes() {
        // This vector sums to exactly 0xFFFF, so the one's complement is
        // 0x0000 — illegal over IPv6 and required to go on the wire as 0xFFFF.
        val body = hex("a124") + ByteArray(18)
        val packet = FreedomVpnService.buildResponseIpPacket(
            body, cloudflareV6, tunV6, 53, 40000
        )

        assertEquals(0xFFFF, be16(packet, 46))
    }

    @Test
    fun ipv6UdpChecksumIsNeverZero() {
        for (i in 0 until 256) {
            val body = ByteArray(20) { ((it * 7 + i) and 0xFF).toByte() }
            val packet = FreedomVpnService.buildResponseIpPacket(
                body, cloudflareV6, tunV6, 53, 40000 + i
            )
            assertTrue(be16(packet, 46) != 0, "zero checksum is illegal over IPv6 (i=$i)")
            assertEquals(0xFFFF, verifyIpv6UdpChecksum(packet))
        }
    }

    @Test
    fun ipv4ResponsePacketIsByteIdenticalToPreviousBuilder() {
        val packet = FreedomVpnService.buildResponseIpPacket(
            payload, byteArrayOf(1, 1, 1, 1), byteArrayOf(10, 0, 0, 2), 53, 40000
        )

        assertContentEquals(
            hex(
                "450000290000400040112ec1010101010a000002" +
                    "00359c400015000012348183000100000000000007"
            ),
            packet
        )
    }

    @Test
    fun ipv4DnsQueryStillParses() {
        val query = dnsQuery("ads.example.com")
        val packet = ipv4UdpPacket(41234, 53, query)

        val parsed = assertNotNull(FreedomVpnService.parseUdpPacket(packet, packet.size))
        assertContentEquals(byteArrayOf(10, 0, 0, 2), parsed.srcIp)
        assertContentEquals(byteArrayOf(1, 1, 1, 1), parsed.dstIp)
        assertEquals(41234, parsed.srcPort)
        assertEquals(53, parsed.dstPort)
        assertEquals(20, parsed.udpOffset)
    }

    @Test
    fun ipv4OptionsShiftTheUdpOffset() {
        val query = dnsQuery("ads.example.com")
        val packet = ipv4UdpPacket(41234, 53, query, optionBytes = 4)

        val parsed = assertNotNull(FreedomVpnService.parseUdpPacket(packet, packet.size))
        assertEquals(24, parsed.udpOffset) // IHL 6, not a hardcoded 20
        assertEquals(41234, parsed.srcPort)
        assertEquals(53, parsed.dstPort)

        val dns = packet.copyOfRange(parsed.udpOffset + 8, packet.size)
        val result = assertNotNull(DnsInterceptor(DomainBlocklist()).processQuery(dns, dns.size))
        assertEquals("ads.example.com", result.domain)
    }

    @Test
    fun ipv4NonUdpProtocolIsRejected() {
        val packet = ipv4UdpPacket(41234, 53, dnsQuery("ads.example.com"))
        packet[9] = 6 // TCP
        assertNull(FreedomVpnService.parseUdpPacket(packet, packet.size))
    }

    // --- helpers -------------------------------------------------------------

    private fun hex(s: String) = ByteArray(s.length / 2) {
        s.substring(it * 2, it * 2 + 2).toInt(16).toByte()
    }

    private fun be16(data: ByteArray, offset: Int) =
        ((data[offset].toInt() and 0xFF) shl 8) or (data[offset + 1].toInt() and 0xFF)

    private fun dnsQuery(domain: String): ByteArray {
        val out = mutableListOf<Byte>()
        out.addAll(listOf(0xAB.toByte(), 0xCD.toByte())) // transaction id
        out.addAll(listOf(0x01, 0x00))                   // flags: standard query, RD
        out.addAll(listOf(0x00, 0x01))                   // QDCOUNT
        repeat(6) { out.add(0x00) }                      // AN/NS/AR counts
        for (label in domain.split(".")) {
            out.add(label.length.toByte())
            out.addAll(label.toByteArray(Charsets.US_ASCII).toList())
        }
        out.add(0x00)
        out.addAll(listOf(0x00, 0x01, 0x00, 0x01))       // QTYPE A, QCLASS IN
        return out.toByteArray()
    }

    private fun ipv6UdpPacket(
        nextHeader: Int,
        srcPort: Int,
        dstPort: Int,
        payload: ByteArray
    ): ByteArray {
        val udpLength = 8 + payload.size
        val packet = ByteArray(40 + udpLength)
        packet[0] = 0x60.toByte()
        packet[4] = (udpLength shr 8).toByte()
        packet[5] = (udpLength and 0xFF).toByte()
        packet[6] = nextHeader.toByte()
        packet[7] = 0x40.toByte()
        tunV6.copyInto(packet, 8)
        cloudflareV6.copyInto(packet, 24)
        writeUdp(packet, 40, srcPort, dstPort, udpLength, payload)
        return packet
    }

    private fun ipv4UdpPacket(
        srcPort: Int,
        dstPort: Int,
        payload: ByteArray,
        optionBytes: Int = 0
    ): ByteArray {
        val ihl = 20 + optionBytes
        val udpLength = 8 + payload.size
        val packet = ByteArray(ihl + udpLength)
        packet[0] = (0x40 or (ihl / 4)).toByte()
        packet[2] = ((ihl + udpLength) shr 8).toByte()
        packet[3] = ((ihl + udpLength) and 0xFF).toByte()
        packet[8] = 0x40.toByte()
        packet[9] = 17
        byteArrayOf(10, 0, 0, 2).copyInto(packet, 12)
        byteArrayOf(1, 1, 1, 1).copyInto(packet, 16)
        writeUdp(packet, ihl, srcPort, dstPort, udpLength, payload)
        return packet
    }

    private fun writeUdp(
        packet: ByteArray,
        offset: Int,
        srcPort: Int,
        dstPort: Int,
        udpLength: Int,
        payload: ByteArray
    ) {
        packet[offset] = (srcPort shr 8).toByte()
        packet[offset + 1] = (srcPort and 0xFF).toByte()
        packet[offset + 2] = (dstPort shr 8).toByte()
        packet[offset + 3] = (dstPort and 0xFF).toByte()
        packet[offset + 4] = (udpLength shr 8).toByte()
        packet[offset + 5] = (udpLength and 0xFF).toByte()
        payload.copyInto(packet, offset + 8)
    }

    /**
     * Sum the IPv6 pseudo-header and UDP segment of a built response, with the
     * checksum field left in place. A correct checksum folds this to 0xFFFF.
     * Written independently of the production routine.
     */
    private fun verifyIpv6UdpChecksum(packet: ByteArray): Int {
        // Read from the UDP length field, not the IPv6 payload length: the
        // builder writes both from one variable, so trusting the IP header
        // would hide a bug in it.
        val udpLength = be16(packet, 44)
        var sum = 0
        for (offset in intArrayOf(8, 24)) {
            for (i in offset until offset + 16 step 2) sum += be16(packet, i)
        }
        sum += udpLength // upper-layer length, high 16 bits are zero here
        sum += 17        // next header
        var i = 40
        while (i < 40 + udpLength - 1) {
            sum += be16(packet, i)
            i += 2
        }
        if (i < 40 + udpLength) sum += (packet[i].toInt() and 0xFF) shl 8
        while (sum shr 16 > 0) sum = (sum and 0xFFFF) + (sum shr 16)
        return sum
    }
}
