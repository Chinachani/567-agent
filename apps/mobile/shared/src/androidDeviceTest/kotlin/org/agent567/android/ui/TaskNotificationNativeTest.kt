package org.agent567.android.ui

import android.app.Notification
import android.app.NotificationManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.agent567.android.domain.notifications.TaskNotice
import org.agent567.android.domain.notifications.TaskNoticeKind
import org.agent567.android.ui.notifications.TASK_NOTIFICATION_SESSION_EXTRA
import org.agent567.android.ui.notifications.postTaskNotification
import org.junit.Rule
import org.junit.runner.RunWith
import kotlin.test.*

class NotificationTargetTestActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        received = intent
        instance = this
    }
    companion object {
        @Volatile var received: Intent? = null
        @Volatile var instance: NotificationTargetTestActivity? = null
    }
}

@RunWith(AndroidJUnit4::class)
class TaskNotificationNativeTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun replacesTheSameSessionNoticeOpensItsExactTargetAndHonorsPermissionDenial() {
        val context = rule.activity
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val manager = context.getSystemService(NotificationManager::class.java)
        NotificationTargetTestActivity.received = null
        val intent = Intent(context, NotificationTargetTestActivity::class.java)
        try {
            automation.grantRuntimePermission(context.packageName, android.Manifest.permission.POST_NOTIFICATIONS)
            postTaskNotification(context, TaskNotice("session-7", TaskNoticeKind.NeedsInput), intent)
            postTaskNotification(context, TaskNotice("session-7", TaskNoticeKind.Completed), intent)
            rule.waitUntil(5_000) { manager.activeNotifications.size == 1 && manager.activeNotifications.single().notification.extras.getString(Notification.EXTRA_TITLE) == org.agent567.android.ui.i18n.Str.taskNoticeCompleted }
            val notifications = manager.activeNotifications
            assertEquals(1, notifications.size)
            assertEquals("session-7", notifications.single().tag)
            assertEquals(Notification.VISIBILITY_PRIVATE, notifications.single().notification.visibility)
            notifications.single().notification.contentIntent.send()
            rule.waitUntil(5_000) { NotificationTargetTestActivity.received != null }
            assertEquals("session-7", NotificationTargetTestActivity.received?.getStringExtra(TASK_NOTIFICATION_SESSION_EXTRA))
            manager.cancelAll()
            rule.waitUntil(5_000) { manager.activeNotifications.isEmpty() }
            // Revoking the instrumentation UID would kill this test process on Android.
            // Fake only that OS permission boundary; the allowed branch above uses real notifications.
            var permissionChecks = 0
            val denied = object : android.content.ContextWrapper(context) {
                override fun checkPermission(permission: String, pid: Int, uid: Int): Int {
                    if (permission == android.Manifest.permission.POST_NOTIFICATIONS) { permissionChecks++; return android.content.pm.PackageManager.PERMISSION_DENIED }
                    return super.checkPermission(permission, pid, uid)
                }
            }
            postTaskNotification(denied, TaskNotice("denied", TaskNoticeKind.Interrupted), intent)
            assertTrue(permissionChecks > 0)
            assertTrue(manager.activeNotifications.isEmpty())
        } finally {
            manager.cancelAll()
            InstrumentationRegistry.getInstrumentation().runOnMainSync { NotificationTargetTestActivity.instance?.finish() }
        }
    }
}
