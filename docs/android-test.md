# 安卓测试版

版本 `0.1.0-test3`，包名 `com.xiaolidawang.cijian`，仅前三章 533 词。图片和已有音频内置，学习位置、收藏、设置保存在应用内；系统文件选择器可导入或导出学习记录。网页的记录不会自动同步到应用。

把 `cijian-test-3chapters.apk` 传到手机并安装。后续更新请使用相同签名覆盖安装；卸载会清除应用内记录，卸载前可在设置中导出备份。下载完成后不再依赖电脑或网络。

## 重新构建

需要 Node.js 22+、JDK 21、Android SDK 36、Build Tools 35/36。为当前进程设置 `JAVA_HOME`、`ANDROID_HOME`，并将 SDK 路径写入不提交的 `android/local.properties`。

```powershell
npm ci
npm run sync:android
.\android\gradlew.bat -p android assembleDebug --console=plain --max-workers=2
```

输出：`android/app/build/outputs/apk/debug/app-debug.apk`。当前构建命令固定使用 `--chapters 3`，只在 `dist-android` 筛选章节并复用手机预览图；原始完整课程和高清图不变。工具链、APK、缓存与签名文件不进入 Git。

检查：`npm test`、`node --test tests/android-assets.test.mjs`、Android 构建、APK 签名和内置资源校验。电脑未连接安卓真机，安装、系统返回和系统文件保存窗口仍需手机试用。
