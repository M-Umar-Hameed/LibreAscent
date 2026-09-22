package expo.modules.freedomvpn

/**
 * Membership-only domain set, stored as 64-bit hashes in a primitive LongArray
 * instead of a HashSet<String>.
 *
 * A million domains cost about 8 MB here against roughly 55 MB as strings, and
 * the app kept two copies of the same 526k-domain category — one for the DNS
 * tunnel, one for the accessibility matcher. That was most of a 138 MB Java
 * heap on device and was getting Play Services and TalkBack killed by the
 * low-memory killer while Firefox was open.
 *
 * Domains cannot be read back, only tested. Every caller already holds the
 * authoritative copy on disk, so nothing enumerates these.
 *
 * ponytail: a collision would block an unrelated domain. Two distinct domains
 * share a 64-bit hash with probability about n^2/2^65 — near 1 in 37 million at
 * a million entries — against memory kills that happen every session today. If
 * that ever needs to be zero, store the strings for a second-stage check.
 *
 * Writes are serialized and the table is published through a volatile, so a
 * reader on the packet thread sees a table that is complete up to some point in
 * the fill. Readers never block.
 */
class HashedDomainSet(initialCapacity: Int = DEFAULT_CAPACITY) : DomainSet {

    @Volatile
    private var table = LongArray(tableSizeFor(initialCapacity))

    @Volatile
    private var count = 0

    private val lock = Any()

    override val size: Int get() = count

    /** [domain] must already be normalized by the caller. */
    fun add(domain: String) {
        if (domain.isEmpty()) return
        synchronized(lock) {
            // Grow at 60% load: linear probing degrades badly past that.
            if ((count + 1) * 10 >= table.size * 6) grow()
            if (insert(table, hash(domain))) {
                count += 1
            }
        }
    }

    fun addAll(domains: Collection<String>) {
        domains.forEach { add(it) }
    }

    override fun contains(domain: String): Boolean {
        if (domain.isEmpty()) return false
        // One snapshot: a concurrent grow swaps in a different array.
        val snapshot = table
        val mask = snapshot.size - 1
        val target = hash(domain)
        var index = indexFor(target, mask)

        while (true) {
            val slot = snapshot[index]
            if (slot == EMPTY) return false
            if (slot == target) return true
            index = (index + 1) and mask
        }
    }

    private fun grow() {
        val larger = LongArray(table.size shl 1)
        for (slot in table) {
            if (slot != EMPTY) insert(larger, slot)
        }
        table = larger
    }

    /** True when the hash was not already present. */
    private fun insert(target: LongArray, hash: Long): Boolean {
        val mask = target.size - 1
        var index = indexFor(hash, mask)

        while (true) {
            val slot = target[index]
            if (slot == hash) return false
            if (slot == EMPTY) {
                target[index] = hash
                return true
            }
            index = (index + 1) and mask
        }
    }

    private fun indexFor(hash: Long, mask: Int): Int =
        ((hash xor (hash ushr 32)).toInt()) and mask

    companion object {
        private const val EMPTY = 0L
        private const val DEFAULT_CAPACITY = 1 shl 8

        private const val FNV_OFFSET_BASIS = -0x340d631b7bdddcdbL
        private const val FNV_PRIME = 0x100000001b3L

        private fun tableSizeFor(capacity: Int): Int {
            var size = 1
            while (size < capacity) size = size shl 1
            return size.coerceAtLeast(1 shl 4)
        }

        /**
         * FNV-1a followed by the splitmix64 finalizer. FNV alone leaves the low
         * bits weak, and those are exactly the bits the table index uses.
         */
        internal fun hash(domain: String): Long {
            var h = FNV_OFFSET_BASIS
            for (char in domain) {
                h = h xor char.code.toLong()
                h *= FNV_PRIME
            }

            h = (h xor (h ushr 30)) * -0x40a7b892e31b1a47L
            h = (h xor (h ushr 27)) * -0x6b2fb644ecceee15L
            h = h xor (h ushr 31)

            // 0 marks an empty slot, so it can never be a stored hash.
            return if (h == EMPTY) 1L else h
        }
    }
}
