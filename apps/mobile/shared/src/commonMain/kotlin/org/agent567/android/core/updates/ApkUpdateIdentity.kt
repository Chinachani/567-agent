package org.agent567.android.core.updates

internal data class ApkUpdateIdentity(val packageName: String, val versionCode: Long, val signers: Set<String>)

internal fun validateApkUpdate(installed: ApkUpdateIdentity, incoming: ApkUpdateIdentity) {
    require(incoming.packageName == installed.packageName) { "The update belongs to another application" }
    require(incoming.versionCode > installed.versionCode) { "The update is not newer than the installed application" }
    require(installed.signers.isNotEmpty() && incoming.signers == installed.signers) { "The update has a different signing identity" }
}
