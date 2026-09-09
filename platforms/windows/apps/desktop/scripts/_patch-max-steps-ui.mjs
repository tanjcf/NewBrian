import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../src/renderer/ui.tsx", import.meta.url);
let source = readFileSync(path, "utf8");
const oldBlock = `      setChatStatus("模型回复成功。");
      setErrorMessage("");
      if (result.softStopReason === "max_steps") {
        setGenerationFailure({
          threadId: targetThreadId,
          message: "本轮探索已达安全步数上限，已停止继续调用工具。已保留当前进度，可反馈此异常，或基于阶段性结果继续。"
        });
        setChatStatus("已达安全步数上限，正在打开异常上报确认…");
        void startUsageExceptionFeedback(
          "没有输出结果，达到安全步数上限，需要结束并基于当前步数做最终输出",
          "newbrain使用异常：没有输出结果，达到安全步数上限"
        );
      }
`;
const newBlock = `      setChatStatus(
        result.softStopReason === "max_steps"
          ? "已达安全步数上限，已基于当前进度生成一版阶段性稿件。"
          : "模型回复成功。"
      );
      setErrorMessage("");
`;
if (!source.includes(oldBlock)) {
  console.error("OLD_NOT_FOUND");
  process.exit(1);
}
writeFileSync(path, source.replace(oldBlock, newBlock), "utf8");
console.log("patched ui.tsx");
