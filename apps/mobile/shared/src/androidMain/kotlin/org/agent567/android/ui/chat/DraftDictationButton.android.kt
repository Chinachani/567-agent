package org.agent567.android.ui.chat

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.agent567Extra

private enum class DictationState {
    Idle,
    Listening,
    AwaitingResult,
}

@Composable
internal actual fun DraftDictationButton(
    onStart: () -> Unit,
    onResult: (String) -> Unit,
    onNotice: (String) -> Unit,
    onBusyChange: (Boolean) -> Unit,
    modifier: Modifier,
) {
    val context = LocalContext.current
    if (Build.VERSION.SDK_INT < 31) return
    val supported = remember(context) {
        try { SpeechRecognizer.isOnDeviceRecognitionAvailable(context) } catch (_: RuntimeException) { false }
    }
    if (!supported) return

    val owner = LocalLifecycleOwner.current
    val startCallback by rememberUpdatedState(onStart)
    val resultCallback by rememberUpdatedState(onResult)
    val notify by rememberUpdatedState(onNotice)
    val busyChanged by rememberUpdatedState(onBusyChange)

    var state by remember { mutableStateOf(DictationState.Idle) }
    var active by remember { mutableStateOf<SpeechRecognizer?>(null) }
    var awaitingPermission by remember { mutableStateOf(false) }
    var level by remember { mutableFloatStateOf(0f) }
    var isCancelled by remember { mutableStateOf(false) }

    fun cancel() {
        isCancelled = true
        val previous = active
        active = null
        state = DictationState.Idle
        level = 0f
        if (previous != null) {
            try { previous.cancel() } catch (_: RuntimeException) { /* Service already disconnected. */ }
            try { previous.destroy() } catch (_: RuntimeException) { /* Already released. */ }
        }
        busyChanged(false)
    }

    fun finish() {
        val recognizer = active ?: return
        if (state != DictationState.Listening) return
        state = DictationState.AwaitingResult
        level = 0f
        try {
            recognizer.stopListening()
        } catch (_: RuntimeException) {
            cancel()
            notify(Str.dictationUnavailable)
        }
    }

    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) { awaitingPermission = false; cancel() } }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer); awaitingPermission = false; cancel() }
    }

    fun start() {
        if (active != null || !owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) return
        try {
            val recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
            active = recognizer
            isCancelled = false
            state = DictationState.Listening
            busyChanged(true)
            startCallback()

            recognizer.setRecognitionListener(object : RecognitionListener {
                override fun onResults(results: Bundle?) {
                    if (active !== recognizer || isCancelled) return
                    val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim()
                    active = null
                    state = DictationState.Idle
                    level = 0f
                    busyChanged(false)
                    try { recognizer.destroy() } catch (_: RuntimeException) {}
                    if (text.isNullOrEmpty()) {
                        notify(Str.dictationUnavailable)
                    } else {
                        resultCallback(text)
                    }
                }
                override fun onError(error: Int) {
                    if (active !== recognizer || isCancelled) return
                    active = null
                    state = DictationState.Idle
                    level = 0f
                    busyChanged(false)
                    try { recognizer.destroy() } catch (_: RuntimeException) {}
                    notify(if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) Str.dictationPermission else Str.dictationUnavailable)
                }
                override fun onRmsChanged(rmsdB: Float) {
                    if (active === recognizer && state == DictationState.Listening && rmsdB.isFinite()) {
                        level = ((rmsdB + 2f) / 14f).coerceIn(0f, 1f)
                    }
                }
                override fun onEndOfSpeech() {
                    if (active === recognizer && state == DictationState.Listening) {
                        state = DictationState.AwaitingResult
                        level = 0f
                    }
                }
                override fun onReadyForSpeech(params: Bundle?) = Unit
                override fun onBeginningOfSpeech() = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onPartialResults(partialResults: Bundle?) = Unit
                override fun onEvent(eventType: Int, params: Bundle?) = Unit
            })
            recognizer.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1))
        } catch (_: RuntimeException) { cancel(); notify(Str.dictationUnavailable) }
    }

    LaunchedEffect(state, active) {
        val current = active ?: return@LaunchedEffect
        when (state) {
            DictationState.Listening -> {
                kotlinx.coroutines.delay(60_000)
                if (active === current && state == DictationState.Listening) {
                    finish()
                }
            }
            DictationState.AwaitingResult -> {
                kotlinx.coroutines.delay(15_000)
                if (active === current && state == DictationState.AwaitingResult) {
                    cancel()
                    notify(Str.dictationUnavailable)
                }
            }
            DictationState.Idle -> Unit
        }
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (awaitingPermission) {
            awaitingPermission = false
            if (granted) start() else notify(Str.dictationPermission)
        }
    }

    when (state) {
        DictationState.Idle -> {
            IconButton(
                onClick = {
                    if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        start()
                    } else {
                        awaitingPermission = true
                        permission.launch(Manifest.permission.RECORD_AUDIO)
                    }
                },
                enabled = !awaitingPermission,
                modifier = modifier.size(48.dp),
            ) {
                Icon(
                    Icons.Default.Mic,
                    contentDescription = Str.dictateDraft,
                    modifier = Modifier.size(20.dp),
                    tint = MaterialTheme.agent567Extra.chatAccent,
                )
            }
        }
        DictationState.Listening -> {
            Row(
                modifier = modifier.height(48.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                IconButton(
                    onClick = { cancel() },
                    modifier = Modifier.size(36.dp),
                ) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = Str.cancelDictation,
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(18.dp),
                    )
                }
                IconButton(
                    onClick = { finish() },
                    modifier = Modifier.size(36.dp),
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Default.Check,
                            contentDescription = Str.finishDictation,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(18.dp),
                        )
                        LinearProgressIndicator(
                            progress = { level },
                            modifier = Modifier.width(20.dp).height(2.dp),
                        )
                    }
                }
            }
        }
        DictationState.AwaitingResult -> {
            Row(
                modifier = modifier.height(48.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                IconButton(
                    onClick = { cancel() },
                    modifier = Modifier.size(36.dp),
                ) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = Str.cancelDictation,
                        tint = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(18.dp),
                    )
                }
                Box(
                    modifier = Modifier.size(36.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}
