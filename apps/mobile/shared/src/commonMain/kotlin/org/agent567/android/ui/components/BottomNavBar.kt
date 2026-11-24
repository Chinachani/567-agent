package org.agent567.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.PersonOutline
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material3.HorizontalDivider
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.navigation.MainTab
import org.agent567.android.ui.theme.agent567Extra

@Composable
fun Agent567BottomBar(
    selected: MainTab,
    onSelect: (MainTab) -> Unit,
    showLabels: Boolean = true,
    modifier: Modifier = Modifier,
    attentionCount: Int = 0,
) {
    val items =
        listOf(
            TabItem(MainTab.Home, Str.tabHome, Icons.Outlined.Home, Icons.Filled.Home),
            TabItem(MainTab.Sessions, Str.tabSessions, Icons.Outlined.ChatBubbleOutline, Icons.Filled.ChatBubbleOutline),
            TabItem(MainTab.Discover, Str.tabDiscover, Icons.Outlined.Devices, Icons.Filled.Devices),
            TabItem(MainTab.Me, Str.tabMe, Icons.Outlined.PersonOutline, Icons.Filled.PersonOutline),
        )
    Column(modifier.fillMaxWidth()) {
        HorizontalDivider(color = MaterialTheme.agent567Extra.border)
        NavigationBar(
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
            tonalElevation = 0.dp,
        ) {
            items.forEach { item ->
                val selectedTab = item.tab == selected
                NavigationBarItem(
                    selected = selectedTab,
                    modifier = if (item.tab == MainTab.Home && attentionCount > 0) Modifier.semantics { stateDescription = "${Str.taskCenterTitle}：$attentionCount" } else Modifier,
                    onClick = { onSelect(item.tab) },
                    icon = {
                        Box {
                            Icon(
                                imageVector = if (selectedTab) item.selectedIcon else item.icon,
                                contentDescription = if (showLabels) null else item.label,
                                modifier = Modifier.size(22.dp),
                            )
                            if (item.tab == MainTab.Home && attentionCount > 0) {
                                Box(
                                    modifier =
                                        Modifier
                                            .align(Alignment.TopEnd)
                                            .offset(x = 3.dp, y = (-2).dp)
                                            .size(7.dp)
                                            .clip(CircleShape)
                                            .background(MaterialTheme.agent567Extra.amberAccent),
                                )
                            }
                        }
                    },
                    label = if (showLabels) {
                        { Text(item.label, style = MaterialTheme.typography.labelMedium, fontWeight = if (selectedTab) FontWeight.SemiBold else FontWeight.Normal) }
                    } else null,
                    alwaysShowLabel = showLabels,
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = MaterialTheme.agent567Extra.amberAccent,
                        selectedTextColor = MaterialTheme.colorScheme.onSurface,
                        unselectedIconColor = MaterialTheme.agent567Extra.secondaryText,
                        unselectedTextColor = MaterialTheme.agent567Extra.secondaryText,
                        indicatorColor = MaterialTheme.agent567Extra.amberContainer,
                    ),
                )
            }
        }
    }
}

private data class TabItem(
    val tab: MainTab,
    val label: String,
    val icon: ImageVector,
    val selectedIcon: ImageVector,
)
