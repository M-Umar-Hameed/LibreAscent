package expo.modules.freedomvpn

import kotlin.test.Test
import kotlin.test.assertContains

class FreedomVpnServiceTest {
    @Test
    fun defaultBypassedPackagesIncludeWhatsAppVariants() {
        assertContains(FreedomVpnService.DEFAULT_BYPASSED_PACKAGES, "com.whatsapp")
        assertContains(FreedomVpnService.DEFAULT_BYPASSED_PACKAGES, "com.whatsapp.w4b")
    }
}
