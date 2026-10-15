package com.eduagent.app.modules

import android.content.Context
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.tasm.behavior.LynxContext

/**
 * 薄原生 KV 持久化模块（ARCHITECTURE.md §12 存储方案 A）。
 * 落 SharedPreferences；JS 侧经 NativeModules.StorageModule 调用。
 *
 * 接口：
 *   NativeModules.StorageModule.getItem(key, callback)          // callback(value|null)
 *   NativeModules.StorageModule.setItem(key, value[, callback]) // 可选完成回调
 *   NativeModules.StorageModule.removeItem(key[, callback])     // 可选完成回调
 *   NativeModules.StorageModule.getAllKeys(callback)            // callback(string[])
 */
class StorageModule(context: Context) : LynxModule(context) {

    private fun appContext(): Context {
        val lynxContext = mContext as LynxContext
        return lynxContext.getContext()
    }

    @LynxMethod
    fun setItem(key: String, value: String) {
        prefs().edit().putString(key, value).apply()
    }

    @LynxMethod
    fun getItem(key: String, callback: Callback) {
        callback.invoke(prefs().getString(key, null))
    }

    @LynxMethod
    fun removeItem(key: String) {
        prefs().edit().remove(key).apply()
    }

    @LynxMethod
    fun getAllKeys(callback: Callback) {
        callback.invoke(ArrayList(prefs().all.keys))
    }

    private fun prefs() =
        appContext().getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)

    companion object {
        private const val PREF_NAME = "edu_agent_storage"
    }
}
