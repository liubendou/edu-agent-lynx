package com.eduagent.app

import android.content.Context
import com.lynx.tasm.provider.AbsTemplateProvider
import java.io.ByteArrayOutputStream
import java.io.IOException

/**
 * 从 assets 读取 Lynx bundle（rspeedy 产物 main.lynx.bundle 已由 copyBundle 任务拷入）。
 */
class AssetTemplateProvider(context: Context) : AbsTemplateProvider() {

    private var mContext: Context = context.applicationContext

    override fun loadTemplate(uri: String, callback: Callback) {
        Thread {
            try {
                mContext.assets.open(uri).use { inputStream ->
                    ByteArrayOutputStream().use { byteArrayOutputStream ->
                        val buffer = ByteArray(1024)
                        var length: Int
                        while ((inputStream.read(buffer).also { length = it }) != -1) {
                            byteArrayOutputStream.write(buffer, 0, length)
                        }
                        callback.onSuccess(byteArrayOutputStream.toByteArray())
                    }
                }
            } catch (e: IOException) {
                callback.onFailed(e.message)
            }
        }.start()
    }
}
