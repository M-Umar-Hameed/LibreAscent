package expo.modules.freedomvpn

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

/**
 * DNS SafeSearch pinning. Search and video hosts are answered with the
 * addresses of the engine's own restricted endpoint, which serves the same
 * site with SafeSearch or Restricted Mode locked on. The records go out under
 * the original query name (CNAME flattened) so the client never sees the
 * substitution.
 */
internal object SafeSearch {
    const val TYPE_A = 1
    const val TYPE_AAAA = 28
    const val MIN_TTL_SECONDS = 60L
    const val MAX_TTL_SECONDS = 3600L

    private const val GOOGLE_TARGET = "forcesafesearch.google.com"
    private const val YOUTUBE_TARGET = "restrictmoderate.youtube.com"

    private val FIXED_TARGETS = mapOf(
        "www.bing.com" to "strict.bing.com",
        "duckduckgo.com" to "safe.duckduckgo.com",
        "www.duckduckgo.com" to "safe.duckduckgo.com",
        "www.youtube.com" to YOUTUBE_TARGET,
        "m.youtube.com" to YOUTUBE_TARGET,
        "youtubei.googleapis.com" to YOUTUBE_TARGET,
        "youtube.googleapis.com" to YOUTUBE_TARGET,
        "www.youtube-nocookie.com" to YOUTUBE_TARGET,
    )

    // What follows "google." on Google's country search domains
    // (google.com/supported_domains). Matched whole, so google.com.evil.net
    // and notgoogle.com never qualify.
    private val GOOGLE_TAILS: Set<String> = """
        com ad ae com.af com.ag al am co.ao com.ar as at com.au az ba com.bd be bf bg com.bh bi bj
        com.bn com.bo com.br bs bt co.bw by com.bz ca cat cd cf cg ch ci co.ck cl cm cn com.co co.cr
        com.cu cv com.cy cz de dj dk dm com.do dz com.ec ee com.eg es com.et fi com.fj fm fr ga ge gg
        com.gh com.gi gl gm gr com.gt gy com.hk hn hr ht hu co.id ie co.il im co.in iq is it je com.jm
        jo co.jp co.ke com.kh ki kg co.kr com.kw kz la com.lb li lk co.ls lt lu lv com.ly co.ma md me
        mg mk ml com.mm mn com.mt mu mv mw com.mx com.my co.mz com.na com.ng com.ni ne nl no com.np nr
        nu co.nz com.om com.pa com.pe com.pg com.ph com.pk pl pn com.pr ps pt com.py com.qa ro rs ru rw
        com.sa com.sb sc se com.sg sh si sk com.sl sn so sm sr st com.sv td tg co.th com.tj tl tm tn to
        com.tr tt com.tw co.tz com.ua co.ug co.uk com.uy co.uz com.vc co.ve co.vi com.vn vu ws co.za
        co.zm co.zw
    """.trim().split(Regex("\\s+")).toSet()

    /** A/AAAA records for a target and the TTL to cache and serve them with. */
    data class Answer(val addresses: List<ByteArray>, val ttlSeconds: Long)

    /** The restricted endpoint for [domain] (lowercase, no trailing dot), or null if it is not pinned. */
    fun targetFor(domain: String): String? {
        FIXED_TARGETS[domain]?.let { return it }
        val host = domain.removePrefix("www.")
        if (!host.startsWith("google.")) return null
        return if (host.removePrefix("google.") in GOOGLE_TAILS) GOOGLE_TARGET else null
    }

    /**
     * The response to [query] with [target]'s records under the query's own
     * name, or null when the target cannot be resolved and the query should
     * be forwarded unchanged instead.
     */
    fun respond(
        query: ByteArray,
        length: Int,
        target: String,
        resolve: (target: String, qtype: Int) -> Answer?
    ): ByteArray? {
        val questionEnd = try {
            skipName(ByteBuffer.wrap(query, 0, length).also { it.position(DnsInterceptor.DNS_HEADER_SIZE) }) + 4
        } catch (e: RuntimeException) {
            return null
        }
        if (questionEnd > length) return null
        val qtype = ((query[questionEnd - 4].toInt() and 0xFF) shl 8) or (query[questionEnd - 3].toInt() and 0xFF)
        val answer = resolve(target, qtype) ?: return null

        val out = ByteArrayOutputStream()
        out.write(query, 0, 2) // transaction id
        // QR, RD, RA, NOERROR. An empty answer is NODATA, which keeps a client
        // from falling back to the unrestricted host over the other family.
        out.write(
            ByteBuffer.allocate(10)
                .putShort(0x8180.toShort())
                .putShort(1)
                .putShort(answer.addresses.size.toShort())
                .putShort(0)
                .putShort(0)
                .array()
        )
        // Only the question: anything after it (an EDNS OPT record) is not echoed.
        out.write(query, DnsInterceptor.DNS_HEADER_SIZE, questionEnd - DnsInterceptor.DNS_HEADER_SIZE)
        for (address in answer.addresses) {
            out.write(
                ByteBuffer.allocate(12)
                    .putShort(0xC00C.toShort()) // owner: pointer to the question name
                    .putShort(qtype.toShort())
                    .putShort(1)
                    .putInt(answer.ttlSeconds.toInt())
                    .putShort(address.size.toShort())
                    .array()
            )
            out.write(address)
        }
        return out.toByteArray()
    }

    /** A recursive query for [name] with transaction id [id]. */
    fun buildQuery(id: Int, name: String, qtype: Int): ByteArray {
        val buf = ByteBuffer.allocate(DnsInterceptor.DNS_HEADER_SIZE + name.length + 2 + 4)
        buf.putShort(id.toShort()).putShort(0x0100).putShort(1).putShort(0).putShort(0).putShort(0)
        for (label in name.split('.')) {
            buf.put(label.length.toByte())
            buf.put(label.toByteArray(Charsets.US_ASCII))
        }
        buf.put(0).putShort(qtype.toShort()).putShort(1)
        return buf.array()
    }

    /**
     * The [qtype] records in an upstream response to query [id], skipping any
     * CNAME chain. Null when the response is malformed, truncated, for another
     * query, or anything but NOERROR.
     */
    fun parseAnswer(response: ByteArray, length: Int, id: Int, qtype: Int): Answer? = try {
        val buf = ByteBuffer.wrap(response, 0, length)
        val responseId = buf.short.toInt() and 0xFFFF
        val flags = buf.short.toInt() and 0xFFFF
        val qdCount = buf.short.toInt() and 0xFFFF
        val anCount = buf.short.toInt() and 0xFFFF
        buf.position(DnsInterceptor.DNS_HEADER_SIZE)
        if (responseId != id || flags and 0x8000 == 0 || flags and 0x0200 != 0 || flags and 0x000F != 0) {
            null
        } else {
            repeat(qdCount) { buf.position(skipName(buf) + 4) }
            val addresses = mutableListOf<ByteArray>()
            var minTtl = MAX_TTL_SECONDS
            repeat(anCount) {
                buf.position(skipName(buf))
                val type = buf.short.toInt() and 0xFFFF
                val clazz = buf.short.toInt() and 0xFFFF
                val ttl = buf.int.toLong() and 0xFFFFFFFFL
                val rdata = ByteArray(buf.short.toInt() and 0xFFFF)
                buf.get(rdata)
                if (type == qtype && clazz == 1 && rdata.size == (if (qtype == TYPE_AAAA) 16 else 4)) {
                    addresses.add(rdata)
                    minTtl = minOf(minTtl, ttl)
                }
            }
            val ttl = if (addresses.isEmpty()) MIN_TTL_SECONDS else minTtl.coerceIn(MIN_TTL_SECONDS, MAX_TTL_SECONDS)
            Answer(addresses, ttl)
        }
    } catch (e: RuntimeException) {
        null
    }

    /** Position just past the name starting at the buffer's position; throws when it runs off the end. */
    private fun skipName(buf: ByteBuffer): Int {
        var pos = buf.position()
        while (true) {
            val len = buf.get(pos).toInt() and 0xFF
            when {
                len == 0 -> return pos + 1
                len and 0xC0 == 0xC0 -> { buf.get(pos + 1); return pos + 2 }
                len > 63 -> throw IllegalArgumentException("bad label length $len")
                else -> pos += len + 1
            }
        }
    }
}
