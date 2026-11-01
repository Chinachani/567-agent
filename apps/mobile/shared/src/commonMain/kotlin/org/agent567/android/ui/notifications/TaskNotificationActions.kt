package org.agent567.android.ui.notifications

import androidx.compose.runtime.Composable
import org.agent567.android.domain.notifications.TaskNotifications

interface TaskNotificationActions {
    fun requestPermission()
    fun dismiss(sessionId: String)
}

@Composable
expect fun rememberTaskNotificationActions(notifications: TaskNotifications): TaskNotificationActions
