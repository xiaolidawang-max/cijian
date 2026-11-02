# 词间

一个用于电脑浏览器的图文背词网页。首页选择词书后进入章节目录，目前提供《雅思词汇真经》。可以按章节查看单词、核心释义、配图和例句，收藏单词，并选择持续隐藏中文。每章浏览位置、收藏和学习设置会自动保存在当前浏览器，首页可直接继续上次学习，学习设置中可以导出或恢复记录。

当前为电脑端阶段版本。配图替换、词义校对和音频补充仍在继续；手机版将单独开发。

## 运行

需要 Node.js 20.19+ 或 22.12+。

```bash
npm install
npm run dev
```

在浏览器打开命令行显示的地址。需要生成静态网页时运行 `npm run build`，结果在 `dist/`。

使用 Node.js 22.12+ 可运行 `npm test` 检查内容与记录保存逻辑，`npm run audit:content` 检查词库缺漏；覆盖完整不代表每个词义都已人工校对。

## 内容来源

配图与课程来自本项目的个人素材。部分参考内容来自 [Word Atlas](https://github.com/designfuchen/word-atlas)（CC BY 4.0，节选）、[ECDICT](https://github.com/skywind3000/ECDICT)（MIT）、[WordNet](https://wordnet.princeton.edu/license-and-commercial-use)、[Wiktionary](https://en.wiktionary.org/) 和 [Tatoeba](https://tatoeba.org/)；出处与许可随项目保留，例句详情附有来源。部分内容由 AI 生成，尚未逐条校对。
