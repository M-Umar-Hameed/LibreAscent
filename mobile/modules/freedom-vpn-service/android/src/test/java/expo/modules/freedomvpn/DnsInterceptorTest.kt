package expo.modules.freedomvpn

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class DnsInterceptorTest {

    // A-record query for blocked.example.com, id 0x1234, RD set.
    private val qname = byteArrayOf(
        7, 'b'.code.toByte(), 'l'.code.toByte(), 'o'.code.toByte(), 'c'.code.toByte(),
        'k'.code.toByte(), 'e'.code.toByte(), 'd'.code.toByte(),
        7, 'e'.code.toByte(), 'x'.code.toByte(), 'a'.code.toByte(), 'm'.code.toByte(),
        'p'.code.toByte(), 'l'.code.toByte(), 'e'.code.toByte(),
        3, 'c'.code.toByte(), 'o'.code.toByte(), 'm'.code.toByte(),
        0
    )
    private val query: ByteArray = byteArrayOf(
        0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ) + qname + byteArrayOf(0x00, 0x01, 0x00, 0x01)

    private fun u16(b: ByteArray, at: Int) = ((b[at].toInt() and 0xFF) shl 8) or (b[at + 1].toInt() and 0xFF)
    private fun u32(b: ByteArray, at: Int): Long =
        ((u16(b, at).toLong() shl 16) or u16(b, at + 2).toLong())

    private fun blockedResponse(): ByteArray {
        val list = DomainBlocklist()
        list.setDomains(setOf("example.com"))
        val result = DnsInterceptor(list).processQuery(query, query.size)
        assertNotNull(result, "query should parse")
        assertTrue(result.blocked, "example.com should block blocked.example.com")
        return assertNotNull(result.response, "blocked result must carry a response")
    }

    @Test
    fun nxdomainCarriesOneSoaInTheAuthoritySection() {
        val r = blockedResponse()
        assertEquals(0x1234, u16(r, 0), "transaction id echoed")
        assertEquals(3, r[3].toInt() and 0x0F, "RCODE NXDOMAIN")
        assertEquals(1, u16(r, 4), "QDCOUNT")
        assertEquals(0, u16(r, 6), "ANCOUNT")
        assertEquals(1, u16(r, 8), "NSCOUNT: exactly one SOA, this is what enables negative caching")
        assertEquals(0, u16(r, 10), "ARCOUNT")
    }

    @Test
    fun soaIsWellFormedAndCarriesTheNegativeTtl() {
        val r = blockedResponse()
        // Header + question (qname + QTYPE + QCLASS), then the RR.
        val rr = 12 + qname.size + 4
        assertEquals(0xC00C, u16(r, rr), "owner is a compression pointer to the question name at offset 12")
        assertEquals(6, u16(r, rr + 2), "TYPE SOA")
        assertEquals(1, u16(r, rr + 4), "CLASS IN")
        assertEquals(DnsInterceptor.NEGATIVE_CACHE_TTL_SECONDS, u32(r, rr + 6), "RR TTL")
        val rdlength = u16(r, rr + 10)
        assertEquals(DnsInterceptor.SOA_RDLENGTH, rdlength)
        val rdata = rr + 12
        // Independently computed wire lengths of "blocked.invalid" and "hostmaster.invalid".
        val mname = 1 + 7 + 1 + 7 + 1
        val rname = 1 + 10 + 1 + 7 + 1
        assertEquals(7, r[rdata].toInt(), "MNAME first label length")
        assertEquals(10, r[rdata + mname].toInt(), "RNAME first label length")
        val minimum = rdata + mname + rname + 16
        assertEquals(DnsInterceptor.NEGATIVE_CACHE_TTL_SECONDS, u32(r, minimum), "SOA MINIMUM is the negative TTL (RFC 2308)")
        assertEquals(rdata + rdlength, r.size, "nothing trails the SOA; RDLENGTH accounts for every byte")
    }

    @Test
    fun anEdnsOptRecordIsNotCopiedIntoTheResponse() {
        // OPT pseudo-record: root name, TYPE 41, UDP size 4096, no options.
        val opt = byteArrayOf(0, 0, 41, 0x10, 0, 0, 0, 0, 0, 0, 0)
        val edns = query.copyOf().also { it[11] = 1 } + opt
        val list = DomainBlocklist()
        list.setDomains(setOf("example.com"))
        val r = assertNotNull(DnsInterceptor(list).processQuery(edns, edns.size)?.response)

        assertEquals(0, u16(r, 10), "ARCOUNT")
        assertContentEquals(blockedResponse(), r, "same bytes as the query without EDNS")
    }

    @Test
    fun nxdomainEchoesTheQueryRecursionDesiredBit() {
        assertEquals(0x8583, u16(blockedResponse(), 2), "QR AA RD RA NXDOMAIN for an RD query")

        val noRd = query.copyOf().also { it[2] = 0 }
        val list = DomainBlocklist()
        list.setDomains(setOf("example.com"))
        val r = assertNotNull(DnsInterceptor(list).processQuery(noRd, noRd.size)?.response)
        assertEquals(0x8483, u16(r, 2), "RD clear in the query stays clear")
    }

    @Test
    fun negativeTtlIsShortEnoughThatUnblockingIsNotStuck() {
        // Bounds the retry storm without pinning a removed domain for long.
        assertTrue(DnsInterceptor.NEGATIVE_CACHE_TTL_SECONDS in 60L..3600L)
    }
}
