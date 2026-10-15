package com.eduagent.app

import android.app.Activity
import android.os.Bundle
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

    override fun onDestroy() {
        lynxView?.destroy()
        lynxView = null
        super.onDestroy()
    }
}
