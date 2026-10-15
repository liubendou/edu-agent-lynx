# Lynx 模块通过反射调用，release 混淆规则待接入时按需补充（当前 minify 关闭）
-keep class com.lynx.** { *; }
-keep class com.eduagent.app.modules.** { *; }
