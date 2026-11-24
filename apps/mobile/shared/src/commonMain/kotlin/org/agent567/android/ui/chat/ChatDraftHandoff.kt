package org.agent567.android.ui.chat

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlin.random.Random
import org.agent567.android.core.model.ChatRole
import org.agent567.android.domain.conversation.REMOTE_DRAFT_MAX_CHARS
import org.agent567.android.domain.conversation.REMOTE_DRAFT_MAX_UTF8_BYTES
import org.agent567.android.domain.conversation.REMOTE_DRAFT_TOTAL_MAX_CHARS
import org.agent567.android.domain.conversation.RemoteDesktopSessionSummary
import org.agent567.android.domain.conversation.RemoteDraftTargetType
import org.agent567.android.domain.device.DesktopDevice
import org.agent567.android.domain.device.DeviceStatus
import org.agent567.android.domain.session.LocalMessage
import org.agent567.android.domain.session.MessageStatus
import org.agent567.android.domain.session.formatLocalMessageTime
import org.agent567.android.domain.session.nowEpochMs
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.agent567Extra

const val DRAFT_HANDOFF_MIN_MESSAGES = 1
const val DRAFT_HANDOFF_MAX_MESSAGES = 5

data class DraftHandoffSignature(
    val authRevision: Long,
    val owner: String,
    val localSessionId: String,
    val deviceId: String,
    val targetType: RemoteDraftTargetType,
    val targetSessionId: String?,
    val text: String,
)

data class DraftHandoffState(
    val sessionId: String? = null,
    val selectionMode: Boolean = false,
    val selectedMessageIds: List<String> = emptyList(),
    val previewOpen: Boolean = false,
    val targetType: RemoteDraftTargetType = RemoteDraftTargetType.New,
    val targetDeviceId: String? = null,
    val targetSessionId: String? = null,
    val sessionsLoading: Boolean = false,
    val availableSessions: List<RemoteDesktopSessionSummary> = emptyList(),
    val desktopSupported: Boolean? = null,
    val sending: Boolean = false,
    val error: String? = null,
    val pendingSignature: DraftHandoffSignature? = null,
    val pendingIdempotencyKey: String? = null,
    val notice: String? = null,
    val noticeNonce: Long = 0L,
)

data class DraftHandoffActions(
    val onStartSelection: (String?) -> Unit = {},
    val onToggleMessage: (String) -> Unit = {},
    val onClearSelection: () -> Unit = {},
    val onExitSelection: () -> Unit = {},
    val onOpenPreview: () -> Unit = {},
    val onDismissPreview: () -> Unit = {},
    val onSelectTargetType: (RemoteDraftTargetType) -> Unit = {},
    val onSelectTargetSession: (String) -> Unit = {},
    val onRefreshTarget: () -> Unit = {},
    val onReconnectDesktop: () -> Unit = {},
    val onConfirmSend: () -> Unit = {},
    val onConsumeNotice: () -> Unit = {},
)

fun isMessageSelectableForDraftHandoff(message: LocalMessage): Boolean =
    message.status != MessageStatus.Streaming && message.conversationText.isNotBlank()

fun formatDraftHandoffText(messages: List<LocalMessage>, selectedIds: List<String>): String {
    if (selectedIds.isEmpty()) return ""
    val selectedSet = selectedIds.toSet()
    val ordered = messages.filter { it.id in selectedSet && isMessageSelectableForDraftHandoff(it) }
    if (ordered.isEmpty()) return ""
    if (ordered.size == 1) return ordered.single().conversationText.trim()
    return ordered.joinToString("\n\n") { message ->
        val speaker = if (message.role == ChatRole.User) {
            Str.draftHandoffSpeakerUser
        } else {
            Str.draftHandoffSpeakerAssistant
        }
        "$speaker：\n${message.conversationText.trim()}"
    }
}

fun validateDraftHandoffText(text: String): String? {
    val trimmed = text.trim()
    if (trimmed.isEmpty()) return Str.draftHandoffEmpty
    if (text.length > REMOTE_DRAFT_TOTAL_MAX_CHARS ||
        trimmed.length > REMOTE_DRAFT_MAX_CHARS ||
        text.encodeToByteArray().size > REMOTE_DRAFT_MAX_UTF8_BYTES
    ) {
        return Str.draftHandoffTooLarge
    }
    return null
}

fun newDraftHandoffIdempotencyKey(): String =
    "draft-${nowEpochMs().toString(16)}-${Random.nextLong().toULong().toString(16)}-${Random.nextLong().toULong().toString(16)}"

fun resolveDraftHandoffDevice(devices: List<DesktopDevice>, preferredDeviceId: String?): DesktopDevice? {
    val online = devices.filter { it.status == DeviceStatus.Online }
    if (preferredDeviceId != null) {
        online.firstOrNull { it.id == preferredDeviceId }?.let { return it }
    }
    return online.firstOrNull()
        ?: preferredDeviceId?.let { id -> devices.firstOrNull { it.id == id } }
        ?: devices.firstOrNull()
}

@Composable
fun DraftHandoffSelectionBar(
    selectedCount: Int,
    formattedText: String,
    onCancel: () -> Unit,
    onPreviewSend: () -> Unit,
) {
    val validationError = remember(formattedText) {
        if (selectedCount == 0) null else validateDraftHandoffText(formattedText)
    }
    Surface(
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 4.dp,
        shadowElevation = 6.dp,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        text = Str.draftHandoffSelectedCount.replace("{count}", selectedCount.toString()),
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text(
                        text = when {
                            selectedCount == 0 -> Str.draftHandoffSelectHint
                            validationError != null -> validationError
                            else -> Str.draftHandoffPreviewStats
                                .replace("{count}", selectedCount.toString())
                                .replace("{chars}", formattedText.trim().length.toString())
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = if (validationError != null) MaterialTheme.colorScheme.error else MaterialTheme.agent567Extra.secondaryText,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedButton(
                    onClick = onCancel,
                    modifier = Modifier.weight(1f),
                ) {
                    Text(Str.cancel)
                }
                Button(
                    onClick = onPreviewSend,
                    enabled = selectedCount in DRAFT_HANDOFF_MIN_MESSAGES..DRAFT_HANDOFF_MAX_MESSAGES && validationError == null,
                    modifier = Modifier.weight(1.4f),
                ) {
                    Text(Str.draftHandoffPreviewSend)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DraftHandoffSheet(
    state: DraftHandoffState,
    messages: List<LocalMessage>,
    devices: List<DesktopDevice>,
    hasSavedPairing: Boolean,
    currentRemoteSessionId: String?,
    onDismiss: () -> Unit,
    onSelectTargetType: (RemoteDraftTargetType) -> Unit,
    onSelectTargetSession: (String) -> Unit,
    onRefreshTarget: () -> Unit,
    onReconnectDesktop: () -> Unit,
    onConfirmSend: () -> Unit,
) {
    val selectedMessages = remember(messages, state.selectedMessageIds) {
        val idSet = state.selectedMessageIds.toSet()
        messages.filter { it.id in idSet && isMessageSelectableForDraftHandoff(it) }
    }
    val formattedText = remember(messages, state.selectedMessageIds) {
        formatDraftHandoffText(messages, state.selectedMessageIds)
    }
    val trimmedLength = remember(formattedText) { formattedText.trim().length }
    val textValidationError = remember(formattedText) { validateDraftHandoffText(formattedText) }
    val device = remember(devices, state.targetDeviceId) {
        resolveDraftHandoffDevice(devices, state.targetDeviceId)
    }
    val deviceOnline = device?.status == DeviceStatus.Online
    val canConfirm = !state.sending &&
        deviceOnline &&
        state.desktopSupported == true &&
        textValidationError == null &&
        selectedMessages.size in DRAFT_HANDOFF_MIN_MESSAGES..DRAFT_HANDOFF_MAX_MESSAGES &&
        (state.targetType == RemoteDraftTargetType.New || !state.targetSessionId.isNullOrBlank())

    ModalBottomSheet(
        onDismissRequest = { if (!state.sending) onDismiss() },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = Str.draftHandoffSheetTitle,
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.weight(1f),
                )
                TextButton(
                    onClick = onRefreshTarget,
                    enabled = !state.sending && !state.sessionsLoading && deviceOnline,
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(Str.draftHandoffRefresh)
                }
            }

            Text(
                text = Str.draftHandoffNoAutoSendHint,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            ContextGroup {
                Text(Str.draftHandoffDeviceLabel, style = MaterialTheme.typography.titleSmall)
                when {
                    deviceOnline -> {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(device.name, style = MaterialTheme.typography.bodyMedium)
                            Text(
                                text = Str.draftHandoffDeviceOnline,
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                    device != null || hasSavedPairing -> {
                        Text(
                            text = if (device?.status == DeviceStatus.Connecting) Str.draftHandoffDeviceConnecting else Str.draftHandoffDeviceOffline,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                        if (device?.status != DeviceStatus.Connecting) {
                            OutlinedButton(onClick = onReconnectDesktop, enabled = !state.sending) {
                                Text(Str.draftHandoffReconnect)
                            }
                        }
                    }
                    else -> {
                        Text(
                            text = Str.draftHandoffNotPaired,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
                if (deviceOnline && state.desktopSupported == false) {
                    HorizontalDivider()
                    Text(
                        text = Str.draftHandoffDesktopUnsupported,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }

            ContextGroup {
                Text(Str.draftHandoffTargetSection, style = MaterialTheme.typography.titleSmall)
                DraftTargetRadioRow(
                    selected = state.targetType == RemoteDraftTargetType.New,
                    enabled = !state.sending,
                    title = Str.draftHandoffTargetNew,
                    subtitle = Str.draftHandoffTargetNewDesc,
                    onClick = { onSelectTargetType(RemoteDraftTargetType.New) },
                )
                HorizontalDivider()
                DraftTargetRadioRow(
                    selected = state.targetType == RemoteDraftTargetType.Existing,
                    enabled = !state.sending,
                    title = Str.draftHandoffTargetExisting,
                    subtitle = Str.draftHandoffTargetExistingDesc,
                    onClick = { onSelectTargetType(RemoteDraftTargetType.Existing) },
                )
                if (state.targetType == RemoteDraftTargetType.Existing) {
                    HorizontalDivider()
                    when {
                        state.sessionsLoading -> {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                modifier = Modifier.padding(vertical = 6.dp),
                            ) {
                                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                                Text(Str.draftHandoffSessionsLoading, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                        state.availableSessions.isEmpty() -> {
                            Text(
                                text = Str.draftHandoffSessionsEmpty,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(vertical = 4.dp),
                            )
                        }
                        else -> {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(max = 200.dp)
                                    .verticalScroll(rememberScrollState()),
                                verticalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                state.availableSessions.forEach { session ->
                                    val isCurrent = currentRemoteSessionId != null && session.id == currentRemoteSessionId
                                    val selected = state.targetSessionId == session.id
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clickable(enabled = !state.sending) { onSelectTargetSession(session.id) }
                                            .padding(vertical = 6.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    ) {
                                        RadioButton(
                                            selected = selected,
                                            onClick = if (state.sending) null else ({ onSelectTargetSession(session.id) }),
                                        )
                                        Column(modifier = Modifier.weight(1f)) {
                                            Row(
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                            ) {
                                                Text(
                                                    text = session.title,
                                                    style = MaterialTheme.typography.bodyMedium,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis,
                                                    modifier = Modifier.weight(1f, fill = false),
                                                )
                                                if (isCurrent) {
                                                    Text(
                                                        text = Str.draftHandoffCurrentSessionTag,
                                                        style = MaterialTheme.typography.labelSmall,
                                                        color = MaterialTheme.colorScheme.primary,
                                                    )
                                                }
                                            }
                                            Text(
                                                text = formatLocalMessageTime(session.updatedAtEpochMs),
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.agent567Extra.secondaryText,
                                            )
                                        }
                                    }
                                }
                            }
                            if (state.targetSessionId.isNullOrBlank()) {
                                Text(
                                    text = Str.draftHandoffPickSessionHint,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }

            ContextGroup {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(Str.draftHandoffPreviewSection, style = MaterialTheme.typography.titleSmall)
                    Text(
                        text = Str.draftHandoffPreviewStats
                            .replace("{count}", selectedMessages.size.toString())
                            .replace("{chars}", trimmedLength.toString()),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (textValidationError != null) MaterialTheme.colorScheme.error else MaterialTheme.agent567Extra.secondaryText,
                    )
                }
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(1.dp, MaterialTheme.agent567Extra.border),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 64.dp, max = 180.dp)
                            .verticalScroll(rememberScrollState())
                            .padding(12.dp),
                    ) {
                        Text(
                            text = formattedText.ifBlank { Str.draftHandoffEmpty },
                            style = MaterialTheme.typography.bodySmall,
                            color = if (formattedText.isBlank()) MaterialTheme.agent567Extra.secondaryText else MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
                if (textValidationError != null) {
                    Text(
                        text = textValidationError,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }

            state.error?.let { err ->
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.55f),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = err,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(
                    onClick = onDismiss,
                    enabled = !state.sending,
                    modifier = Modifier.weight(1f),
                ) {
                    Text(Str.cancel)
                }
                Button(
                    onClick = onConfirmSend,
                    enabled = canConfirm,
                    modifier = Modifier.weight(1.6f),
                ) {
                    if (state.sending) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onPrimary,
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(Str.draftHandoffSending)
                    } else {
                        Text(if (state.error != null && state.pendingIdempotencyKey != null) Str.draftHandoffRetrySend else Str.draftHandoffConfirmSend)
                    }
                }
            }
        }
    }
}

@Composable
private fun DraftTargetRadioRow(
    selected: Boolean,
    enabled: Boolean,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        RadioButton(
            selected = selected,
            onClick = if (enabled) onClick else null,
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            Text(
                text = subtitle,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.agent567Extra.secondaryText,
            )
        }
    }
}
