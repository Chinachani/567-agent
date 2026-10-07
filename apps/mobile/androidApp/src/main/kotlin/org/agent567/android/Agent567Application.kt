package org.agent567.android

import android.app.Application
import org.agent567.android.app.AppContainer
import org.agent567.android.data.session.MessageImageFileSystem
import org.agent567.android.diagnostics.MobileDiagnostics

class Agent567Application : Application() {
    lateinit var appContainer: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        MobileDiagnostics.initialize(applicationContext)
        MessageImageFileSystem.initialize(applicationContext)
        appContainer = AppContainer.createDefault()
    }
}
