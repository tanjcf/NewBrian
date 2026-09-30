# NewBrian

公开仓库用于打包一个能安装、能打开、能用自备模型进行文字对话的桌面程序。

`rust/brain-core` 源码不在这个仓库里。打包时从 `rust-core-release.json` 下载官方程序，核对 sha256 后放进安装包。校验不一致就停止打包。桌面启动官方程序前会再次核对。

```powershell
node scripts/materialize.mjs windows
```

然后在生成的 Windows 工程里执行现有的打包命令。`rust-core-release.json` 还没有官方下载地址时，打包会停在下载步骤，不会编出一份没有核心的安装包。

公开源码使用 MIT 许可。`brain-core` 程序只允许原样随安装包分发。专有专家提示词、公司密钥、测试环境和签名证书不在这个仓库里。
