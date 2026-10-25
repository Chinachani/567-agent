package org.agent567.android.ui

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.agent567.android.domain.remote.RemotePointerPosition
import org.agent567.android.domain.remote.RemoteViewTransform
import org.agent567.android.ui.remote.RemoteFullscreenOrientation
import org.agent567.android.ui.remote.RemoteTouchLayer
import org.agent567.android.ui.remote.RemoteFullscreenToolbar
import org.agent567.android.ui.remote.RemoteKeyboardShortcuts
import org.junit.Rule
import org.junit.runner.RunWith
import kotlin.test.*

@RunWith(AndroidJUnit4::class)
class RemoteTouchScreenTest {
    @get:Rule val composeRule = createAndroidComposeRule<ComponentActivity>()
    private data class Input(val type: String, val position: RemotePointerPosition, val button: String?, val action: String?)
    private val inputs = mutableListOf<Input>()
    private val scrolls = mutableListOf<Pair<Float, Float>>()
    private val relativeMoves = mutableListOf<Pair<Float, Float>>()
    private var transform by mutableStateOf(RemoteViewTransform())

    private fun showControls(relative: Boolean = false) {
        composeRule.setContent {
            RemoteTouchLayer(1920, 1080, transform, { transform = it },
                { t, p, b, a -> inputs += Input(t, p, b, a) }, { x, y -> scrolls += x to y }, { _, _ -> },
                Modifier.size(300.dp, 200.dp).testTag("remote"), trackpadMode = relative,
                onRelativePointer = { x, y -> relativeMoves += x to y })
        }
    }

    @Test fun waylandTouchpadMovesWithoutHoldingAButtonAndHoldThenSlideDrags() {
        showControls(relative = true)
        composeRule.onNodeWithTag("remote").performTouchInput { swipe(Offset(centerX - 40, centerY), Offset(centerX + 40, centerY), 200) }
        composeRule.runOnIdle { assertTrue(relativeMoves.any { it.first > 0 }); assertTrue(inputs.isEmpty()); relativeMoves.clear() }
        composeRule.onNodeWithTag("remote").performTouchInput { down(center); advanceEventTime(800); moveTo(Offset(centerX + 60, centerY)); up() }
        composeRule.runOnIdle { assertEquals(listOf("down", "up"), inputs.map { it.action }); assertTrue(relativeMoves.isNotEmpty()) }
    }

    @Test fun fullscreenControlsStartCollapsedAndExposeHelpAndExitOnDemand() {
        var exited = false
        composeRule.setContent {
            RemoteFullscreenToolbar(true, false, true, "5 ms", "1920×1080", { exited = true }, {}, {}, {})
        }
        composeRule.onNodeWithText("退出全屏").assertDoesNotExist()
        composeRule.onNodeWithText("展开操控栏 ▾").performClick()
        composeRule.onNodeWithText("触控板").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("操作说明").performScrollTo().performClick()
        composeRule.onNodeWithText("知道了").performClick()
        composeRule.onNodeWithText("收起").performScrollTo().performClick()
        composeRule.onNodeWithText("退出全屏").assertDoesNotExist()
        composeRule.onNodeWithText("展开操控栏 ▾").performClick()
        composeRule.onNodeWithText("退出全屏").performScrollTo().performClick()
        composeRule.runOnIdle { assertTrue(exited) }
    }

    @Test fun keyboardShortcutsSendOrderedPressAndReleaseEvents() {
        val keys = mutableListOf<Pair<String, String>>()
        composeRule.setContent { RemoteKeyboardShortcuts { key, action -> keys += key to action } }
        composeRule.onNodeWithText("Tab").performClick()
        composeRule.onNodeWithText("Ctrl+V").performScrollTo().performClick()
        composeRule.runOnIdle {
            assertEquals(listOf("Tab" to "down", "Tab" to "up", "ControlLeft" to "down", "KeyV" to "down", "KeyV" to "up", "ControlLeft" to "up"), keys)
        }
    }

    @Test fun aTapAndADragSendDistinctCompleteMouseGestures() {
        showControls()
        composeRule.onNodeWithTag("remote").performTouchInput { click(center) }
        composeRule.runOnIdle { assertEquals(listOf("down", "up"), inputs.map { it.action }); inputs.clear() }
        composeRule.onNodeWithTag("remote").performTouchInput { swipe(Offset(centerX - 60, centerY), Offset(centerX + 60, centerY)) }
        composeRule.runOnIdle {
            assertEquals("down", inputs.first().action)
            assertEquals("up", inputs.last().action)
            assertTrue(inputs.any { it.type == "pointer.move" })
            assertTrue(inputs.last().position.x > inputs.first().position.x)
        }
    }

    @Test fun pinchAndPanNeverSendRemoteClicksAndNextTapUsesZoomedCoordinates() {
        showControls()
        composeRule.onNodeWithTag("remote").performTouchInput {
            down(0, Offset(centerX - 40, centerY)); down(1, Offset(centerX + 40, centerY))
            moveTo(0, Offset(centerX - 80, centerY)); moveTo(1, Offset(centerX + 80, centerY))
            up(0); moveTo(1, Offset(centerX + 90, centerY)); up(1)
        }
        composeRule.runOnIdle { assertTrue(transform.scale > 1f); assertTrue(inputs.isEmpty()); assertTrue(scrolls.isEmpty()) }
        composeRule.onNodeWithTag("remote").performTouchInput { click(center) }
        composeRule.runOnIdle { assertEquals(2, inputs.size); assertTrue(inputs.first().position.x in 0f..1f) }
    }

    @Test fun cancelledDragReleasesTheMouseAndBlackMarginsIgnoreTaps() {
        showControls()
        composeRule.onNodeWithTag("remote").performTouchInput { click(Offset(centerX, 1f)) }
        composeRule.runOnIdle { assertTrue(inputs.isEmpty()) }
        composeRule.onNodeWithTag("remote").performTouchInput {
            down(center); moveTo(Offset(centerX + 80, centerY)); cancel()
        }
        composeRule.runOnIdle { assertEquals("down", inputs.first().action); assertEquals("up", inputs.last().action) }
    }

    @Test fun addingASecondFingerReleasesAnExistingDragWithoutAnotherClick() {
        showControls()
        composeRule.onNodeWithTag("remote").performTouchInput {
            down(0, center); moveTo(0, Offset(centerX + 50, centerY))
            down(1, Offset(centerX - 50, centerY)); moveTo(1, Offset(centerX - 80, centerY))
            up(1); moveTo(0, Offset(centerX + 90, centerY)); up(0)
        }
        composeRule.runOnIdle { assertEquals(listOf("down", "up"), inputs.filter { it.type == "pointer.button" }.map { it.action }) }
    }

    @Test fun twoFingerSlideScrollsWithoutClicksAndLiftingOneFingerCannotClick() {
        showControls()
        composeRule.onNodeWithTag("remote").performTouchInput {
            down(0, Offset(centerX - 30, centerY + 30)); down(1, Offset(centerX + 30, centerY + 30))
            updatePointerTo(0, Offset(centerX - 30, centerY - 40))
            updatePointerTo(1, Offset(centerX + 30, centerY - 40))
            move()
            up(1); moveTo(0, Offset(centerX - 30, centerY - 60)); up(0)
        }
        composeRule.runOnIdle { assertTrue(scrolls.any { it.second > 0 }); assertTrue(inputs.none { it.type == "pointer.button" }); assertEquals(RemoteViewTransform(), transform) }
        composeRule.onNodeWithTag("remote").performTouchInput { click(center) }
        composeRule.runOnIdle { assertEquals(listOf("down", "up"), inputs.filter { it.type == "pointer.button" }.map { it.action }) }
    }

    @Test fun relativeOnlyHostExplainsWhyDirectTouchIsUnavailable() {
        composeRule.setContent { RemoteFullscreenToolbar(true, false, false, "5 ms", "", {}, {}, {}, {}) }
        composeRule.onNodeWithText("展开操控栏 ▾").performClick()
        composeRule.onNodeWithText("触控板").performClick()
        composeRule.onNodeWithText(org.agent567.android.ui.i18n.Str.remoteDirectUnavailable).assertIsDisplayed()
        composeRule.onNodeWithText("直接触控 · 点击画面位置，直接操作对应内容").assertIsNotEnabled()
    }

    @Test fun threeFingerPanMovesOnlyTheZoomedView() {
        transform = RemoteViewTransform(scale = 2f)
        showControls()
        composeRule.onNodeWithTag("remote").performTouchInput {
            down(0, Offset(centerX - 40, centerY)); down(1, Offset(centerX, centerY)); down(2, Offset(centerX + 40, centerY))
            updatePointerTo(0, Offset(centerX - 10, centerY + 20))
            updatePointerTo(1, Offset(centerX + 30, centerY + 20))
            updatePointerTo(2, Offset(centerX + 70, centerY + 20)); move()
            up(2); up(1); up(0)
        }
        composeRule.runOnIdle { assertTrue(transform.panX > 0); assertTrue(inputs.isEmpty()); assertTrue(scrolls.isEmpty()) }
    }

    @Test fun absoluteHostOffersDirectTouchAsAnExplicitChoice() {
        var direct by mutableStateOf(false)
        composeRule.setContent { RemoteFullscreenToolbar(false, direct, false, "5 ms", "", {}, { direct = it }, {}, {}) }
        composeRule.onNodeWithText("展开操控栏 ▾").performClick()
        composeRule.onNodeWithText("触控板").performClick()
        composeRule.onNodeWithText("直接触控 · 点击画面位置，直接操作对应内容").performClick()
        composeRule.onNodeWithText("直接触控").assertIsDisplayed()
        composeRule.runOnIdle { assertTrue(direct) }
    }

    @Test fun aLongPressOffersTheRemoteRightButton() {
        showControls()
        composeRule.onNodeWithTag("remote").performTouchInput { down(center); advanceEventTime(800); up() }
        composeRule.runOnIdle { assertEquals(listOf("right", "right"), inputs.map { it.button }); assertEquals(listOf("down", "up"), inputs.map { it.action }) }
    }

    @Test fun fullscreenRequestsLandscapeAndRestoresThePreviousOrientation() {
        val previous = composeRule.activity.requestedOrientation
        var fullscreen by mutableStateOf(false)
        composeRule.setContent {
            if (fullscreen) RemoteFullscreenOrientation()
            Button(onClick = { fullscreen = !fullscreen }) { Text(if (fullscreen) "Leave" else "Enter") }
        }
        composeRule.onNodeWithText("Enter").performClick()
        composeRule.waitUntil(10_000) { composeRule.activity.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE }
        composeRule.runOnIdle { assertEquals(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE, composeRule.activity.requestedOrientation) }
        composeRule.onNodeWithText("Leave").performClick()
        composeRule.runOnIdle { assertEquals(previous, composeRule.activity.requestedOrientation) }
    }
}
