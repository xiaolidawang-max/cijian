# 安卓离线资源

先用 Vite 的 Android 模式生成 `dist-android/index.html` 和前端文件，再运行：

```sh
node scripts/prepare-android-assets.mjs
```

测试包仅保留前三章时运行 `node scripts/prepare-android-assets.mjs --chapters 3`。无参数默认打包全部章节；限制章节只作用于安装包中的课程副本和媒体清单，网页完整词库不变。当前前三章共 533 词。

脚本只写 `dist-android`，保留 Vite 构建文件。它复制课程实际引用的完整预览图片、已有音频、App 加载的词典 JSON、图标和许可说明；仅在打包副本中把高清放大图地址改为同一预览图。网页课程和高清原图不变。

脚本会拒绝外部 URL、越界路径、符号链接、缺失文件和异常 JSON。`android-assets-manifest.json` 记录资源清单与字节数；重复执行只清理该清单中已经不用的自有资源，不删除原文件或前端构建文件。控制台同时报告包含前端文件在内的完整目录文件数和体积。

原生页面在课程加载前不展示种子词卡，避免请求旧种子数据中不存在的图片路径。现有音频随课程一起打包。图片和释义更新后重新构建安装包即可。

运行资源准备测试：`node --test tests/android-assets.test.mjs`。
