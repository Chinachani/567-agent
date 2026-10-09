package org.agent567.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
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
) {
    val items =
        listOf(
            TabItem(MainTab.Home, Str.tabHome, Icons.Outlined.Home, Icons.Filled.Home),
            TabItem(MainTab.Sessions, Str.tabSessions, Icons.Outlined.ChatBubbleOutline, Icons.Filled.ChatBubbleOutline),
            TabItem(MainTab.Discover, Str.tabDiscover, Icons.Outlined.Devices, Icons.Filled.Devices),
            TabItem(MainTab.Me, Str.tabMe, Icons.Outlined.PersonOutline, Icons.Filled.PersonOutline),
        )
    NavigationBar(
        modifier = modifier.fillMaxWidth(),
        containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        items.forEach { item ->
            val selectedTab = item.tab == selected
            NavigationBarItem(
                selected = selectedTab,
                onClick = { onSelect(item.tab) },
                icon = {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            imageVector = if (selectedTab) item.selectedIcon else item.icon,
                            contentDescription = item.label,
                        )
                        Spacer(Modifier.size(4.dp))
                        if (selectedTab) {
                            Box(Modifier.size(4.dp).background(MaterialTheme.colorScheme.primary, CircleShape))
                        } else {
                            Spacer(Modifier.size(4.dp))
                        }
                    }
                },
                label = if (showLabels) {
                    { Text(item.label, style = MaterialTheme.typography.labelSmall) }
                } else {
                    null
                },
                alwaysShowLabel = showLabels,
                colors =
                    NavigationBarItemDefaults.colors(
                        selectedIconColor = MaterialTheme.colorScheme.onSurface,
                        selectedTextColor = MaterialTheme.colorScheme.onSurface,
                        unselectedIconColor = MaterialTheme.agent567Extra.secondaryText,
                        unselectedTextColor = MaterialTheme.agent567Extra.secondaryText,
                        indicatorColor = Color.Transparent,
                    ),
            )
        }
    }
}

private data class TabItem(
    val tab: MainTab,
    val label: String,
    val icon: ImageVector,
    val selectedIcon: ImageVector,
)
