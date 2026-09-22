package expo.modules.freedomvpn

import android.util.Log
import java.io.DataOutputStream
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.LongBuffer
import java.nio.channels.FileChannel

/**
 * Domain membership backed by a memory-mapped file of sorted 64-bit hashes.
 *
 * Even hashed, an in-heap set of a million domains costs ~13 MB of Java heap
 * per copy, and the app keeps one for the DNS tunnel and one for the
 * accessibility matcher. Mapped, the same data:
 *
 *  - leaves the Java heap entirely, so it no longer counts against the heap
 *    limit or gets walked by GC,
 *  - is clean file-backed memory the kernel evicts under pressure instead of
 *    killing Play Services to make room,
 *  - is shared page-for-page when both engines map the same file, which dedupes
 *    the two copies without any shared mutable state between the modules.
 *
 * Lookups binary search the mapped longs: ~20 absolute reads, no allocation.
 *
 * Concurrency: only absolute `get(index)` is used, which does not touch the
 * buffer's position, so any number of threads may read one instance. The file
 * is mapped read-only and never written in place.
 */
class MappedDomainIndex private constructor(
    private val hashes: LongBuffer,
    override val size: Int,
) : DomainSet {

    override fun contains(domain: String): Boolean {
        if (domain.isEmpty() || size == 0) return false

        val target = HashedDomainSet.hash(domain)
        var low = 0
        var high = size - 1

        while (low <= high) {
            val mid = (low + high) ushr 1
            val value = hashes.get(mid)
            when {
                value < target -> low = mid + 1
                value > target -> high = mid - 1
                else -> return true
            }
        }
        return false
    }

    companion object {
        private const val TAG = "MappedDomainIndex"

        /** Bumped if the layout ever changes, so stale files rebuild instead of misreading. */
        private const val MAGIC = 0x4C41494E44583031L
        private const val HEADER_BYTES = 16L

        /**
         * Write [domains] to [target] as sorted, deduplicated hashes.
         * Returns the number of distinct domains written, or -1 on failure.
         *
         * The sort needs the hashes in memory — 8 MB per million — but only for
         * the length of the build, against holding the set for the whole run.
         */
        fun build(domains: Sequence<String>, target: File, normalize: (String) -> String): Int {
            return try {
                var values = LongArray(1 shl 12)
                var count = 0

                domains.forEach { raw ->
                    val normalized = normalize(raw)
                    if (normalized.isNotEmpty()) {
                        if (count == values.size) values = values.copyOf(values.size shl 1)
                        values[count++] = HashedDomainSet.hash(normalized)
                    }
                }

                java.util.Arrays.sort(values, 0, count)

                // Collapse duplicates in place; the text files can hold repeats
                // because each sync batch appends to them.
                var unique = 0
                for (i in 0 until count) {
                    if (i == 0 || values[i] != values[i - 1]) {
                        values[unique++] = values[i]
                    }
                }

                val temporary = File(target.absolutePath + ".tmp")
                DataOutputStream(temporary.outputStream().buffered()).use { out ->
                    out.writeLong(MAGIC)
                    out.writeLong(unique.toLong())
                    for (i in 0 until unique) out.writeLong(values[i])
                }
                // Replace atomically: a half-written index must never be mapped.
                if (!temporary.renameTo(target)) {
                    temporary.delete()
                    return -1
                }

                Log.i(TAG, "Built index ${target.name}: $unique domains")
                unique
            } catch (e: Exception) {
                Log.w(TAG, "Failed to build index ${target.name}: ${e.message}")
                -1
            }
        }

        /** Map an index written by [build], or null when absent or unreadable. */
        fun open(file: File): MappedDomainIndex? {
            if (!file.exists() || file.length() < HEADER_BYTES) return null
            return try {
                RandomAccessFile(file, "r").use { handle ->
                    val mapped: ByteBuffer = handle.channel.map(
                        FileChannel.MapMode.READ_ONLY, 0, handle.length()
                    )
                    if (mapped.long != MAGIC) {
                        Log.w(TAG, "Index ${file.name} has a stale layout; ignoring")
                        return null
                    }
                    val count = mapped.long
                    val expected = HEADER_BYTES + count * 8
                    if (count < 0 || expected != handle.length()) {
                        Log.w(TAG, "Index ${file.name} is truncated; ignoring")
                        return null
                    }
                    // The mapping outlives the RandomAccessFile handle by design.
                    MappedDomainIndex(mapped.slice().asLongBuffer(), count.toInt())
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to map index ${file.name}: ${e.message}")
                null
            }
        }
    }
}
