package com.eduagent.app

import android.app.Activity
import android.os.Bundle
import com.lynx.tasm.LynxView
import com.lynx.tasm.LynxViewBuilder
import com.lynx.tasm.TemplateData

/**
 * 调试用：加载任意 bundle URL（Lynx DevTool OpenCard / 远程调试页面入口）。
 */
class DebugActivity : Activity() {
    private var lynxView: LynxView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val view = buildLynxView()
        lynxView = view
        setContentView(view)
        val url = intent.getStringExtra("url")
        if (url != null) {
            view.renderTemplateUrl(url, TemplateData.empty())
        }
    }

    private fun buildLynxView(): LynxView {
        val viewBuilder = LynxViewBuilder()
        viewBuilder.setTemplateProvider(AssetTemplateProvider(this))
        return viewBuilder.build(this)
    }

    override fun onDestroy() {
        lynxView?.destroy()
        lynxView = null
        super.onDestroy()
    }
}
