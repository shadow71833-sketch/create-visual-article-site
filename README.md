# Create Visual Article Site

> 中文名：三视图文章网站生成器

将网页文章、PDF、Markdown 或粘贴文本，转换成一个内容完整、排版整齐、可以离线打开和部署分享的三视图静态网站。

## 三个视图

- **正文**：完整保留原文结构、段落、表格、代码和媒体链接。
- **一页纸**：用流程、对比、数据和重点模块快速呈现核心信息。
- **秒懂漫画**：用小互风格的编辑型漫画重新组织重点，保持事实可追溯。

## 名称是什么意思

- **Create**：从原始内容生成最终作品。
- **Visual Article**：把长文章转换为更容易理解的视觉内容。
- **Site**：交付为可独立打开、部署和分享的静态网站。

## 支持的输入

- 当前 Chrome 文章
- 公开网页链接
- PDF 文件
- Markdown 文件
- 用户粘贴的原文

## 核心特点

- 完整保留原文，不用摘要冒充正文
- 正文、一页纸、秒懂漫画共用同一份事实来源
- 支持完整展开，覆盖全部重要事实、风险和行动项
- 自动检查内容完整性、文件安全和排版质量
- 输出为离线可用的静态网站和完整 Markdown
- 支持桌面端、手机端和打印布局

## 安装

```bash
npx skills add shadow71833-sketch/create-visual-article-site \
  --skill create-visual-article-site \
  --agent codex \
  -g -y
```

## 使用

```text
使用 $create-visual-article-site 把当前 Chrome 文章制作成三视图静态网站。
```

完整展开：

```text
使用 $create-visual-article-site 把当前文件制作成三视图静态网站。
内容一定要全，排版整齐，输出前完成内容与视觉自检。
```
