package expo.modules.freedomvpn

import java.io.ByteArrayOutputStream
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class SafeSearchTest {

    private val google = "forcesafesearch.google.com"
    private val youtube = "restrictmoderate.youtube.com"

    @Test
    fun googleSearchHostsMapToForceSafeSearch() {
        for (host in listOf(
            "google.com", "www.google.com", "google.co.uk", "www.google.co.uk",
            "google.com.pk", "www.google.com.pk", "google.de", "www.google.co.jp"
        )) {
            assertEquals(google, SafeSearch.targetFor(host), host)
        }
    }

    @Test
    fun fixedHostsMapToTheirRestrictedEndpoints() {
        assertEquals("strict.bing.com", SafeSearch.targetFor("www.bing.com"))
        assertEquals("safe.duckduckgo.com", SafeSearch.targetFor("duckduckgo.com"))
        assertEquals("safe.duckduckgo.com", SafeSearch.targetFor("www.duckduckgo.com"))
        for (host in listOf(
            "www.youtube.com", "m.youtube.com", "youtubei.googleapis.com",
            "youtube.googleapis.com", "www.youtube-nocookie.com"
        )) {
            assertEquals(youtube, SafeSearch.targetFor(host), host)
        }
    }

    @Test
    fun lookAlikesAndOtherGoogleHostsAreNotPinned() {
        for (host in listOf(
            "google.com.evil.net", "www.google.com.evil.net", "notgoogle.com", "www.notgoogle.com",
            "google.evil", "google.co.evil", "www.www.google.com", "mail.google.com",
            "forcesafesearch.google.com", "googleapis.com", "bing.com", "www.bing.com.evil.net",
            "safe.duckduckgo.com", "duckduckgo.com.evil.net", "youtube.com", "music.youtube.com", "google"
        )) {
            assertNull(SafeSearch.targetFor(host), host)
        }
    }

    @Test
    fun interceptorReportsTheTargetForAnAllowedPinnedHost() {
        val query = query(0x4242, "www.google.co.uk", SafeSearch.TYPE_A)
        val result = assertNotNull(DnsInterceptor(DomainBlocklist()).processQuery(query, query.size))
        assertEquals(false, result.blocked)
        assertEquals(google, result.safeSearchTarget)

        val other = query(0x4242, "example.com", SafeSearch.TYPE_A)
        assertNull(assertNotNull(DnsInterceptor(DomainBlocklist()).processQuery(other, other.size)).safeSearchTarget)
    }

    @Test
    fun blockingStillWinsOverPinning() {
        val list = DomainBlocklist()
        list.setDomains(setOf("google.com"))
        val query = query(1, "www.google.com", SafeSearch.TYPE_A)
        val result = assertNotNull(DnsInterceptor(list).processQuery(query, query.size))
        assertEquals(true, result.blocked)
    }

    @Test
    fun buildQueryEncodesARecursiveQuestion() {
        val q = SafeSearch.buildQuery(0xBEEF, "strict.bing.com", SafeSearch.TYPE_AAAA)
        assertContentEquals(query(0xBEEF, "strict.bing.com", SafeSearch.TYPE_AAAA), q)
    }

    @Test
    fun parseAnswerFlattensTheCnameChainAndTakesTheLowestTtl() {
        val response = response(
            0x1111, "www.bing.com", SafeSearch.TYPE_A,
            rr(5, 300, name("strict.bing.com")),
            rr(SafeSearch.TYPE_A, 900, byteArrayOf(1, 2, 3, 4)),
            rr(SafeSearch.TYPE_A, 600, byteArrayOf(5, 6, 7, 8)),
        )
        val answer = assertNotNull(SafeSearch.parseAnswer(response, response.size, 0x1111, SafeSearch.TYPE_A))
        assertEquals(2, answer.addresses.size)
        assertContentEquals(byteArrayOf(1, 2, 3, 4), answer.addresses[0])
        assertContentEquals(byteArrayOf(5, 6, 7, 8), answer.addresses[1])
        assertEquals(600L, answer.ttlSeconds, "CNAME TTL is not an address TTL")
    }

    @Test
    fun parseAnswerClampsTheTtl() {
        val low = response(1, google, SafeSearch.TYPE_A, rr(SafeSearch.TYPE_A, 5, byteArrayOf(1, 1, 1, 1)))
        assertEquals(SafeSearch.MIN_TTL_SECONDS, SafeSearch.parseAnswer(low, low.size, 1, SafeSearch.TYPE_A)?.ttlSeconds)
        val high = response(1, google, SafeSearch.TYPE_A, rr(SafeSearch.TYPE_A, 86400, byteArrayOf(1, 1, 1, 1)))
        assertEquals(SafeSearch.MAX_TTL_SECONDS, SafeSearch.parseAnswer(high, high.size, 1, SafeSearch.TYPE_A)?.ttlSeconds)
    }

    @Test
    fun parseAnswerKeepsOnlyTheAskedFamily() {
        val v6 = ByteArray(16) { it.toByte() }
        val r = response(
            7, google, SafeSearch.TYPE_AAAA,
            rr(SafeSearch.TYPE_A, 300, byteArrayOf(1, 1, 1, 1)),
            rr(SafeSearch.TYPE_AAAA, 300, v6),
        )
        val answer = assertNotNull(SafeSearch.parseAnswer(r, r.size, 7, SafeSearch.TYPE_AAAA))
        assertEquals(1, answer.addresses.size)
        assertContentEquals(v6, answer.addresses[0])
    }

    @Test
    fun parseAnswerRejectsFailuresSoTheQueryIsForwarded() {
        val ok = response(9, google, SafeSearch.TYPE_A, rr(SafeSearch.TYPE_A, 300, byteArrayOf(1, 1, 1, 1)))
        assertNull(SafeSearch.parseAnswer(ok, ok.size, 10, SafeSearch.TYPE_A), "wrong transaction id")
        val servfail = ok.copyOf().also { it[3] = (it[3].toInt() or 2).toByte() }
        assertNull(SafeSearch.parseAnswer(servfail, servfail.size, 9, SafeSearch.TYPE_A), "SERVFAIL")
        val truncated = ok.copyOf().also { it[2] = (it[2].toInt() or 0x02).toByte() }
        assertNull(SafeSearch.parseAnswer(truncated, truncated.size, 9, SafeSearch.TYPE_A), "TC set")
        assertNull(SafeSearch.parseAnswer(ok, ok.size - 2, 9, SafeSearch.TYPE_A), "cut short")
    }

    @Test
    fun respondAnswersUnderTheOriginalName() {
        val host = "www.google.com"
        // A trailing EDNS OPT record must not be echoed into the response.
        val opt = byteArrayOf(0, 0, 41, 0x10, 0, 0, 0, 0, 0, 0, 0)
        val q = query(0x5150, host, SafeSearch.TYPE_A).also { it[11] = 1 } + opt
        var asked: Pair<String, Int>? = null
        val r = assertNotNull(SafeSearch.respond(q, q.size, google) { target, qtype ->
            asked = target to qtype
            SafeSearch.Answer(listOf(byteArrayOf(216.toByte(), 239.toByte(), 38, 120)), 120)
        })
        assertEquals(google to SafeSearch.TYPE_A, asked)

        assertEquals(0x5150, u16(r, 0), "transaction id echoed")
        assertEquals(0x8180, u16(r, 2), "QR RD RA NOERROR")
        assertEquals(1, u16(r, 4), "QDCOUNT")
        assertEquals(1, u16(r, 6), "ANCOUNT")
        assertEquals(0, u16(r, 8), "NSCOUNT")
        assertEquals(0, u16(r, 10), "ARCOUNT")
        val question = name(host) + byteArrayOf(0, 1, 0, 1)
        assertContentEquals(question, r.copyOfRange(12, 12 + question.size), "question copied verbatim")
        val rr = 12 + question.size
        assertEquals(0xC00C, u16(r, rr), "owner is the original query name, not the target")
        assertEquals(SafeSearch.TYPE_A, u16(r, rr + 2))
        assertEquals(1, u16(r, rr + 4))
        assertEquals(120, (u16(r, rr + 6) shl 16) or u16(r, rr + 8))
        assertEquals(4, u16(r, rr + 10))
        assertContentEquals(byteArrayOf(216.toByte(), 239.toByte(), 38, 120), r.copyOfRange(rr + 12, rr + 16))
        assertEquals(rr + 16, r.size, "nothing trails the answer")
    }

    @Test
    fun respondWithNoRecordsIsNodata() {
        val q = query(3, "www.bing.com", SafeSearch.TYPE_AAAA)
        val r = assertNotNull(SafeSearch.respond(q, q.size, "strict.bing.com") { _, _ -> SafeSearch.Answer(emptyList(), 60) })
        assertEquals(0x8180, u16(r, 2))
        assertEquals(0, u16(r, 6))
        assertEquals(q.size, r.size)
    }

    @Test
    fun respondEchoesTheQueryRecursionDesiredBit() {
        val q = query(3, "www.bing.com", SafeSearch.TYPE_A).also { it[2] = 0 }
        val r = assertNotNull(SafeSearch.respond(q, q.size, "strict.bing.com") { _, _ -> SafeSearch.Answer(emptyList(), 60) })
        assertEquals(0x8080, u16(r, 2), "RD clear in the query stays clear")
    }

    @Test
    fun cachedAnswerServesADecayingTtlUntilExpiry() {
        val cache = HashMap<String, Pair<SafeSearch.Answer, Long>>()
        val address = byteArrayOf(1, 2, 3, 4)
        assertNull(SafeSearch.cachedAnswer(cache, "k", 0), "miss on an empty cache")

        SafeSearch.cacheAnswer(cache, "k", SafeSearch.Answer(listOf(address), 300), 1_000)

        val fresh = assertNotNull(SafeSearch.cachedAnswer(cache, "k", 1_000), "hit right after caching")
        assertEquals(300, fresh.ttlSeconds)
        assertContentEquals(address, fresh.addresses.single())
        assertEquals(200, assertNotNull(SafeSearch.cachedAnswer(cache, "k", 101_000)).ttlSeconds, "TTL counts down")
        assertEquals(1, assertNotNull(SafeSearch.cachedAnswer(cache, "k", 300_500)).ttlSeconds, "never served as 0")
        assertNull(SafeSearch.cachedAnswer(cache, "k", 301_000), "expired at the upstream TTL")
        assertNull(SafeSearch.cachedAnswer(cache, "other", 1_000))
    }

    @Test
    fun respondFallsBackWhenTheTargetDoesNotResolve() {
        val q = query(3, "www.google.com", SafeSearch.TYPE_A)
        assertNull(SafeSearch.respond(q, q.size, google) { _, _ -> null })
    }

    private fun u16(b: ByteArray, at: Int) = ((b[at].toInt() and 0xFF) shl 8) or (b[at + 1].toInt() and 0xFF)

    private fun name(n: String): ByteArray {
        val out = ByteArrayOutputStream()
        for (label in n.split('.')) {
            out.write(label.length)
            out.write(label.toByteArray(Charsets.US_ASCII))
        }
        out.write(0)
        return out.toByteArray()
    }

    private fun query(id: Int, n: String, qtype: Int): ByteArray =
        byteArrayOf((id shr 8).toByte(), id.toByte(), 1, 0, 0, 1, 0, 0, 0, 0, 0, 0) +
            name(n) + byteArrayOf(0, qtype.toByte(), 0, 1)

    /** Answer RR owned by a pointer to the question name. */
    private fun rr(type: Int, ttl: Int, rdata: ByteArray): ByteArray =
        byteArrayOf(
            0xC0.toByte(), 0x0C, 0, type.toByte(), 0, 1,
            (ttl shr 24).toByte(), (ttl shr 16).toByte(), (ttl shr 8).toByte(), ttl.toByte(),
            (rdata.size shr 8).toByte(), rdata.size.toByte()
        ) + rdata

    private fun response(id: Int, n: String, qtype: Int, vararg answers: ByteArray): ByteArray {
        val r = query(id, n, qtype)
        r[2] = 0x81.toByte()
        r[3] = 0x80.toByte()
        r[7] = answers.size.toByte()
        return answers.fold(r) { acc, a -> acc + a }
    }
}
