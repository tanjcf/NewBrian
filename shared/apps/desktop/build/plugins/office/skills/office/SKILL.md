---
name: office
description: Open and convert Word, Excel, and PowerPoint files with the local Office suite. Prefer free LibreOffice.
---
# Office

Brain 的 Office 插件用本机套件编辑 Word、Excel 和 PPT，不把文件上传到金山或微软的网页服务。

- 新建文件仍用已有工具：`document.create_docx`、`document.create_pdf`、`artifact.create`（`format` 为 `pptx` 或 `xlsx`）。
- 打开已有文件用 `office.open`，路径必须在当前项目内，例如 `outputs/汇报.docx`。
- 先调用 `office.status`。可用编辑器的顺序是 LibreOffice、WPS、Microsoft Office。
- 转换成 pdf、docx、xlsx、pptx、odt、ods、odp 或 csv 时用 `office.convert`。转换只走 LibreOffice，结果写到 `outputs/`。
- 本机没有 LibreOffice、WPS、Microsoft Office 时，如实说明，并给出 LibreOffice 下载页 https://www.libreoffice.org/download/ 。不要声称已经在网页里打开了文件。
- 转换或打开失败时返回工具错误，不要改用 shell 启动未知程序。
