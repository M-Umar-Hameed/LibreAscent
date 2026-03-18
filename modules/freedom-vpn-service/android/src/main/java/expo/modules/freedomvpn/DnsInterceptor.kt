package expo.modules.freedomvpn

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

/**
 * DNS packet parser and NXDOMAIN response builder.
 *
 * DNS packet format (simplified):
 * - Header: 12 bytes (ID, flags, question/answer counts)
 * - Questions: variable length (QNAME + QTYPE + QCLASS)
 * - Answers: variable length (only in responses)
 *
 * This interceptor:
 * 1. Parses the domain name from DNS query packets
 * 2. Checks against DomainBlocklist
 * 3. If blocked: builds an NXDOMAIN response
 * 4. If allowed: returns null (forward to real DNS)
 */
class DnsInterceptor(private val blocklist: DomainBlocklist) {

    data class DnsResult(
        val domain: String,
        val blocked: Boolean,
        val response: ByteArray? // NXDOMAIN response packet, null if not blocked
    )

    /**
     * Process a DNS query packet.
     *
     * @param packet Raw DNS query bytes
     * @param length Length of valid data in the packet
     * @return DnsResult with domain, blocked status, and NXDOMAIN response if blocked
     */
    fun processQuery(packet: ByteArray, length: Int): DnsResult? {
        if (length < DNS_HEADER_SIZE) return null

        try {
            val buffer = ByteBuffer.wrap(packet, 0, length)

            // Parse header
            val transactionId = buffer.short
            val flags = buffer.short.toInt() and 0xFFFF

            // Only process standard queries (QR=0, OPCODE=0)
            val isQuery = (flags and 0x8000) == 0
            val opcode = (flags shr 11) and 0xF
            if (!isQuery || opcode != 0) return null

            val questionCount = buffer.short.toInt() and 0xFFFF
            // Skip answer/authority/additional counts (6 bytes)
            buffer.position(buffer.position() + 6)

            if (questionCount < 1) return null

            // Parse first question's domain name
            val domain = parseDomainName(buffer) ?: return null

            // Read QTYPE and QCLASS
            if (buffer.remaining() < 4) return null
            val qtype = buffer.short.toInt() and 0xFFFF
            val qclass = buffer.short.toInt() and 0xFFFF

            // Only intercept A (1) and AAAA (28) records on IN class (1)
            if (qclass != 1 || (qtype != 1 && qtype != 28)) {
                return DnsResult(domain, false, null)
            }

            // Check blocklist
            val blocked = blocklist.isBlocked(domain)

            if (blocked) {
                val nxdomainResponse = buildNxdomainResponse(
                    transactionId,
                    packet,
                    length
                )
                return DnsResult(domain, true, nxdomainResponse)
            }

            return DnsResult(domain, false, null)

        } catch (e: Exception) {
            // Malformed packet — let it pass through
            return null
        }
    }

    /**
     * Parse a DNS domain name from the buffer.
     *
     * DNS names are encoded as a sequence of labels:
     * [length][label bytes][length][label bytes]...[0]
     *
     * Example: "example.com" → [7]example[3]com[0]
     */
    private fun parseDomainName(buffer: ByteBuffer): String? {
        val parts = mutableListOf<String>()
        var totalLength = 0

        while (buffer.hasRemaining()) {
            val labelLength = buffer.get().toInt() and 0xFF

            // End of name
            if (labelLength == 0) break

            // Compression pointer (top 2 bits set) — skip for now
            if (labelLength and 0xC0 == 0xC0) {
                if (!buffer.hasRemaining()) return null
                buffer.get() // Skip offset byte
                break
            }

            // Sanity check
            if (labelLength > 63) return null
            totalLength += labelLength + 1
            if (totalLength > 255) return null // DNS name max 255 chars

            if (buffer.remaining() < labelLength) return null

            val label = ByteArray(labelLength)
            buffer.get(label)
            parts.add(String(label, Charsets.US_ASCII))
        }

        if (parts.isEmpty()) return null
        return parts.joinToString(".").lowercase()
    }

    /**
     * Build an NXDOMAIN (Name Error) response for a blocked domain.
     *
     * Takes the original query and modifies the header to turn it into a response:
     * - Set QR bit (response)
     * - Set RA bit (recursion available)
     * - Set RCODE to 3 (NXDOMAIN)
     * - Keep the original question section
     */
    private fun buildNxdomainResponse(
        transactionId: Short,
        queryPacket: ByteArray,
        queryLength: Int
    ): ByteArray {
        val response = ByteArrayOutputStream()

        // Transaction ID (same as query)
        response.write(transactionId.toInt() shr 8 and 0xFF)
        response.write(transactionId.toInt() and 0xFF)

        // Flags: QR=1, OPCODE=0, AA=1, TC=0, RD=1, RA=1, RCODE=3 (NXDOMAIN)
        // 1 0000 1 0 1 1 000 0011 = 0x8583
        response.write(0x85)
        response.write(0x83)

        // QDCOUNT = 1
        response.write(0x00)
        response.write(0x01)

        // ANCOUNT = 0
        response.write(0x00)
        response.write(0x00)

        // NSCOUNT = 0
        response.write(0x00)
        response.write(0x00)

        // ARCOUNT = 0
        response.write(0x00)
        response.write(0x00)

        // Copy the question section from the original query
        // (starts at offset 12, runs to the end of the query)
        if (queryLength > DNS_HEADER_SIZE) {
            response.write(queryPacket, DNS_HEADER_SIZE, queryLength - DNS_HEADER_SIZE)
        }

        return response.toByteArray()
    }

    companion object {
        const val DNS_HEADER_SIZE = 12
        const val DNS_PORT = 53
    }
}
