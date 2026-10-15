// 前置：sherpa-onnx AAR 需手动放 libs/（50MB 二进制不入 git）：
//   mkdir -p android/app/libs && curl -L -o android/app/libs/sherpa-onnx-1.13.8.aar \
//     https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-1.13.8.aar

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.jetbrains.kotlin.android)
}

android {
    namespace = "com.eduagent.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.eduagent.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }

    // M6：@sigx/lynx-haptics 原生模块源码随包分发（node_modules），srcDirs 挂入编译（触觉真绑定 D1）
    sourceSets.getByName("main") {
        java.srcDir(file("../../node_modules/@sigx/lynx-haptics/android"))
    }
}

dependencies {
    // Lynx SDK（Maven Central，坐标见 docs/01_环境与工具链报告.md §5）
    implementation("org.lynxsdk.lynx:lynx:4.1.0")
    implementation("org.lynxsdk.lynx:lynx-jssdk:4.1.0")
    implementation("org.lynxsdk.lynx:lynx-trace:4.1.0")
    implementation("org.lynxsdk.lynx:primjs:4.1.1")

    // image-service（fresco 为其必需依赖）
    implementation("org.lynxsdk.lynx:lynx-service-image:4.1.0")
    implementation("com.facebook.fresco:fresco:2.3.0")
    implementation("com.facebook.fresco:animated-gif:2.3.0")
    implementation("com.facebook.fresco:animated-webp:2.3.0")
    implementation("com.facebook.fresco:webpsupport:2.3.0")
    implementation("com.facebook.fresco:animated-base:2.3.0")

    // log-service / http-service
    implementation("org.lynxsdk.lynx:lynx-service-log:4.1.0")
    implementation("org.lynxsdk.lynx:lynx-service-http:4.1.0")
    implementation("com.squareup.okhttp3:okhttp:4.9.0")

    // devtool（调试期用）
    implementation("org.lynxsdk.lynx:lynx-devtool:4.1.0")
    implementation("org.lynxsdk.lynx:lynx-service-devtool:4.1.0")

    // XElement
    implementation("org.lynxsdk.lynx:xelement:4.1.0")
    implementation("org.lynxsdk.lynx:xelement-input:4.1.0")
    implementation("org.lynxsdk.lynx:xelement-overlay:4.1.0")
    implementation("org.lynxsdk.lynx:xelement-svg:4.1.0")
    implementation("org.lynxsdk.lynx:servalsvg:0.0.2")
    implementation("org.lynxsdk.lynx:xelement-refresh:4.1.0")

    // M6：sherpa-onnx 端侧语音（TTS Kokoro + 流式 zipformer ASR；AAR 来自官方 release v1.13.8，
    // libs/ 直依赖避免 JitPack 构建排队）。模型文件不入 APK，首次使用经 SpeechModule 下载到 app 私有目录
    implementation(files("libs/sherpa-onnx-1.13.8.aar"))
    // M6：模型 tar.bz2 解压（commons-compress 纯 Java bzip2/tar）
    implementation("org.apache.commons:commons-compress:1.26.2")
    // M6/D4：FileProvider（拍照临时文件）
    implementation("androidx.core:core:1.12.0")
}

// 把前端构建产物（edu-agent/dist/）拷入 app assets，先在工程根执行 `npm run build`
val copyBundle by tasks.registering(Copy::class) {
    from(file("../../dist"))
    into("src/main/assets")
}

tasks.named("preBuild") { dependsOn(copyBundle) }
