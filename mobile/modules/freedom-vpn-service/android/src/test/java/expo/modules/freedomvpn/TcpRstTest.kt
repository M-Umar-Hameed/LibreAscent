package expo.modules.freedomvpn

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class TcpRstTest {

    private val client4 = byteArrayOf(10, 0, 0, 2)
    private val resolver4 = byteArrayOf(1, 1, 1, 1)
    private val client6 = hex("fd000001000100000000000000000002")
    private val resolver6 = hex("26064700470000000000000000001111")

    private fun hex(s: String) = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    private fun be16(b: ByteArray, at: Int) = ((b[at].toInt() and 0xFF) shl 8) or (b[at + 1].toInt() and 0xFF)
    private fun be32(b: ByteArray, at: Int): Long = (be16(b, at).toLong() shl 16) or be16(b, at + 2).toLong()

    /** Independent RFC 1071 oracle, written without reference to the implementation. */
    private fun onesComplement(bytes: ByteArray): Int {
        var sum = 0L
        var i = 0
        while (i + 1 < bytes.size) { sum += be16(bytes, i); i += 2 }
        if (i < bytes.size) sum += (bytes[i].toInt() and 0xFF) shl 8
        while (sum shr 16 != 0L) sum = (sum and 0xFFFF) + (sum shr 16)
        return (sum.inv() and 0xFFFF).toInt()
    }

    private fun tcpHeader(sport: Int, dport: Int, seq: Long, flags: Int): ByteArray {
        val t = ByteArray(20)
        t[0] = (sport shr 8).toByte(); t[1] = sport.toByte()
        t[2] = (dport shr 8).toByte(); t[3] = dport.toByte()
        t[4] = (seq shr 24).toByte(); t[5] = (seq shr 16).toByte(); t[6] = (seq shr 8).toByte(); t[7] = seq.toByte()
        t[12] = 0x50; t[13] = flags.toByte()
        return t
    }

    private fun ipv4(src: ByteArray, dst: ByteArray, proto: Int, payload: ByteArray): ByteArray {
        val p = ByteArray(20 + payload.size)
        p[0] = 0x45; p[2] = (p.size shr 8).toByte(); p[3] = p.size.toByte(); p[8] = 64; p[9] = proto.toByte()
        System.arraycopy(src, 0, p, 12, 4); System.arraycopy(dst, 0, p, 16, 4)
        System.arraycopy(payload, 0, p, 20, payload.size)
        return p
    }

    private fun ipv6(src: ByteArray, dst: ByteArray, next: Int, payload: ByteArray): ByteArray {
        val p = ByteArray(40 + payload.size)
        p[0] = 0x60; p[4] = (payload.size shr 8).toByte(); p[5] = payload.size.toByte(); p[6] = next.toByte(); p[7] = 64
        System.arraycopy(src, 0, p, 8, 16); System.arraycopy(dst, 0, p, 24, 16)
        System.arraycopy(payload, 0, p, 40, payload.size)
        return p
    }

    @Test
    fun ipv4SynToDotPortGetsAnRstThatTheClientWillAccept() {
        // The exact case on device: opportunistic Private DNS probing DoT on :853.
        val seq = 0x11223344L
        val syn = FreedomVpnService.parseTcpSyn(ipv4(client4, resolver4, 6, tcpHeader(40000, 853, seq, 0x02)), 40)
        assertNotNull(syn)
        assertEquals(853, syn.dstPort)
        val rst = FreedomVpnService.buildTcpRstPacket(syn)

        assertEquals(40, rst.size)
        assertEquals(0x45, rst[0].toInt() and 0xFF)
        assertEquals(6, rst[9].toInt(), "protocol TCP")
        assertContentEquals(resolver4, rst.copyOfRange(12, 16), "source is the resolver the client dialled")
        assertContentEquals(client4, rst.copyOfRange(16, 20), "destination is the client")
        // IPv4 header checksum must verify to zero when summed including itself.
        assertEquals(0, onesComplement(rst.copyOfRange(0, 20)), "IPv4 header checksum")

        val t = 20
        assertEquals(853, be16(rst, t), "ports swapped: source 853")
        assertEquals(40000, be16(rst, t + 2), "ports swapped: destination client port")
        assertEquals(0L, be32(rst, t + 4), "RST carries seq 0")
        assertEquals(seq + 1, be32(rst, t + 8), "ack = client seq + 1, or the client ignores the RST")
        assertEquals(0x50, rst[t + 12].toInt() and 0xFF, "data offset 5 words")
        assertEquals(0x14, rst[t + 13].toInt() and 0xFF, "RST|ACK")
        // TCP checksum over the IPv4 pseudo-header: verifies to zero with the field in place.
        val pseudo = ByteArray(12 + 20)
        System.arraycopy(resolver4, 0, pseudo, 0, 4); System.arraycopy(client4, 0, pseudo, 4, 4)
        pseudo[9] = 6; pseudo[11] = 20
        System.arraycopy(rst, t, pseudo, 12, 20)
        assertEquals(0, onesComplement(pseudo), "TCP checksum")
    }

    @Test
    fun ipv6SynToDnsPortGetsAnRstWithAValidMandatoryChecksum() {
        val seq = 0xFFFFFFFFL // ack must wrap to 0
        val syn = FreedomVpnService.parseTcpSyn(ipv6(client6, resolver6, 6, tcpHeader(50000, 53, seq, 0x02)), 60)
        assertNotNull(syn)
        val rst = FreedomVpnService.buildTcpRstPacket(syn)

        assertEquals(60, rst.size)
        assertEquals(0x60, rst[0].toInt() and 0xFF)
        assertEquals(20, be16(rst, 4), "payload length is the TCP header alone")
        assertEquals(6, rst[6].toInt(), "next header TCP")
        assertContentEquals(resolver6, rst.copyOfRange(8, 24))
        assertContentEquals(client6, rst.copyOfRange(24, 40))
        val t = 40
        assertEquals(53, be16(rst, t))
        assertEquals(50000, be16(rst, t + 2))
        assertEquals(0L, be32(rst, t + 8), "ack wraps: 0xFFFFFFFF + 1")
        assertEquals(0x14, rst[t + 13].toInt() and 0xFF)
        val pseudo = ByteArray(40 + 20)
        System.arraycopy(resolver6, 0, pseudo, 0, 16); System.arraycopy(client6, 0, pseudo, 16, 16)
        pseudo[35] = 20; pseudo[39] = 6
        System.arraycopy(rst, t, pseudo, 40, 20)
        assertEquals(0, onesComplement(pseudo), "IPv6 TCP checksum is mandatory and must verify")
    }

    @Test
    fun onlyConnectionAttemptsAreAnswered() {
        val synAck = ipv4(client4, resolver4, 6, tcpHeader(1, 2, 1L, 0x12))
        val ack = ipv4(client4, resolver4, 6, tcpHeader(1, 2, 1L, 0x10))
        val rstIn = ipv4(client4, resolver4, 6, tcpHeader(1, 2, 1L, 0x04))
        val udp = ipv4(client4, resolver4, 17, ByteArray(8))
        assertNull(FreedomVpnService.parseTcpSyn(synAck, synAck.size), "SYN|ACK is mid-handshake, not an attempt")
        assertNull(FreedomVpnService.parseTcpSyn(ack, ack.size))
        assertNull(FreedomVpnService.parseTcpSyn(rstIn, rstIn.size), "never RST an RST")
        assertNull(FreedomVpnService.parseTcpSyn(udp, udp.size), "UDP is the DNS path, not TCP")
    }

    @Test
    fun truncatedSegmentsAreIgnoredNotMisparsed() {
        val syn = ipv4(client4, resolver4, 6, tcpHeader(1, 53, 1L, 0x02))
        assertNull(FreedomVpnService.parseTcpSyn(syn, 20 + 13), "flags byte at offset 13 must be within length")
        assertNull(FreedomVpnService.parseTcpSyn(syn, 19), "shorter than a minimum IPv4 header")
        assertNull(FreedomVpnService.parseTcpSyn(ipv6(client6, resolver6, 6, ByteArray(0)), 40), "IPv6 with no segment")
    }
}
