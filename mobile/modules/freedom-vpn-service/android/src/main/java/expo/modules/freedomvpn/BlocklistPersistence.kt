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
    private const val USER_FILE = "user_domains.txt"
    private const val WHITELIST_FILE = "whitelist.txt"

    private const val LOAD_CHUNK = 50_000

    private fun dir(context: Context): File =
        File(context.filesDir, DIR).apply { if (!exists()) mkdirs() }

    private fun categoryFile(dir: File, name: String): File =
        File(dir, "$CATEGORY_PREFIX$name$CATEGORY_SUFFIX")

    /** Mirrors DomainBlocklist.addCategory: [replace] truncates, otherwise appends. */
    fun saveCategory(context: Context, name: String, domains: List<String>, replace: Boolean) =
        saveCategory(dir(context), name, domains, replace)

    internal fun saveCategory(dir: File, name: String, domains: List<String>, replace: Boolean) {
        try {
            FileOutputStream(categoryFile(dir, name), !replace).bufferedWriter().use { writer ->
                domains.forEach { domain ->
                    writer.write(domain)
                    writer.newLine()
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to save category $name: ${e.message}")
        }
    }

    fun deleteCategory(context: Context, name: String) {
        try {
            categoryFile(dir(context), name).delete()
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
                    name == USER_FILE -> blocklist.setDomains(readLines(file))
                    name == WHITELIST_FILE -> blocklist.setWhitelist(readLines(file))
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to load blocklist: ${e.message}")
        }
    }

    private fun loadCategory(file: File, category: String, blocklist: DomainBlocklist) {
        var first = true
        val chunk = ArrayList<String>(LOAD_CHUNK)
        file.bufferedReader().useLines { lines ->
            lines.forEach { line ->
                if (line.isNotBlank()) chunk.add(line)
                if (chunk.size >= LOAD_CHUNK) {
                    blocklist.addCategory(category, chunk, first)
                    first = false
                    chunk.clear()
                }
            }
        }
        // An empty file still replaces, or a cleared category lingers in memory.
        if (chunk.isNotEmpty() || first) {
            blocklist.addCategory(category, chunk, first)
        }
    }

    private fun readLines(file: File): List<String> =
        file.readLines().filter { it.isNotBlank() }
}
