package expo.modules.freedomvpn

/**
 * Membership test over a set of normalized domains.
 *
 * Two implementations: [HashedDomainSet] fills in memory while a sync streams
 * batches in, and [MappedDomainIndex] maps a prebuilt file for the steady state
 * after a restart, which is where the app spends nearly all of its life.
 */
interface DomainSet {
    fun contains(domain: String): Boolean
    val size: Int
}
