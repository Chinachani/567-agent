package org.agent567.android.ui.notifications

import androidx.compose.runtime.Composable
import org.agent567.android.domain.notifications.TaskNotifications

interface TaskNotificationActions {
    fun requestPermission()
    fun dismiss(sessionId: String)
}

/** The action carried by a task notification deep link. Keep this as a string
 * at the Android boundary so older notification intents remain readable. */
object TaskNotificationAction {
    const val Open = "open"
    const val Answer = "answer"
    const val Result = "result"
}

@Composable
expect fun rememberTaskNotificationActions(notifications: TaskNotifications): TaskNotificationActions
