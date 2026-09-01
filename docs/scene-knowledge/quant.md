# 量化交易场景

能力：行情、K线/量柱、组合、策略、回测与风险分析。

**右侧 Tools 子架构（必走）：** 行情 / 组合 / 策略 / 雷达 / 研究笔记。

工具：`quant.market.query` 查询 OHLCV；`quant.portfolio.create` 创建 Skill 模拟组合并同步右侧组合面板；`quant.strategy.run` 运行策略并同步组合结果；`quant.radar.create` / `quant.note.add` 同步雷达与研究笔记。用户要求创建组合时，只生成 Skill 文档不算完成，必须调用组合工具。

约束：默认模拟交易，不连接真实券商；不得编造价格；真正行情和组合结果必须由右侧 tools 写入并刷新。
