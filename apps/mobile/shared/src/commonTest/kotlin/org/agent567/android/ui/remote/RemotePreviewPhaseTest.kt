package org.agent567.android.ui.remote

import org.agent567.android.ui.i18n.Str
import kotlin.test.Test
import kotlin.test.assertEquals

class RemotePreviewPhaseTest {
    @Test fun previewWaitsForARealFrameAndCanRecoverFromAnEndedStream() {
        assertEquals(RemotePreviewPhase.Waiting, remotePreviewPhase(Str.remoteCaptureWaiting, false))
        assertEquals(RemotePreviewPhase.Waiting, remotePreviewPhase(null, false))
        assertEquals(RemotePreviewPhase.Ready, remotePreviewPhase(null, true))
        assertEquals(RemotePreviewPhase.Failed, remotePreviewPhase(Str.remoteCaptureRevoked, true))
        assertEquals(RemotePreviewPhase.Waiting, remotePreviewPhase(Str.remoteCaptureWaiting, false))
        assertEquals(RemotePreviewPhase.Ready, remotePreviewPhase(null, true))
    }
}
