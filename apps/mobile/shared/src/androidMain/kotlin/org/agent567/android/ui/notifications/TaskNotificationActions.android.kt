package org.agent567.android.ui.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.agent567.android.domain.notifications.TaskNotice
import org.agent567.android.ui.i18n.Str
import org.agent567.android.domain.notifications.TaskNoticeKind
import org.agent567.android.domain.notifications.TaskNotifications

const val TASK_NOTIFICATION_SESSION_EXTRA = "agent567.task.session"
private const val CHANNEL = "agent567_tasks_v1"

@Composable
actual fun rememberTaskNotificationActions(notifications: TaskNotifications): TaskNotificationActions {
    val context = LocalContext.current.applicationContext
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(context, notifications) { notifications.notices.collect { postTaskNotification(context, it) } }
    return remember(context, permission) { object : TaskNotificationActions {
        override fun requestPermission() {
            val preferences = context.getSharedPreferences("task-notifications", Context.MODE_PRIVATE)
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED && !preferences.getBoolean("permission_asked", false)) {
                preferences.edit().putBoolean("permission_asked", true).apply()
                permission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        override fun dismiss(sessionId: String) { NotificationManagerCompat.from(context).cancel(sessionId, 567) }
    } }
}

internal fun postTaskNotification(context: Context, notice: TaskNotice, launchIntent: Intent? = context.packageManager.getLaunchIntentForPackage(context.packageName)) {
    if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(CHANNEL, Str.taskNotificationChannel, NotificationManager.IMPORTANCE_DEFAULT))
    val intent = launchIntent?.let(::Intent) ?: return
    intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    intent.putExtra(TASK_NOTIFICATION_SESSION_EXTRA, notice.sessionId)
    // Unique data avoids PendingIntent hash collisions between conversations.
    intent.data = android.net.Uri.Builder().scheme("agent567").authority("task").appendPath(notice.sessionId).build()
    val pending = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val title = when (notice.kind) { TaskNoticeKind.NeedsInput -> Str.taskNoticeNeedsInput; TaskNoticeKind.Completed -> Str.taskNoticeCompleted; TaskNoticeKind.Interrupted -> Str.taskNoticeInterrupted }
    val notification = NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle(title).setContentText(Str.taskNoticeOpen)
        .setContentIntent(pending).setAutoCancel(true).setOnlyAlertOnce(true)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build()
    runCatching { manager.notify(notice.sessionId, 567, notification) }
}
