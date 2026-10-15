package com.eduagent.app.modules

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.os.Build
import com.eduagent.app.modules.SpeechModels.ASR_DIR_NAME
import com.eduagent.app.modules.SpeechModels.ASR_URL
import com.eduagent.app.modules.SpeechModels.TTS_DIR_NAME
import com.eduagent.app.modules.SpeechModels.TTS_URL
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.tasm.behavior.LynxContext
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.GeneratedAudio
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineRecognizer
import com.k2fsa.sherpa.onnx.OnlineRecognizerConfig
import com.k2fsa.sherpa.onnx.OnlineStream
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * 端侧语音模块（M6，ARCHITECTURE §2 SpeechModule.kt / §12 语音行）：
 * sherpa-onnx（AAR 1.13.8，libs/ 直依赖）+ Kokoro TTS + 流式 zipformer ASR，
 * 模型**不入 APK**（PRD §7.3 体积约束）：首次使用由 OkHttp 下载 tar.bz2 到 app 私有目录
 * （filesDir/models/…），失败兜底返回错误（可重试），语音数据不出端。
 *
 * JS 侧接口（src/tools/tts.ts / asr.ts 经 NativeModules.SpeechModule 调用）：
 *   ensureTtsModel(cb) / isTtsReady(cb) / speak(text, rate, cb) / stopTts()
 *   ensureAsrModel(cb) / isAsrReady(cb) / startAsr(cb) / stopAsr() / asrPoll(cb(partial, finals))
 * 流式中间结果采用轮询模式（LynxModule Callback 单发限制；JS 侧 250ms asrPoll 桥接出 onPartial/onFinal）。
 */
class SpeechModule(context: Context) : LynxModule(context) {

    private val appContext: Context get() = (mContext as LynxContext).getContext()
    private val executor = Executors.newSingleThreadExecutor()

    // ── TTS 状态 ──
    private var tts: OfflineTts? = null
    private val ttsLoading = AtomicBoolean(false)
    private val stopTtsRequested = AtomicBoolean(false)
    private var audioTrack: AudioTrack? = null

    // ── ASR 状态 ──
    private var recognizer: OnlineRecognizer? = null
    private var stream: OnlineStream? = null
    private var audioRecord: AudioRecord? = null
    private val asrRunning = AtomicBoolean(false)
    private val asrThread = AtomicReference<Thread?>(null)
    private val pollLock = Any()
    private var pendingPartial = ""
    private val pendingFinals = ArrayList<String>()

    // ── 模型管理：首次使用下载（OkHttp 流式 + tar.bz2 解压），失败兜底 ──

    private fun modelRoot() = File(appContext.filesDir, "models")

    private fun ttsDir() = File(modelRoot(), TTS_DIR_NAME)
    private fun asrDir() = File(modelRoot(), ASR_DIR_NAME)

    private fun ttsFilesReady(): Boolean =
        File(ttsDir(), "model.onnx").isFile && File(ttsDir(), "tokens.txt").isFile

    private fun asrFilesReady(): Boolean =
        File(asrDir(), "tokens.txt").isFile && asrDir().listFiles { f -> f.name.endsWith(".onnx") }.orEmpty().isNotEmpty()

    @LynxMethod
    fun isTtsReady(callback: Callback) {
        callback.invoke(tts !== null || ttsFilesReady())
    }

    @LynxMethod
    fun ensureTtsModel(callback: Callback) {
        if (ttsFilesReady() || ttsLoading.get()) {
            callback.invoke(true)
            return
        }
        ttsLoading.set(true)
        executor.execute {
            try {
                SpeechModels.downloadAndExtract(appContext, TTS_URL, ttsDir())
                callback.invoke(true)
            } catch (e: Exception) {
                // 失败兜底：残留半成品清掉，下次重试；错误信息回传 JS 层展示
                ttsDir().deleteRecursively()
                callback.invoke(false, "tts model download failed: ${e.message}")
            } finally {
                ttsLoading.set(false)
            }
        }
    }

    @LynxMethod
    fun isAsrReady(callback: Callback) {
        callback.invoke(recognizer !== null || asrFilesReady())
    }

    @LynxMethod
    fun ensureAsrModel(callback: Callback) {
        if (asrFilesReady() || ttsLoading.get()) {
            callback.invoke(true)
            return
        }
        ttsLoading.set(true)
        executor.execute {
            try {
                SpeechModels.downloadAndExtract(appContext, ASR_URL, asrDir())
                callback.invoke(true)
            } catch (e: Exception) {
                asrDir().deleteRecursively()
                callback.invoke(false, "asr model download failed: ${e.message}")
            } finally {
                ttsLoading.set(false)
            }
        }
    }

    // ── TTS：合成 + AudioTrack 播放（端侧离线，语速接画像偏好） ──

    @LynxMethod
    fun speak(text: String, rate: Double, callback: Callback) {
        val safeText = text.trim()
        if (safeText.isEmpty()) {
            callback.invoke(false, "empty text")
            return
        }
        val safeRate = rate.toFloat().coerceIn(0.5f, 2.0f)
        executor.execute {
            try {
                val engine = obtainTts()
                stopTtsRequested.set(false)
                val audio: GeneratedAudio =
                    engine.generateWithCallback(safeText, 0, safeRate) { _ ->
                        if (stopTtsRequested.get()) 0 else 1 // 0 = 中止合成（sherpa-onnx 回调约定）
                    }
                if (stopTtsRequested.get()) {
                    callback.invoke(false, "stopped")
                    return@execute
                }
                play(audio)
                callback.invoke(true)
            } catch (e: Exception) {
                callback.invoke(false, "tts failed: ${e.message}")
            }
        }
    }

    @LynxMethod
    fun stopTts() {
        stopTtsRequested.set(true)
        try {
            audioTrack?.pause()
            audioTrack?.flush()
        } catch (_: Exception) {
        }
    }

    private fun obtainTts(): OfflineTts {
        tts?.let { return it }
        val dir = ttsDir()
        val config = OfflineTtsConfig(
            model = OfflineTtsModelConfig(
                kokoro = OfflineTtsKokoroModelConfig(
                    model = File(dir, "model.onnx").absolutePath,
                    voices = File(dir, "voices.bin").absolutePath,
                    tokens = File(dir, "tokens.txt").absolutePath,
                    dataDir = File(dir, "espeak-ng-data").absolutePath,
                    dictDir = File(dir, "dict").takeIf { it.isDirectory }?.absolutePath ?: "",
                ),
                numThreads = 2,
            ),
        )
        val engine = OfflineTts(null, config)
        tts = engine
        return engine
    }

    private fun play(audio: GeneratedAudio) {
        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                    .setSampleRate(audio.sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
            )
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(audio.samples.size * 4)
            .build()
        audioTrack = track
        track.write(audio.samples, 0, audio.samples.size, AudioTrack.WRITE_BLOCKING)
        track.play()
    }

    // ── ASR：AudioRecord 16k 采集 → 流式 zipformer → 轮询回收 ──

    @SuppressLint("MissingPermission") // AndroidManifest 已声明 RECORD_AUDIO
    @LynxMethod
    fun startAsr(callback: Callback) {
        if (asrRunning.get()) {
            callback.invoke(true)
            return
        }
        try {
            val rec = obtainRecognizer()
            val newStream = rec.createStream()
            stream = newStream
            val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            val record = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                maxOf(minBuf, 8192),
            )
            audioRecord = record
            synchronized(pollLock) {
                pendingPartial = ""
                pendingFinals.clear()
            }
            asrRunning.set(true)
            val worker = Thread {
                record.startRecording()
                val shorts = ShortArray(1600) // 100ms @16k
                try {
                    while (asrRunning.get()) {
                        val n = record.read(shorts, 0, shorts.size)
                        if (n <= 0) continue
                        val floats = FloatArray(n) { i -> shorts[i] / 32768.0f }
                        newStream.acceptWaveform(floats, SAMPLE_RATE)
                        if (rec.isReady(newStream)) rec.decode(newStream)
                        val text = rec.getResult(newStream).text
                        synchronized(pollLock) { pendingPartial = text }
                        // endpoint（静音/句尾）→ 定稿当前分句并重置，供 asrPoll 产出 finals
                        if (rec.isEndpoint(newStream)) {
                            if (text.isNotEmpty()) synchronized(pollLock) { pendingFinals.add(text) }
                            rec.reset(newStream)
                            synchronized(pollLock) { pendingPartial = "" }
                        }
                    }
                } catch (_: Exception) {
                    // 录音线程异常：置停，poll 侧感知 finals 停滞
                } finally {
                    try { record.stop() } catch (_: Exception) {}
                    record.release()
                }
            }
            asrThread.set(worker)
            worker.start()
            callback.invoke(true)
        } catch (e: Exception) {
            asrRunning.set(false)
            callback.invoke(false, "asr start failed: ${e.message}")
        }
    }

    @LynxMethod
    fun stopAsr() {
        if (!asrRunning.get()) return
        asrRunning.set(false)
        try {
            asrThread.get()?.join(1000)
        } catch (_: InterruptedException) {
        }
        asrThread.set(null)
        // 输入结束：最后一次 decode 拿尾段定稿
        try {
            val rec = recognizer
            val s = stream
            if (rec != null && s != null) {
                s.inputFinished()
                if (rec.isReady(s)) rec.decode(s)
                val text = rec.getResult(s).text
                synchronized(pollLock) {
                    if (text.isNotEmpty()) pendingFinals.add(text)
                    pendingPartial = ""
                }
            }
        } catch (_: Exception) {
        }
        try { stream?.release() } catch (_: Exception) {}
        stream = null
    }

    @LynxMethod
    fun asrPoll(callback: Callback) {
        synchronized(pollLock) {
            callback.invoke(pendingPartial, ArrayList(pendingFinals))
            pendingFinals.clear()
        }
    }

    private fun obtainRecognizer(): OnlineRecognizer {
        recognizer?.let { return it }
        val dir = asrDir()
        val config = OnlineRecognizerConfig(
            featConfig = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80),
            modelConfig = OnlineModelConfig(
                transducer = OnlineTransducerModelConfig(
                    encoder = File(dir, "encoder-epoch-99-avg-1-int8.onnx").takeIf { it.isFile }?.absolutePath
                        ?: File(dir, "encoder-epoch-99-avg-1.onnx").absolutePath,
                    decoder = File(dir, "decoder-epoch-99-avg-1-int8.onnx").takeIf { it.isFile }?.absolutePath
                        ?: File(dir, "decoder-epoch-99-avg-1.onnx").absolutePath,
                    joiner = File(dir, "joiner-epoch-99-avg-1-int8.onnx").takeIf { it.isFile }?.absolutePath
                        ?: File(dir, "joiner-epoch-99-avg-1.onnx").absolutePath,
                ),
                tokens = File(dir, "tokens.txt").absolutePath,
                numThreads = 2,
            ),
        )
        val rec = OnlineRecognizer(null, config)
        recognizer = rec
        return rec
    }

    private companion object {
        const val SAMPLE_RATE = 16000
    }
}

/** 模型清单与下载管理（tar.bz2 → filesDir/models/<name>/；OkHttp 已在宿主依赖中）。 */
private object SpeechModels {
    const val TTS_DIR_NAME = "kokoro-multi-lang-v1_1"
    const val TTS_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2"
    const val ASR_DIR_NAME = "sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20"
    const val ASR_URL =
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2"

    /** 下载 tar.bz2 → 流式解包进目标目录（commons-compress 纯 Java 解 bzip2/tar；失败抛出由调用方兜底）。 */
    fun downloadAndExtract(context: Context, url: String, targetDir: File) {
        targetDir.parentFile?.mkdirs()
        val tmp = File.createTempFile("sherpa-model", ".tar.bz2", context.cacheDir)
        try {
            val client = okhttp3.OkHttpClient.Builder()
                .connectTimeout(java.time.Duration.ofSeconds(20))
                .readTimeout(java.time.Duration.ofMinutes(30))
                .build()
            val request = okhttp3.Request.Builder().url(url).build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw IllegalStateException("HTTP ${response.code}")
                response.body!!.byteStream().use { input ->
                    tmp.outputStream().use { input.copyTo(it) }
                }
            }
            targetDir.deleteRecursively()
            targetDir.mkdirs()
            tmp.inputStream().use { raw ->
                org.apache.commons.compress.archivers.tar.TarArchiveInputStream(
                    org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream(raw),
                ).use { tar ->
                    var entry = tar.nextTarEntry
                    while (entry != null) {
                        if (!tar.canReadEntryData(entry)) {
                            entry = tar.nextTarEntry
                            continue
                        }
                        val outFile = File(targetDir, entry.name)
                        if (entry.isDirectory) {
                            outFile.mkdirs()
                        } else {
                            outFile.parentFile?.mkdirs()
                            outFile.outputStream().use { tar.copyTo(it) }
                        }
                        entry = tar.nextTarEntry
                    }
                }
            }
        } finally {
            tmp.delete()
        }
    }
}
