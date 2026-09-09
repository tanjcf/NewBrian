export function buildErrorRemediationRequest() {
  return [
    "执行每日 NewBrain 异常修复闭环。",
    "1. 调用 errer_outf.read_errors 读取 OPEN 异常；没有异常时直接报告无待处理项。",
    "2. 对每条异常先调用 errer_outf.update_status 将状态改为 FIXING，再检查用户系统环境、NewBrain 版本、出现次数和堆栈。",
    "3. 在 NewBrain 项目中复现根因，先编写能够失败的回归测试并确认失败原因，再做最小修复。",
    "4. 运行相关单元、边界集成、自动化测试和生产构建；保留每条实际命令、exit_code 和结果摘要。",
    "5. 只有自动化测试全部通过且原异常路径得到验证，才调用 errer_outf.update_status 将该条状态改为 FIXED，并传入 verification：original_error_verified=true、tests 数组（每项包含 command、exit_code=0、result）和 summary。",
    "6. 测试失败、未运行、无法复现或仍有安全风险时不得标记 FIXED；保持 OPEN 或标记 FIXING并记录阻塞原因。",
    "禁止泄露令牌、密钥、用户目录或无关日志。"
  ].join("\n");
}
