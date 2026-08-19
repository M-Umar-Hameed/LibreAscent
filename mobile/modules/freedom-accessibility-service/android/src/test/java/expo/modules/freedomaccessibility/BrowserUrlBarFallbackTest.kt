package expo.modules.freedomaccessibility

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Covers the first-match rule the URL bar id scan uses. The lookup stands in for
 * findUrlByResourceId, which returns null both for an id that is absent and for
 * an id that is present but carries no usable text.
 */
class BrowserUrlBarFallbackTest {

    private val ids = listOf("url_bar", "location_bar_edit_text", "url_field")

    @Test
    fun firstIdWithTextWins() {
        val result = BrowserUrlMonitor.firstUrlBarMatch(ids) { id ->
            if (id == "url_bar") "example.com" else "other.com"
        }

        assertEquals("example.com", result)
    }

    @Test
    fun presentButEmptyIdDoesNotShortCircuitRemainingFallbacks() {
        val visited = mutableListOf<String>()

        // "url_bar" exists on screen but is blank or focused-and-empty, so the
        // lookup yields null and the scan must continue rather than give up.
        val result = BrowserUrlMonitor.firstUrlBarMatch(ids) { id ->
            visited.add(id)
            if (id == "url_field") "example.com" else null
        }

        assertEquals("example.com", result)
        assertEquals(listOf("url_bar", "location_bar_edit_text", "url_field"), visited)
    }

    @Test
    fun scanStopsAtTheFirstMatchInsteadOfRunningEveryId() {
        val visited = mutableListOf<String>()

        BrowserUrlMonitor.firstUrlBarMatch(ids) { id ->
            visited.add(id)
            if (id == "location_bar_edit_text") "example.com" else null
        }

        assertEquals(listOf("url_bar", "location_bar_edit_text"), visited)
    }

    @Test
    fun noIdWithTextYieldsNull() {
        assertNull(BrowserUrlMonitor.firstUrlBarMatch(ids) { null })
    }
}
