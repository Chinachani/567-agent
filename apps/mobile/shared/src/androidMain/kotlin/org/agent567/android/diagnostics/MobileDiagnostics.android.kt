package org.agent567.android.diagnostics

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.os.Process
import android.util.Log
import org.agent567.android.AppVersion
import java.io.File
import java.io.FileOutputStream
import java.io.PrintWriter
import java.io.StringWriter
import java.nio.charset.StandardCharsets
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

object MobileDiagnostics {
    private const val TAG = "567Diagnostics"
    private const val LOG_FILE = "recent.log"
    private const val PREVIOUS_LOG_FILE = "previous.log"
    private const val CRASH_FILE = "last-crash.txt"
    private const val MAX_LOG_BYTES = 512 * 1024L
    private const val MAX_CRASH_CHARS = 256 * 1024
    private const val MAX_LINE_CHARS = 4_000

    private val writer = Executors.newSingleThreadExecutor { task ->
        Thread(task, "567-diagnostics-writer").apply { isDaemon = true }
    }
    private val lock = Any()
    @Volatile private var appContext: Context? = null
    @Volatile private var previousExit: String = "尚无 Android 进程退出记录"
    private var initialized = false

    @Synchronized
    fun initialize(context: Context) {
        if (initialized) return
        val applicationContext = context.applicationContext
        appContext = applicationContext
        previousExit = readPreviousExit(applicationContext)
        val oldHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            writeCrashSynchronously(applicationContext, thread, error)
            if (oldHandler != null) oldHandler.uncaughtException(thread, error)
            else {
                Process.killProcess(Process.myPid())
                kotlin.system.exitProcess(10)
            }
        }
        initialized = true
        record("INFO", "process started; previous_exit=$previousExit")
    }

    fun record(level: String, message: String) {
        val context = appContext ?: return
        val line = "${timestamp()} $level ${redact(message).take(MAX_LINE_CHARS)}\n"
        runCatching {
            writer.execute {
                synchronized(lock) {
                    val directory = diagnosticsDirectory(context)
                    val current = File(directory, LOG_FILE)
                    if (current.length() + line.toByteArray(StandardCharsets.UTF_8).size > MAX_LOG_BYTES) {
                        File(directory, PREVIOUS_LOG_FILE).delete()
                        current.renameTo(File(directory, PREVIOUS_LOG_FILE))
                    }
                    FileOutputStream(File(directory, LOG_FILE), true).use { stream ->
                        stream.write(line.toByteArray(StandardCharsets.UTF_8))
                    }
                }
            }
        }
    }

    fun exportReport(): String {
        val context = appContext ?: return "诊断记录尚未初始化。请重启应用后再导出。\n"
        runCatching { writer.submit {}.get(2, TimeUnit.SECONDS) }
        return buildString {
            appendLine("567 Agent Android 诊断报告")
            appendLine("应用版本：${AppVersion.NAME} (${AppVersion.CODE})")
            appendLine("Android：${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            appendLine("设备：${Build.MANUFACTURER} ${Build.MODEL}")
            appendLine("导出时间：${timestamp()}")
            appendLine("最近一次进程退出：${redact(previousExit)}")
            appendLine()
            appendLine("近期应用诊断日志（不包含聊天内容、密码或认证请求头）")
            appendDiagnosticFile(this, context, LOG_FILE)
            appendLine()
            appendLine("上一个日志片段")
            appendDiagnosticFile(this, context, PREVIOUS_LOG_FILE)
            appendLine()
            appendLine("最近一次未捕获崩溃")
            appendDiagnosticFile(this, context, CRASH_FILE)
        }
    }

    private fun readPreviousExit(context: Context): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return "此 Android 版本不提供进程退出原因记录"
        return runCatching {
            val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val info = manager.getHistoricalProcessExitReasons(context.packageName, 0, 1).firstOrNull()
                ?: return@runCatching "系统未提供最近一次进程退出记录"
            val reason = when (info.reason) {
                ApplicationExitInfo.REASON_CRASH -> "应用崩溃"
                ApplicationExitInfo.REASON_CRASH_NATIVE -> "原生崩溃"
                ApplicationExitInfo.REASON_ANR -> "应用无响应（ANR）"
                ApplicationExitInfo.REASON_LOW_MEMORY -> "系统内存不足"
                ApplicationExitInfo.REASON_USER_REQUESTED -> "用户或系统请求结束"
                ApplicationExitInfo.REASON_SIGNALED -> "进程收到信号并退出"
                ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "依赖进程退出"
                ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "资源使用超限"
                else -> "其他原因（${info.reason}）"
            }
            val description = info.description?.takeIf(String::isNotBlank)?.let { "; 描述=${redact(it)}" }.orEmpty()
            "$reason；时间=${Date(info.timestamp)}；状态码=${info.status}$description"
        }.getOrElse { "读取进程退出记录失败：${redact(it.message.orEmpty())}" }
    }

    private fun writeCrashSynchronously(context: Context, thread: Thread, error: Throwable) {
        runCatching {
            val directory = diagnosticsDirectory(context)
            val target = File(directory, CRASH_FILE)
            val stack = StringWriter().also { error.printStackTrace(PrintWriter(it)) }.toString()
            val report = buildString {
                appendLine("时间：${timestamp()}")
                appendLine("线程：${thread.name}")
                append(redact(stack).take(MAX_CRASH_CHARS))
            }
            FileOutputStream(target, false).use { stream ->
                stream.write(report.toByteArray(StandardCharsets.UTF_8))
                stream.fd.sync()
            }
        }.onFailure { Log.e(TAG, "Unable to persist crash report", it) }
    }

    private fun appendDiagnosticFile(output: StringBuilder, context: Context, name: String) {
        val file = File(diagnosticsDirectory(context), name)
        if (!file.exists()) {
            output.appendLine("（暂无）")
            return
        }
        runCatching { file.readText(StandardCharsets.UTF_8) }
            .onSuccess { output.appendLine(redact(it)) }
            .onFailure { output.appendLine("（读取失败）") }
    }

    private fun diagnosticsDirectory(context: Context): File =
        File(context.filesDir, "diagnostics").apply { mkdirs() }

    private fun timestamp(): String =
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS Z", Locale.US).format(Date())

    private fun redact(input: String): String {
        var value = input
        value = value.replace(Regex("(?i)(Bearer\\s+)[A-Za-z0-9._~+/-]+=*")) { "${it.groupValues[1]}[REDACTED]" }
        value = value.replace(Regex("(?i)(authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|password|secret|api[_-]?key)(\\s*[=:]\\s*)[^\\s,;]+")) {
            "${it.groupValues[1]}${it.groupValues[2]}[REDACTED]"
        }
        value = value.replace(Regex("(?i)([?&](?:token|key|secret|password|auth|code)=)[^&\\s]+")) { "${it.groupValues[1]}[REDACTED]" }
        return value
    }
}
