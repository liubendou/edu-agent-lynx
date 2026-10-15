package com.eduagent.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.eduagent.app.modules.CameraModule
import com.lynx.tasm.LynxView
import com.lynx.tasm.LynxViewBuilder
import com.lynx.xelement.XElementBehaviors

class MainActivity : Activity() {
    private var lynxView: LynxView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val view = buildLynxView()
        lynxView = view
        setContentView(view)

        // 从 assets 加载 rspeedy 构建产物（copyBundle 任务已拷入 src/main/assets）
        view.renderTemplateUrl("main.lynx.bundle", "")
    }

    private fun buildLynxView(): LynxView {
        val viewBuilder = LynxViewBuilder()
        viewBuilder.addBehaviors(XElementBehaviors().create())
        viewBuilder.setTemplateProvider(AssetTemplateProvider(this))
        return viewBuilder.build(this)
    }

    override fun onResume() {
        super.onResume()
        lynxView?.onEnterForeground()
    }

    override fun onPause() {
        lynxView?.onEnterBackground()
        super.onPause()
    }

    /** 拍照结果转发（CameraModule FileProvider 临时文件 → base64 data URL，M6/D4）。 */
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        CameraModule.instance?.onActivityResult(requestCode, resultCode, data)
    }

    override fun onDestroy() {
        lynxView?.destroy()
        lynxView = null
        super.onDestroy()
    }
}
