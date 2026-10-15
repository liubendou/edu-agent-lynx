package com.eduagent.app.modules

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.provider.MediaStore
import android.util.Base64
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.tasm.behavior.LynxContext
import androidx.core.content.FileProvider
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * 拍照模块（M6/D4，tools/grade-entry.ts 与 vision_capture 的端侧图像入口）：
 * Lynx 无内置 camera 元素（lynxjs.org llms.txt 内置元素清单核实）→
 * 走 Android Intent MediaStore.ACTION_IMAGE_CAPTURE（系统相机 app 代拍，无需 CAMERA 权限），
 * EXTRA_OUTPUT 指向 FileProvider 临时文件拿全分辨率照片；结果回传 JPEG data URL（base64）。
 * 隐私口径（PRD §5.5 不存原图）：临时文件编码完即删，端侧只留内存态 data URL。
 *
 * JS 侧接口：NativeModules.CameraModule.capturePhoto(cb(ok: Boolean, imageDataUrl | err))
 * 真机验证（相机 app 差异/权限/裁切）标注 M7。
 */
class CameraModule(context: Context) : LynxModule(context) {

    companion object {
        const val REQUEST_CODE = 0x4210
        /** MainActivity.onActivityResult 转发入口（LynxModule 无 Activity 事件监听机制）。 */
        var instance: CameraModule? = null
    }

    private val appContext: Context get() = (mContext as LynxContext).getContext()
    private var pendingCallback: Callback? = null
    private var pendingFile: File? = null

    init {
        instance = this // MainActivity.onActivityResult 转发入口
    }

    @LynxMethod
    fun capturePhoto(callback: Callback) {
        val activity = (mContext as LynxContext).context as? Activity
        if (activity == null) {
            callback.invoke(false, "no activity")
            return
        }
        pendingCallback = callback
        try {
            val dir = File(appContext.cacheDir, "camera").apply { mkdirs() }
            val file = File(dir, "capture-${System.currentTimeMillis()}.jpg")
            pendingFile = file
            val uri = FileProvider.getUriForFile(appContext, "${appContext.packageName}.fileprovider", file)
            val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, uri)
            if (intent.resolveActivity(appContext.packageManager) != null) {
                activity.startActivityForResult(intent, REQUEST_CODE)
            } else {
                callback.invoke(false, "no camera app")
            }
        } catch (e: Exception) {
            pendingCallback = null
            callback.invoke(false, "capture failed: ${e.message}")
        }
    }

    /** MainActivity.onActivityResult 转发：取全分辨率文件（缺失时回落缩略图）→ base64 → 删临时文件。 */
    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_CODE) return
        val callback = pendingCallback ?: return
        pendingCallback = null
        val file = pendingFile
        pendingFile = null
        if (resultCode != Activity.RESULT_OK) {
            file?.delete()
            callback.invoke(false, "cancelled")
            return
        }
        try {
            val bytes = readFullRes(file) ?: readThumbnail(data)
            if (bytes == null) {
                callback.invoke(false, "no image data")
                return
            }
            val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
            callback.invoke(true, "data:image/jpeg;base64,$b64")
        } catch (e: Exception) {
            callback.invoke(false, "encode failed: ${e.message}")
        } finally {
            file?.delete() // 不存原图（§5.5）
        }
    }

    private fun readFullRes(file: File?): ByteArray? = file?.takeIf { it.isFile }?.readBytes()

    private fun readThumbnail(data: Intent?): ByteArray? {
        val bitmap = data?.extras?.get("data") as? Bitmap ?: return null
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)
        return out.toByteArray()
    }
}
