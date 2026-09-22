package expo.modules.freedomvpn

import java.io.File
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class MappedDomainIndexTest {

    private val dir =
        File(System.getProperty("java.io.tmpdir"), "la-index-${System.nanoTime()}").apply { mkdirs() }

    @AfterTest
    fun cleanup() {
        dir.deleteRecursively()
    }

    private fun identity(value: String) = value.trim()

    @Test
    fun everyBuiltDomainIsFoundAfterMapping() {
        val target = File(dir, "adult.idx")
        val domains = (0 until 30_000).map { "site$it.example.com" }

        val written = MappedDomainIndex.build(domains.asSequence(), target, ::identity)
        assertEquals(30_000, written)

        val index = assertNotNull(MappedDomainIndex.open(target))
        assertEquals(30_000, index.size)
        domains.forEach { assertTrue(index.contains(it), "missing $it") }
    }

    @Test
    fun unrelatedDomainsAreNotFound() {
        val target = File(dir, "blocked.idx")
        MappedDomainIndex.build(
            (0 until 10_000).map { "blocked$it.com" }.asSequence(), target, ::identity
        )

        val index = assertNotNull(MappedDomainIndex.open(target))
        for (i in 0 until 10_000) {
            assertFalse(index.contains("allowed$i.com"), "false positive on allowed$i.com")
        }
    }

    @Test
    fun duplicatesCollapseAndEmptyEntriesAreDropped() {
        // Sync batches append to the text files, so the same domain can appear
        // more than once, and normalize() rejects entries by returning "".
        val target = File(dir, "dupes.idx")
        val written = MappedDomainIndex.build(
            sequenceOf("a.com", "a.com", "", "  ", "b.com"), target, ::identity
        )

        assertEquals(2, written)
        val index = assertNotNull(MappedDomainIndex.open(target))
        assertEquals(2, index.size)
        assertTrue(index.contains("a.com"))
        assertTrue(index.contains("b.com"))
    }

    @Test
    fun normalizationIsAppliedAtBuildTime() {
        val target = File(dir, "normalized.idx")
        MappedDomainIndex.build(
            sequenceOf("EXAMPLE.com"), target
        ) { it.trim().lowercase() }

        val index = assertNotNull(MappedDomainIndex.open(target))
        assertTrue(index.contains("example.com"))
        assertFalse(index.contains("EXAMPLE.com"), "lookups pass already-normalized domains")
    }

    @Test
    fun openRejectsMissingAndCorruptFiles() {
        assertNull(MappedDomainIndex.open(File(dir, "absent.idx")))

        val empty = File(dir, "empty.idx").apply { writeBytes(ByteArray(0)) }
        assertNull(MappedDomainIndex.open(empty))

        // A header claiming more entries than the file holds must be refused
        // rather than mapped and read past the end.
        val truncated = File(dir, "truncated.idx")
        MappedDomainIndex.build(sequenceOf("a.com", "b.com"), truncated, ::identity)
        val bytes = truncated.readBytes()
        truncated.writeBytes(bytes.copyOf(bytes.size - 8))
        assertNull(MappedDomainIndex.open(truncated))

        val garbage = File(dir, "garbage.idx").apply { writeBytes(ByteArray(64) { 7 }) }
        assertNull(MappedDomainIndex.open(garbage))
    }

    @Test
    fun anEmptyIndexMatchesNothing() {
        val target = File(dir, "none.idx")
        assertEquals(0, MappedDomainIndex.build(emptySequence(), target, ::identity))

        val index = assertNotNull(MappedDomainIndex.open(target))
        assertEquals(0, index.size)
        assertFalse(index.contains("anything.com"))
    }
}
