package org.agent567.android.ui.chat

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.util.Locale

@Composable
internal actual fun rememberReplyReader(sessionId: String?, onUnavailable: () -> Unit): ReplyReader {
    val context = LocalContext.current.applicationContext
    val notify by rememberUpdatedState(onUnavailable)
    val reader = remember(sessionId, context) { AndroidReplyReader(context) { notify() } }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner, reader) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) reader.stop() }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer); reader.stop() }
    }
    return reader
}

private class AndroidReplyReader(private val context: Context, private val unavailable: () -> Unit) : ReplyReader {
    override var activeId: String? by mutableStateOf(null)
        private set
    private var generation = 0L
    private var engine: TextToSpeech? = null
    private val main = Handler(Looper.getMainLooper())
    private var initTimeout: Runnable? = null

    override fun stop() {
        generation++
        initTimeout?.let { main.removeCallbacks(it) }; initTimeout = null
        activeId = null
        val previous = engine ?: return
        engine = null
        try { previous.stop() } catch (_: RuntimeException) { /* Service already disconnected. */ }
        try { previous.shutdown() } catch (_: RuntimeException) { /* Already released. */ }
    }

    override fun toggle(id: String, text: String) {
        val wasReading = activeId == id
        stop()
        if (wasReading || text.isBlank()) return
        val token = generation
        activeId = id
        fun fail() { if (token == generation) { stop(); unavailable() } }
        initTimeout = Runnable { fail() }.also { main.postDelayed(it, 5000) }
        try {
            engine = TextToSpeech(context) { status -> main.post {
                if (token != generation) return@post
                initTimeout?.let { main.removeCallbacks(it) }; initTimeout = null
                val speech = engine
                if (status != TextToSpeech.SUCCESS || speech == null) { fail(); return@post }
                try {
                    readSegments(speech, token, text, ::fail)
                } catch (_: RuntimeException) { fail() }
            } }
        } catch (_: RuntimeException) { fail() }
    }

    private fun readSegments(speech: TextToSpeech, token: Long, text: String, fail: () -> Unit) {
        val language = if (text.take(200).any { it in '\u4e00'..'\u9fff' }) "zh" else Locale.getDefault().language
        val voices = speech.voices.orEmpty().filter {
            !it.isNetworkConnectionRequired && TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in it.features.orEmpty()
        }
        val voice = voices.firstOrNull { it.locale.language == language } ?: voices.firstOrNull()
        if (voice == null || speech.setVoice(voice) != TextToSpeech.SUCCESS) { fail(); return }

        val limit = minOf(800, TextToSpeech.getMaxSpeechInputLength())
        if (limit < 2) { fail(); return }
        val breaks = charArrayOf('。', '！', '？', '.', '!', '?', '\n', ' ')
        var offset = 0
        var utterance = ""
        fun next() {
            if (token != generation) return
            if (offset == text.length) { stop(); return }
            val chunk = text.substring(offset, offset + minOf(limit, text.length - offset))
            var length = chunk.length
            if (offset + length < text.length) {
                val boundary = chunk.lastIndexOfAny(breaks)
                if (boundary >= 0) length = boundary + 1
                if (chunk[length - 1].isHighSurrogate()) length--
            }
            utterance = "$token:$offset"
            val segment = chunk.take(length)
            offset += length
            try {
                if (speech.speak(segment, TextToSpeech.QUEUE_FLUSH, null, utterance) != TextToSpeech.SUCCESS) fail()
            } catch (_: RuntimeException) { fail() }
        }
        val registered = speech.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String?) = Unit
            override fun onDone(id: String?) { main.post { if (id == utterance) next() } }
            @Deprecated("Required by Android") override fun onError(id: String?) { main.post { if (id == utterance) fail() } }
        })
        if (registered == TextToSpeech.SUCCESS) next() else fail()
    }
}
