package com.eduagent.app

import android.app.Application
import android.content.Intent
import android.os.Handler
import android.os.Looper
import com.facebook.drawee.backends.pipeline.Fresco
import com.facebook.imagepipeline.core.ImagePipelineConfig
import com.facebook.imagepipeline.memory.PoolConfig
import com.facebook.imagepipeline.memory.PoolFactory
import com.lynx.devtoolwrapper.LynxDevtoolGlobalHelper
import com.lynx.service.devtool.LynxDevToolService
import com.lynx.service.image.LynxImageService
import com.lynx.service.log.LynxLogService
import com.lynx.tasm.LynxEnv
import com.lynx.tasm.service.LynxServiceCenter
import com.lynx.service.http.LynxHttpService
import com.eduagent.app.modules.CameraModule
import com.eduagent.app.modules.SpeechModule
import com.eduagent.app.modules.StorageModule

class EduAgentApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        initLynxService()
        initLynxEnv()
    }

    private fun initLynxService() {
        // LynxImageService 依赖 Fresco，先初始化
        val factory = PoolFactory(PoolConfig.newBuilder().build())
        val builder =
            ImagePipelineConfig.newBuilder(applicationContext).setPoolFactory(factory)
        Fresco.initialize(applicationContext, builder.build())

        LynxServiceCenter.inst().registerService(LynxImageService.getInstance())
        LynxServiceCenter.inst().registerService(LynxLogService)
        LynxServiceCenter.inst().registerService(LynxHttpService)
        LynxServiceCenter.inst().registerService(LynxDevToolService.INSTANCE)
    }

    private fun initLynxEnv() {
        LynxEnv.inst().init(
            this,
            null,
            null,
            null
        )
        // 调试能力（发布版可关闭）
        LynxEnv.inst().enableLynxDebug(true)
        LynxEnv.inst().enableDevtool(true)
        LynxEnv.inst().enableLogBox(true)

        // 注册原生模块：JS 侧通过 NativeModules.StorageModule 调用（ARCHITECTURE §12 存储方案）
        LynxEnv.inst().registerModule("StorageModule", StorageModule::class.java)
        // M6：语音桥（sherpa-onnx TTS/ASR + 模型按需下载）与拍照桥（ACTION_IMAGE_CAPTURE，D4）
        LynxEnv.inst().registerModule("SpeechModule", SpeechModule::class.java)
        LynxEnv.inst().registerModule("CameraModule", CameraModule::class.java)
        // M6：触觉真绑定（@sigx/lynx-haptics 原生模块，Kotlin 源经 gradle srcDirs 指向 node_modules 编译）
        LynxEnv.inst().registerModule("Haptics", com.sigx.haptics.HapticsModule::class.java)

        // DevTool OpenCard：扫码/输入 URL 时打开 DebugActivity
        val mainHandler = Handler(Looper.getMainLooper())
        LynxDevtoolGlobalHelper.getInstance().registerCardListener { url ->
            mainHandler.post {
                val intent = Intent(
                    applicationContext,
                    DebugActivity::class.java
                )
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                intent.putExtra("url", url)
                startActivity(intent)
            }
        }
    }
}
