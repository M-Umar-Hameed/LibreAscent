package expo.modules.freedomvpn

import android.content.Context
import android.util.Log
import java.io.File
import java.io.FileOutputStream

/**
 * Keeps the VPN blocklist on disk so a tunnel started without the JS layer still
 * blocks. VpnWatchdog and the boot receiver start the service with no app
 * process behind them, which otherwise produced a healthy-looking tunnel that
 * resolved every blocked domain.
 *
 * The accessibility module's category files cannot be reused: ads is VPN-only
 * and never reaches the matcher, so it has no file there.
 */
object BlocklistPersistence {

    private const val TAG = "BlocklistStore"
    private const val DIR = "vpn_blocklist"
    private const val CATEGORY_PREFIX = "category_"
    private const val CATEGORY_SUFFIX = ".txt"
    private const val INDEX_SUFFIX = ".idx"
    private const val STAGING_SUFFIX = ".tmp"
    private const val USER_FILE = "user_domains.txt"
    private const val WHITELIST_FILE = "whitelist.txt"


    private fun dir(context: Context): File =
        File(context.filesDir, DIR).apply { if (!exists()) mkdirs() }

    private fun categoryFile(dir: File, name: String): File =
        File(dir, "$CATEGORY_PREFIX$name$CATEGORY_SUFFIX")

    /**
     * Sorted-hash index built from the text file above. Held off the Java heap
     * through a read-only mapping; see MappedDomainIndex. Skipped by [load]'s
     * directory scan, which only matches the .txt suffix.
     */
    private fun indexFile(dir: File, name: String): File =
        File(dir, "$CATEGORY_PREFIX$name$INDEX_SUFFIX")

    // Batches land here and finalizeCategory renames the file into place, as
    // ContentMatcher does. Writing the live file directly meant a kill mid-sync
    // left a partial category that the next tunnel start loaded as complete.
    // load() never matches this suffix.
    private fun stagingFile(dir: File, name: String): File =
        File(dir, "$CATEGORY_PREFIX$name$CATEGORY_SUFFIX$STAGING_SUFFIX")

    /** Mirrors DomainBlocklist.addCategory: [replace] truncates, otherwise appends. */
    fun saveCategory(context: Context, name: String, domains: List<String>, replace: Boolean) =
        saveCategory(dir(context), name, domains, replace)

    internal fun saveCategory(dir: File, name: String, domains: List<String>, replace: Boolean) {
        try {
            FileOutputStream(stagingFile(dir, name), !replace).bufferedWriter().use { writer ->
                domains.forEach { domain ->
                    writer.write(domain)
                    writer.newLine()
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to save category $name: ${e.message}")
        }
    }

    /** Publish the batches saved since the last replace as the category's file. */
    fun finalizeCategory(context: Context, name: String) = finalizeCategory(dir(context), name)

    internal fun finalizeCategory(dir: File, name: String) {
        val staged = stagingFile(dir, name)
        if (!staged.exists()) return
        val live = categoryFile(dir, name)
        // rename(2) replaces the target atomically on Android. The delete is the
        // fallback for platforms whose rename refuses an existing target.
        if (!staged.renameTo(live) && !(live.delete() && staged.renameTo(live))) {
            Log.w(TAG, "Could not publish category $name")
            return
        }
        // Rebuilt from the new file on the next load, once per sync rather
        // than once per batch.
        indexFile(dir, name).delete()
    }

    /** Whether a finalized copy of [name] is on disk for the next tunnel start. */
    fun hasCategory(context: Context, name: String): Boolean =
        categoryFile(dir(context), name).exists()

    fun deleteCategory(context: Context, name: String) = deleteCategory(dir(context), name)

    internal fun deleteCategory(dir: File, name: String) {
        try {
            categoryFile(dir, name).delete()
            indexFile(dir, name).delete()
            stagingFile(dir, name).delete()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to delete category $name: ${e.message}")
        }
    }

    fun saveUserDomains(context: Context, domains: List<String>) =
        saveList(context, USER_FILE, domains)

    fun saveWhitelist(context: Context, domains: List<String>) =
        saveList(context, WHITELIST_FILE, domains)

    private fun saveList(context: Context, fileName: String, domains: List<String>) {
        try {
            File(dir(context), fileName).bufferedWriter().use { writer ->
                domains.forEach { domain ->
                    writer.write(domain)
                    writer.newLine()
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to save $fileName: ${e.message}")
        }
    }

    /** Refill [blocklist] from disk, before the tunnel is established. */
    fun load(context: Context, blocklist: DomainBlocklist) = load(dir(context), blocklist)

    internal fun load(root: File, blocklist: DomainBlocklist) {
        try {
            root.listFiles()?.forEach { file ->
                val name = file.name
                when {
                    name.startsWith(CATEGORY_PREFIX) && name.endsWith(CATEGORY_SUFFIX) -> {
                        val category = name
                            .removePrefix(CATEGORY_PREFIX)
                            .removeSuffix(CATEGORY_SUFFIX)
                        loadCategory(file, category, blocklist)
                    }
                    name == USER_FILE -> {
                        if (!blocklist.setDomainsIfAbsent(readLines(file))) {
                            Log.i(TAG, "User domains already pushed; skipping disk copy")
                        }
                    }
                    name == WHITELIST_FILE -> {
                        if (!blocklist.setWhitelistIfAbsent(readLines(file))) {
                            Log.i(TAG, "Whitelist already pushed; skipping disk copy")
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to load blocklist: ${e.message}")
        }
    }

    // Built off to the side and installed in one step, never appended into the
    // live set: a JS push can start mid-read, and it must win.
    private fun loadCategory(file: File, category: String, blocklist: DomainBlocklist) {
        val parent = file.parentFile
        val index = if (parent != null) indexFile(parent, category) else null

        if (index != null) {
            if (!index.exists()) {
                file.bufferedReader().useLines { lines ->
                    MappedDomainIndex.build(lines, index) { blocklist.normalizeDomain(it) }
                }
            }
            val mapped = MappedDomainIndex.open(index)
            if (mapped != null) {
                if (!blocklist.putCategoryIfAbsent(category, mapped)) {
                    Log.i(TAG, "Category $category already pushed; skipping disk copy")
                }
                return
            }
        }

        // Index unavailable (build failed, or no parent directory): fall back to
        // the in-heap copy rather than leaving the tunnel without the category.
        Log.w(TAG, "Category $category falling back to an in-heap set")
        val domains = ArrayList<String>()
        file.bufferedReader().useLines { lines ->
            lines.forEach { line -> if (line.isNotBlank()) domains.add(line) }
        }
        if (!blocklist.putCategoryIfAbsent(category, domains)) {
            Log.i(TAG, "Category $category already pushed; skipping disk copy")
        }
    }

    private fun readLines(file: File): List<String> =
        file.readLines().filter { it.isNotBlank() }
}
