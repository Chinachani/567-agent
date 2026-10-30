package org.agent567.android.core.updates

import kotlin.test.*

class ApkUpdateIdentityTest {
    private val installed = ApkUpdateIdentity("com.api567.agent", 10500, setOf("release-signer"))

    @Test fun aNewerPackageWithTheCurrentIdentityCanBeOfferedForSystemInstallation() {
        validateApkUpdate(installed, installed.copy(versionCode = 10501))
    }

    @Test fun foreignPackagesDowngradesAndUnprovenSigningIdentitiesAreRejected() {
        for (candidate in listOf(
            installed.copy(packageName = "com.api567.agent.test", versionCode = 10501),
            installed, installed.copy(versionCode = 10400),
            installed.copy(versionCode = 10501, signers = setOf("debug-signer")),
            installed.copy(versionCode = 10501, signers = emptySet()),
        )) assertFailsWith<IllegalArgumentException> { validateApkUpdate(installed, candidate) }
    }
}
