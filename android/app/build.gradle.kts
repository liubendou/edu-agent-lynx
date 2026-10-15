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
}

// 把前端构建产物（edu-agent/dist/）拷入 app assets，先在工程根执行 `npm run build`
val copyBundle by tasks.registering(Copy::class) {
    from(file("../../dist"))
    into("src/main/assets")
}

tasks.named("preBuild") { dependsOn(copyBundle) }
