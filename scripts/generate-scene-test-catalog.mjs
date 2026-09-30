/**
 * Generates exhaustive per-scene operation catalogs (≥150 ops each, every op listed).
 * Usage: node scripts/generate-scene-test-catalog.mjs [scene|all]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs/evidence/scene-tests/catalog");

function op(opId, title, precondition, steps, expected, automation = "CDP", blocking = false) {
  return { opId, title, precondition, steps: Array.isArray(steps) ? steps : [steps], expected, automation, blocking };
}

function pad(n, width = 3) {
  return String(n).padStart(width, "0");
}

const SCENE_TABS = {
  quant: ["market", "portfolio", "strategy", "radar", "research"],
  game: ["project", "design", "world", "level", "combat", "assets"],
  video: ["media", "script", "storyboard", "timeline", "caption", "export"],
  music: ["audio", "lyrics", "arrangement", "tracks", "mix", "export"],
  data: ["import", "table", "clean", "analysis", "chart", "notes", "flow"],
  software: ["files", "code", "terminal", "test", "flow", "deploy"],
  document: ["files", "outline", "body", "citation", "slides", "review"]
};

const SCENE_LABELS = {
  quant: "量化交易", game: "游戏制作", video: "视频制作", music: "音乐创作",
  data: "数据与决策", software: "软件与自动化", document: "文档创作"
};

function buildL0Shell(scene) {
  const label = SCENE_LABELS[scene];
  const ops = [];
  let seq = 0;
  const navTargets = Object.entries(SCENE_LABELS);

  ops.push(op(`${scene}.L0.NAV.${pad(++seq)}`, "打开工作台场景切换菜单", "应用已启动", "点击左上角工作台切换器", "弹出 7 个场景选项"));
  for (const [key, name] of navTargets) {
    ops.push(op(`${scene}.L0.NAV.${pad(++seq)}`, `切换到「${name}」场景`, "切换菜单已打开", `点击 ${key}`, `selectedWorkspaceKey === "${key}"`));
  }
  ops.push(op(`${scene}.L0.NAV.${pad(++seq)}`, `切回「${label}」场景`, "当前在其他场景", `切换到 ${scene}`, `selectedWorkspaceKey === "${scene}"`));
  ops.push(op(`${scene}.L0.NAV.${pad(++seq)}`, "点击新对话", `在 ${scene}`, "点击新对话", "进入对话态"));
  ops.push(op(`${scene}.L0.NAV.${pad(++seq)}`, "打开全局搜索", `在 ${scene}`, "Ctrl+K", "搜索面板可见"));
  ops.push(op(`${scene}.L0.NAV.${pad(++seq)}`, "折叠项目分区", "分区展开", "点击折叠", "项目列表隐藏"));
  ops.push(op(`${scene}.L0.NAV.${pad(++seq)}`, "展开项目分区", "分区折叠", "再次点击", "项目列表可见"));
  ops.push(op(`${scene}.L0.NAV.${pad(++seq)}`, "折叠聊天分区", "分区展开", "点击折叠", "聊天列表隐藏"));
  ops.push(op(`${scene}.L0.NAV.${pad(++seq)}`, "展开聊天分区", "分区折叠", "再次点击", "聊天列表可见"));
  for (const mode of ["project", "list", "priority", "updated"]) {
    ops.push(op(`${scene}.L0.NAV.${pad(++seq)}`, `侧栏整理：${mode}`, "organize 菜单", `选 ${mode}`, `sidebarOrganizeMode === "${mode}"`));
  }
  ops.push(op(`${scene}.L0.NAV.${pad(++seq)}`, "项目显示更多", "项目>5", "点击显示更多", "全量展示"));
  ops.push(op(`${scene}.L0.NAV.${pad(++seq)}`, "项目显示更少", "已展开", "点击显示更少", "仅前5项"));

  seq = 0;
  ops.push(op(`${scene}.L0.PROJ.${pad(++seq)}`, "打开添加项目菜单", `在 ${scene}`, "点击+", "菜单可见"));
  ops.push(op(`${scene}.L0.PROJ.${pad(++seq)}`, "打开新建空白项目对话框", "菜单已开", "点新建空白", "dialog 可见"));
  ops.push(op(`${scene}.L0.PROJ.${pad(++seq)}`, "新建：输入名称", "dialog 开", "输入名称", "input 非空"));
  ops.push(op(`${scene}.L0.PROJ.${pad(++seq)}`, "新建：提交", "名称已填", "点保存", `primaryWorkspaceKey === "${scene}"`, "CDP", true));
  ops.push(op(`${scene}.L0.PROJ.${pad(++seq)}`, "新建：取消", "dialog 开", "点取消", "dialog 关闭"));
  ops.push(op(`${scene}.L0.PROJ.${pad(++seq)}`, "新建：空名禁用", "dialog 开", "清空名称", "保存 disabled"));
  ops.push(op(`${scene}.L0.PROJ.${pad(++seq)}`, "选 BRAIN 项目第一项", "列表非空", "点击第一项", "selectedBrainProjectId 更新"));
  ops.push(op(`${scene}.L0.PROJ.${pad(++seq)}`, "选 BRAIN 对话第一项", "对话非空", "点击第一项", "selectedBrainConversationId 更新"));
  ops.push(op(`${scene}.L0.PROJ.${pad(++seq)}`, "验证项目仅当前场景", "刚创建", `listBrainProjects workspaceKey=${scene}`, "命中；其他场景不含", "IPC", true));
  ops.push(op(`${scene}.L0.PROJ.${pad(++seq)}`, "使用现有文件夹", "菜单已开", "点使用现有文件夹", "文件夹选择器", "NATIVE"));
  ops.push(op(`${scene}.L0.PROJ.${pad(++seq)}`, "跨场景最近可见", "有其他场景项目", "查看最近", "不含当前场景项"));
  ops.push(op(`${scene}.L0.PROJ.${pad(++seq)}`, "点击跨场景最近", "最近非空", "点击一项", "跳转对应场景"));
  ops.push(op(`${scene}.L0.PROJ.${pad(++seq)}`, "legacy 展开线程", "有 legacy 项目", "点展开", "线程可见"));
  ops.push(op(`${scene}.L0.PROJ.${pad(++seq)}`, "legacy 折叠线程", "已展开", "点折叠", "线程隐藏"));
  ops.push(op(`${scene}.L0.PROJ.${pad(++seq)}`, "选 legacy 项目", "catalog 非空", "点击项目", "selectedWorkspaceId 更新"));
  ops.push(op(`${scene}.L0.PROJ.${pad(++seq)}`, "BRAIN 项目空态", "无项目", "查看空态", "当前场景还没有 BRAIN 项目"));

  seq = 0;
  ops.push(op(`${scene}.L0.CONV.${pad(++seq)}`, "对话空态", "有项目无对话", "查看列表", "当前项目还没有对话"));
  ops.push(op(`${scene}.L0.CONV.${pad(++seq)}`, "切换对话第二项", "对话≥2", "点第二项", "选中更新"));
  ops.push(op(`${scene}.L0.CONV.${pad(++seq)}`, "对话相对时间", "有 updatedAt", "读 time", "非空"));
  ops.push(op(`${scene}.L0.CONV.${pad(++seq)}`, "对话 sidebar 同步", "点对话", "查 row", "brain-conversation:id"));
  ops.push(op(`${scene}.L0.CONV.${pad(++seq)}`, "项目 sidebar 同步", "点项目", "查 row", "brain-project:id"));
  ops.push(op(`${scene}.L0.CONV.${pad(++seq)}`, "选 chat 线程", "有 chat 线程", "点击", "selectedThreadId 更新"));
  ops.push(op(`${scene}.L0.CONV.${pad(++seq)}`, "pin 线程", "hover", "pin", "状态切换"));
  ops.push(op(`${scene}.L0.CONV.${pad(++seq)}`, "archive 线程", "hover", "archive", "archived"));
  ops.push(op(`${scene}.L0.CONV.${pad(++seq)}`, "新对话绑场景", `在 ${scene}`, "新对话", "绑定当前场景"));
  ops.push(op(`${scene}.L0.CONV.${pad(++seq)}`, "composer 可用", "选 brain 对话", "查 input", "可输入"));

  seq = 0;
  for (const tab of ["files", "artifacts", "tasks"]) {
    ops.push(op(`${scene}.L0.RES.${pad(++seq)}`, `全局资源 Tab ${tab}`, "右栏可见", `点 ${tab}`, `active === ${tab}`));
  }
  for (const tab of SCENE_TABS[scene]) {
    ops.push(op(`${scene}.L0.RES.${pad(++seq)}`, `场景 Tab ${tab}`, `在 ${scene}`, `点 ${tab}`, `workspaceSceneTab === ${tab}`));
  }
  ops.push(op(`${scene}.L0.RES.${pad(++seq)}`, "选文件行", "files 有文件", "点击", "selectedFileId 更新"));
  ops.push(op(`${scene}.L0.RES.${pad(++seq)}`, "产物列表", "artifacts Tab", "打开", "列表或空态"));
  ops.push(op(`${scene}.L0.RES.${pad(++seq)}`, "任务列表", "tasks Tab", "打开", "列表或空态"));
  ops.push(op(`${scene}.L0.RES.${pad(++seq)}`, "右栏标题含场景名", `在 ${scene}`, "读 header", `含 ${label}`));

  seq = 0;
  const comp = [
    ["输入空文本", "聚焦", "不输入", "send 拦截或 disabled"],
    ["输入短文本", "聚焦", "输入测试", "value 正确"],
    ["Enter 发送", "有文本", "Enter", "消息发出"],
    ["点击发送", "有文本", "点 send", "消息发出"],
    ["停止生成", "回复中", "点停止", "取消 in-flight"],
    ["打开+菜单", "可见", "点+", "菜单展开"],
    ["权限审批", "可见", "选 approval", "mode=approval"],
    ["权限 Agent", "可见", "选 agent", "mode=agent"],
    ["权限完全", "可见", "选 full", "mode=full"],
    ["Skill 打开", "可见", "开 picker", "列表可见"],
    ["Skill 清除", "已选", "清除", "空"],
    ["@上下文", "可见", "toggle", "状态切换"],
    ["模型菜单", "可见", "打开", "列表可见"],
    ["推理切换", "菜单开", "切换", "变化"],
    ["速度切换", "菜单开", "切换", "变化"],
    ["语音切换", "可见", "点 voice", "dictation 切换"],
    ["附件移除", "有附件", "移除", "减少"],
    ["队列编辑", "有 draft", "edit", "可编辑"],
    ["队列 steer", "有 draft", "steer", "生效"],
    ["队列 followup", "有 draft", "followup", "排队"],
    ["队列 interrupt", "有 draft", "interrupt", "生效"],
    ["队列清除", "有 draft", "clear", "空"],
    ["回到底部", "已滚动", "jump", "到底"]
  ];
  for (const [title, pre, step, exp] of comp) {
    ops.push(op(`${scene}.L0.COMP.${pad(++seq)}`, `Composer ${title}`, pre, step, exp));
  }
  ops.push(op(`${scene}.L0.COMP.${pad(++seq)}`, "Composer 添加文件", "+菜单", "文件和图片", "系统对话框", "NATIVE"));

  return ops;
}

function sectionOps(scene, sectionKey, title, extra = []) {
  const ops = [];
  let seq = 0;
  const base = `${scene}.L1.section.${sectionKey}`;
  ops.push(op(`${base}.${pad(++seq)}`, `${title}：进入编辑器`, "已选项目", `打开 ${sectionKey} Tab`, `brain-section-${sectionKey} 可见`));
  ops.push(op(`${base}.${pad(++seq)}`, `${title}：加载内容`, "编辑器可见", "等待 load", "state=ready 或 idle"));
  ops.push(op(`${base}.${pad(++seq)}`, `${title}：编辑内容`, "ready", "textarea 输入文本", "dirty 标记"));
  ops.push(op(`${base}.${pad(++seq)}`, `${title}：保存`, "有改动", "点保存", "revision+1", "CDP", true));
  ops.push(op(`${base}.${pad(++seq)}`, `${title}：保存后标签`, "已保存", "读 updatedLabel", "含修订号"));
  ops.push(op(`${base}.${pad(++seq)}`, `${title}：无项目空态`, "无 projectId", "打开 Tab", "请先选择项目"));
  ops.push(op(`${base}.${pad(++seq)}`, `${title}：冲突重载`, "模拟冲突", "点重新加载", "content 刷新"));
  for (const [t, pre, step, exp] of extra) {
    ops.push(op(`${base}.${pad(++seq)}`, `${title}：${t}`, pre, step, exp));
  }
  return ops;
}

function designPanelOps(sectionKey, title) {
  const ops = [];
  let seq = 0;
  const base = `game.L1.design.${sectionKey}`;
  const fields = ["coreExperience", "coreLoop", "playerGoal", "scope"];
  const labels = ["核心体验", "核心循环", "玩家目标", "版本范围"];
  ops.push(op(`${base}.${pad(++seq)}`, `${title}：进入面板`, "已选项目", `Tab ${sectionKey}`, `brain-design-${sectionKey} 可见`));
  for (let i = 0; i < fields.length; i++) {
    ops.push(op(`${base}.${pad(++seq)}`, `${title}：编辑${labels[i]}`, "面板可见", `输入 ${fields[i]}`, "fields 更新"));
  }
  ops.push(op(`${base}.${pad(++seq)}`, `${title}：保存 JSON`, "已编辑", "点保存", "revision+1", "CDP", true));
  ops.push(op(`${base}.${pad(++seq)}`, `${title}：保存成功消息`, "保存后", "读 message", "策划稿已保存"));
  return ops;
}

function buildQuantL1() {
  const s = "quant";
  const ops = [];
  let seq = 0;
  const symbols = ["600519", "000001", "300750"];
  const intervals = ["日线", "周线", "月线"];
  const adjustments = ["前复权", "后复权", "不复权"];

  for (const sym of symbols) {
    ops.push(op(`${s}.L1.market.${pad(++seq)}`, `行情：输入代码 ${sym}`, "market Tab", `symbol=${sym}`, "input 更新"));
  }
  for (const iv of intervals) {
    ops.push(op(`${s}.L1.market.${pad(++seq)}`, `行情：选周期 ${iv}`, "market Tab", `interval=${iv}`, "select 更新"));
  }
  for (const adj of adjustments) {
    ops.push(op(`${s}.L1.market.${pad(++seq)}`, `行情：选复权 ${adj}`, "market Tab", `adjustment=${adj}`, "select 更新"));
  }
  ops.push(op(`${s}.L1.market.${pad(++seq)}`, "行情：设开始日期", "market Tab", "选 startDate", "ui.startDate 有值"));
  ops.push(op(`${s}.L1.market.${pad(++seq)}`, "行情：设结束日期", "market Tab", "选 endDate", "ui.endDate 有值"));
  ops.push(op(`${s}.L1.market.${pad(++seq)}`, "行情：点击查询", "参数已设", "点查询行情", "queryQuantBars 调用"));
  ops.push(op(`${s}.L1.market.${pad(++seq)}`, "行情：K 线渲染", "有 bars", "查 svg", "brain-quant-market-chart 有 rect"));
  ops.push(op(`${s}.L1.market.${pad(++seq)}`, "行情：空态文案", "无 bars", "查 empty", "暂无行情数据"));
  ops.push(op(`${s}.L1.market.${pad(++seq)}`, "行情：状态栏", "market Tab", "读 status", "含不连接真实券商"));
  ops.push(op(`${s}.L1.market.${pad(++seq)}`, "行情：区间涨跌幅", "有 bars", "读 span", "含 %"));
  ops.push(op(`${s}.L1.market.${pad(++seq)}`, "行情：轴标签", "有 bars", "读 axis", "最高/最低"));

  seq = 0;
  ops.push(op(`${s}.L1.portfolio.${pad(++seq)}`, "组合：进入 Tab", "已选项目", "portfolio Tab", "brain-quant-portfolio-view"));
  ops.push(op(`${s}.L1.portfolio.${pad(++seq)}`, "组合：总资产卡", "portfolio Tab", "读 article", "totalValue 显示"));
  ops.push(op(`${s}.L1.portfolio.${pad(++seq)}`, "组合：收益率卡", "portfolio Tab", "读收益率", "percent 显示"));
  ops.push(op(`${s}.L1.portfolio.${pad(++seq)}`, "组合：资金曲线", "有成交", "读 svg path", "equityPath 非空"));
  ops.push(op(`${s}.L1.portfolio.${pad(++seq)}`, "组合：无成交曲线空态", "无成交", "读 small", "完成第一笔模拟交易"));
  for (let i = 1; i <= 5; i++) {
    ops.push(op(`${s}.L1.portfolio.${pad(++seq)}`, `组合：模拟买入第 ${i} 次`, "有行情", "点 brain-quant-buy", "orderStatus 含买入；fills 增加"));
  }
  for (let i = 1; i <= 3; i++) {
    ops.push(op(`${s}.L1.portfolio.${pad(++seq)}`, `组合：模拟卖出第 ${i} 次`, "有持仓", "点 brain-quant-sell", "orderStatus 含卖出"));
  }
  ops.push(op(`${s}.L1.portfolio.${pad(++seq)}`, "组合：改数量 100", "portfolio", "quantity=100", "input 值 100"));
  ops.push(op(`${s}.L1.portfolio.${pad(++seq)}`, "组合：改数量 500", "portfolio", "quantity=500", "input 值 500"));
  ops.push(op(`${s}.L1.portfolio.${pad(++seq)}`, "组合：ledger 守恒", "多笔交易后", "cash+marketValue=totalValue", "守恒成立", "IPC", true));
  ops.push(op(`${s}.L1.portfolio.${pad(++seq)}`, "组合：持仓列表", "有持仓", "brain-quant-positions", "li 非空"));
  ops.push(op(`${s}.L1.portfolio.${pad(++seq)}`, "组合：成交记录", "有 fills", "fill-list", "article 非空"));
  ops.push(op(`${s}.L1.portfolio.${pad(++seq)}`, "组合：无行情禁买", "bars 空", "点买入", "暂无真实行情"));

  seq = 0;
  ops.push(op(`${s}.L1.strategy.${pad(++seq)}`, "策略：进入 Tab", "已选项目", "strategy Tab", "brain-quant-skills"));
  ops.push(op(`${s}.L1.strategy.${pad(++seq)}`, "策略：空态", "无 performance", "读 empty", "尚无 Skill 模拟收益"));
  ops.push(op(`${s}.L1.strategy.${pad(++seq)}`, "策略：performance 列表", "有 run", "读 schedule-list", "含 skillId 与收益"));

  seq = 0;
  const exchanges = ["SSE", "SZSE", "BSE"];
  ops.push(op(`${s}.L1.radar.${pad(++seq)}`, "雷达：进入 Tab", "已选项目", "radar Tab", "股市雷达 header"));
  ops.push(op(`${s}.L1.radar.${pad(++seq)}`, "雷达：输入 skillId", "radar Tab", "改 skillId", "input 更新"));
  for (const ex of exchanges) {
    ops.push(op(`${s}.L1.radar.${pad(++seq)}`, `雷达：选交易所 ${ex}`, "radar Tab", `exchange=${ex}`, "select 更新"));
  }
  ops.push(op(`${s}.L1.radar.${pad(++seq)}`, "雷达：设执行时间", "radar Tab", "runAt=15:10", "time input 更新"));
  for (let i = 1; i <= 4; i++) {
    ops.push(op(`${s}.L1.radar.${pad(++seq)}`, `雷达：创建计划第 ${i} 个`, "参数已设", "创建模拟计划", "schedules 增加"));
  }
  for (let i = 1; i <= 4; i++) {
    ops.push(op(`${s}.L1.radar.${pad(++seq)}`, `雷达：启用/暂停第 ${i} 个`, "有 schedule", "toggle enabled", "状态切换"));
  }
  for (let i = 1; i <= 4; i++) {
    ops.push(op(`${s}.L1.radar.${pad(++seq)}`, `雷达：展开记录第 ${i} 个`, "有 schedule", "查看记录", "run-list 可见"));
  }
  ops.push(op(`${s}.L1.radar.${pad(++seq)}`, "雷达：空态", "无 schedule", "读 empty", "尚未创建量化 Skill 计划"));

  ops.push(...sectionOps("quant", "research", "研究笔记"));
  return ops;
}

function buildGameL1() {
  const s = "game";
  const ops = [];
  let seq = 0;
  ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, "进入项目与文件", "已选项目", "project Tab", "brain-game-workspace"));
  ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, "无项目 idle", "无 projectId", "打开 Tab", "brain-game-idle"));
  ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, "重新检查工程", "有项目", "点重新检查", "status=loading→ready"));
  ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, "读引擎类型", "inspect 成功", "brain-game-engine", "Web/Godot/Unity/Unreal"));
  ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, "读扫描范围", "inspect 成功", "读 scannedEntries", "数字显示"));
  ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, "读工程标记", "inspect 成功", "读 markers", "字符串"));
  for (const asset of ["脚本", "场景", "图片", "音频", "视频", "模型", "其他"]) {
    ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, `资产计数：${asset}`, "inspect 成功", "读 article", "计数显示"));
  }
  ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, "Web 模板向导可见", "Web 项目", "查 wizard", "创建 Web 模板按钮"));
  ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, "创建 Web 模板", "有 localWorkspace", "点创建", "目录生成", "NATIVE"));
  ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, "预览命令显示", "preview.supported", "读 code", "含 npm/node"));
  ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, "启动试玩", "有 preview", "启动试玩", "status STARTING", "NATIVE"));
  ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, "轮询预览状态", "STARTING", "等待", "READY 或 FAILED"));
  ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, "打开试玩", "READY", "打开试玩", "openBrowserPreview"));
  ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, "保存截图", "READY", "保存试玩截图", "evidence path", "NATIVE"));
  ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, "停止试玩", "运行中", "停止试玩", "CANCELLED/SUCCEEDED"));
  ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, "预览日志", "有 output", "展开 details", "pre 非空"));
  ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, "无 localWorkspace 错误", "无绑定", "inspect 失败", "关联本地文件夹提示"));
  ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, "跨场景产物列表", "有 artifacts", "brain-game-artifacts", "含 sourceWorkspaceKey"));
  ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, "Unreal Epic 引导", "engine=unreal", "检测 Epic", "ensureBrainEngine"));
  ops.push(op(`${s}.L1.workspace.${pad(++seq)}`, "注意事项列表", "有 warnings", "读 warnings", "p 非空"));
  ops.push(...sectionOps("game", "design", "游戏策划"));
  ops.push(...designPanelOps("world", "角色与世界观"));
  ops.push(...designPanelOps("level", "关卡设计"));
  ops.push(...designPanelOps("combat", "战斗设计"));
  ops.push(op(`${s}.L1.assets.${pad(1)}`, "进入资产与测试 Tab", "已选项目", "assets Tab", "同 brain-game-workspace"));
  return ops;
}

function buildVideoL1() {
  const s = "video";
  const ops = [];
  let seq = 0;
  ops.push(op(`${s}.L1.media.${pad(++seq)}`, "进入项目与素材", "已选项目", "media Tab", "brain-video-workspace"));
  ops.push(op(`${s}.L1.media.${pad(++seq)}`, "选素材文件", "有 files", "brain-video-file-select", "fileId 更新"));
  ops.push(op(`${s}.L1.media.${pad(++seq)}`, "文件列表点选", "有 files", "点列表 button", "active 样式"));
  ops.push(op(`${s}.L1.media.${pad(++seq)}`, "加入时间线", "已选 file", "brain-video-add-clip", "clips 增加"));
  ops.push(op(`${s}.L1.media.${pad(++seq)}`, "刷新时间线", "media Tab", "点刷新", "getVideoTimeline"));
  ops.push(op(`${s}.L1.media.${pad(++seq)}`, "素材空态", "无 files", "读 empty", "还没有可用素材"));
  ops.push(...sectionOps("video", "script", "脚本"));
  seq = 0;
  for (let shot = 1; shot <= 5; shot++) {
    ops.push(op(`${s}.L1.storyboard.${pad(++seq)}`, `分镜：镜号 ${shot} 输入`, "storyboard Tab", `shot${shot}`, "rows 更新"));
    ops.push(op(`${s}.L1.storyboard.${pad(++seq)}`, `分镜：画面 ${shot} 输入`, "storyboard Tab", `visual${shot}`, "rows 更新"));
    ops.push(op(`${s}.L1.storyboard.${pad(++seq)}`, `分镜：时长 ${shot} 输入`, "storyboard Tab", `durationMs${shot}`, "rows 更新"));
    ops.push(op(`${s}.L1.storyboard.${pad(++seq)}`, `分镜：素材 ${shot} 选择`, "有 files", `assetFileId${shot}`, "select 更新"));
  }
  ops.push(op(`${s}.L1.storyboard.${pad(++seq)}`, "分镜：添加镜头", "storyboard Tab", "添加镜头", "rows+1"));
  ops.push(op(`${s}.L1.storyboard.${pad(++seq)}`, "分镜：保存", "有 rows", "保存", "revision+1", "CDP", true));
  ops.push(op(`${s}.L1.storyboard.${pad(++seq)}`, "分镜：写入时间线", "有 asset", "brain-video-storyboard-push", "addVideoClip 多次"));
  seq = 0;
  ops.push(op(`${s}.L1.timeline.${pad(++seq)}`, "进入时间线 Tab", "已选项目", "timeline Tab", "brain-video-timeline"));
  ops.push(op(`${s}.L1.timeline.${pad(++seq)}`, "读 meta fps", "timeline Tab", "brain-video-timeline-meta", "含 fps"));
  ops.push(op(`${s}.L1.timeline.${pad(++seq)}`, "视频轨 clip", "有 clip", "video track lane", "clip div 可见"));
  ops.push(op(`${s}.L1.timeline.${pad(++seq)}`, "音频轨", "有 audio clip", "audio track", "lane 可见"));
  ops.push(op(`${s}.L1.timeline.${pad(++seq)}`, "字幕轨", "有 subtitle", "subtitle track", "lane 可见"));
  seq = 0;
  for (let cue = 1; cue <= 5; cue++) {
    ops.push(op(`${s}.L1.caption.${pad(++seq)}`, `字幕：入点 ${cue}`, "caption Tab", `startMs${cue}`, "cues 更新"));
    ops.push(op(`${s}.L1.caption.${pad(++seq)}`, `字幕：出点 ${cue}`, "caption Tab", `endMs${cue}`, "cues 更新"));
    ops.push(op(`${s}.L1.caption.${pad(++seq)}`, `字幕：台词 ${cue}`, "caption Tab", `text${cue}`, "cues 更新"));
  }
  ops.push(op(`${s}.L1.caption.${pad(++seq)}`, "字幕：添加", "caption Tab", "添加字幕", "cues+1"));
  ops.push(op(`${s}.L1.caption.${pad(++seq)}`, "字幕：保存草稿", "有 cues", "保存草稿", "revision+1"));
  ops.push(op(`${s}.L1.caption.${pad(++seq)}`, "字幕：写入轨", "有 text", "brain-video-caption-import", "importVideoSubtitles"));
  seq = 0;
  ops.push(op(`${s}.L1.export.${pad(++seq)}`, "进入导出 Tab", "已选项目", "export Tab", "brain-video-preview"));
  ops.push(op(`${s}.L1.export.${pad(++seq)}`, "渲染视频", "有 video clip", "brain-video-render", "render STARTING", "NATIVE"));
  ops.push(op(`${s}.L1.export.${pad(++seq)}`, "取消渲染", "RUNNING", "brain-video-cancel", "CANCELLED"));
  ops.push(op(`${s}.L1.export.${pad(++seq)}`, "渲染成功预览", "SUCCEEDED", "brain-video-preview-result", "outputFileId 非空"));
  ops.push(op(`${s}.L1.export.${pad(++seq)}`, "无 clip 禁渲染", "无 video clip", "按钮 disabled", "disabled"));
  return ops;
}

function buildMusicL1() {
  const s = "music";
  const ops = [];
  let seq = 0;
  ops.push(op(`${s}.L1.audio.${pad(++seq)}`, "进入项目与音频", "已选项目", "audio Tab", "brain-music-workspace"));
  ops.push(op(`${s}.L1.audio.${pad(++seq)}`, "选音频文件", "有 files", "brain-music-file-select", "fileId 更新"));
  ops.push(op(`${s}.L1.audio.${pad(++seq)}`, "加入音频 clip", "已选 file", "brain-music-add-audio", "clips 增加"));
  ops.push(op(`${s}.L1.audio.${pad(++seq)}`, "加入 MIDI clip", "已选 file", "加入 MIDI", "midi clip 增加"));
  ops.push(op(`${s}.L1.audio.${pad(++seq)}`, "源文件 preview audio", "有 previewUrl", "audio controls", "可播放"));
  ops.push(op(`${s}.L1.audio.${pad(++seq)}`, "刷新时间线", "audio Tab", "刷新", "getMusicTimeline"));
  ops.push(...sectionOps("music", "lyrics", "歌词"));
  seq = 0;
  ops.push(op(`${s}.L1.arrangement.${pad(++seq)}`, "进入编曲 Tab", "已选项目", "arrangement Tab", "brain-music-composition"));
  ops.push(op(`${s}.L1.arrangement.${pad(++seq)}`, "编辑主题", "面板可见", "输入 theme", "更新"));
  ops.push(op(`${s}.L1.arrangement.${pad(++seq)}`, "编辑 BPM", "面板可见", "bpm=120", "更新"));
  ops.push(op(`${s}.L1.arrangement.${pad(++seq)}`, "编辑调性", "面板可见", "keySignature", "更新"));
  ops.push(op(`${s}.L1.arrangement.${pad(++seq)}`, "编辑歌词区", "面板可见", "lyrics textarea", "更新"));
  ops.push(op(`${s}.L1.arrangement.${pad(++seq)}`, "编辑编曲说明", "面板可见", "arrangement textarea", "更新"));
  ops.push(op(`${s}.L1.arrangement.${pad(++seq)}`, "保存并同步", "已编辑", "保存并同步时间线", "lyrics+arrangement revision+1"));
  ops.push(op(`${s}.L1.tracks.${pad(++seq)}`, "进入音轨 Tab", "已选项目", "tracks Tab", "timeline 视图"));
  ops.push(op(`${s}.L1.tracks.${pad(++seq)}`, "audio 轨 clip", "有 clip", "audio lane", "可见"));
  ops.push(op(`${s}.L1.tracks.${pad(++seq)}`, "midi 轨 clip", "有 midi", "midi lane", "可见"));
  ops.push(...sectionOps("music", "mix", "混音"));
  seq = 0;
  ops.push(op(`${s}.L1.export.${pad(++seq)}`, "进入导出 Tab", "已选项目", "export Tab", "brain-music-preview"));
  ops.push(op(`${s}.L1.export.${pad(++seq)}`, "渲染混音", "有 clip", "brain-music-render", "STARTING", "NATIVE"));
  ops.push(op(`${s}.L1.export.${pad(++seq)}`, "取消渲染", "RUNNING", "brain-music-cancel", "CANCELLED"));
  ops.push(op(`${s}.L1.export.${pad(++seq)}`, "混音成功", "SUCCEEDED", "brain-music-preview-result", "outputFileId"));
  ops.push(op(`${s}.L1.export.${pad(++seq)}`, "波形显示", "SUCCEEDED", "brain-music-waveform", "span 非空"));
  ops.push(op(`${s}.L1.export.${pad(++seq)}`, "inspect 时长采样率", "SUCCEEDED", "brain-music-media-info", "duration+sampleRate"));
  ops.push(op(`${s}.L1.export.${pad(++seq)}`, "混音 audio 播放", "有 mixPreviewUrl", "audio 控件", "可播"));
  return ops;
}

function buildDataL1() {
  const s = "data";
  const ops = [];
  let seq = 0;
  ops.push(op(`${s}.L1.import.${pad(++seq)}`, "进入数据导入", "已选项目", "import Tab", "brain-data-workspace"));
  ops.push(op(`${s}.L1.import.${pad(++seq)}`, "选 CSV 文件", "有 csv", "brain-data-file-select", "fileId 更新"));
  ops.push(op(`${s}.L1.import.${pad(++seq)}`, "选 XLSX 文件", "有 xlsx", "brain-data-file-select", "fileId 更新"));
  ops.push(op(`${s}.L1.import.${pad(++seq)}`, "XLSX sheet 选择", "多 sheet", "选 sheet", "xlsxSheet 更新"));
  ops.push(op(`${s}.L1.import.${pad(++seq)}`, "导入 CSV", "选 csv", "brain-data-import", "dataset 创建"));
  ops.push(op(`${s}.L1.import.${pad(++seq)}`, "导入 XLSX sheet1", "选 xlsx", "导入", "dataset 创建"));
  ops.push(op(`${s}.L1.import.${pad(++seq)}`, "导入 XLSX sheet2", "多 sheet", "换 sheet 导入", "第2 dataset"));
  ops.push(op(`${s}.L1.import.${pad(++seq)}`, "导入后运行摘要", "有 dataset", "brain-data-analysis", "analysis 结果"));
  for (const ct of ["line", "bar", "scatter"]) {
    ops.push(op(`${s}.L1.import.${pad(++seq)}`, `导入页图表 ${ct}`, "有 points", `chartType=${ct}`, "brain-data-chart 更新"));
  }
  seq = 0;
  ops.push(op(`${s}.L1.table.${pad(++seq)}`, "进入表格 Tab", "有 dataset", "table Tab", "brain-data-table-wrap"));
  ops.push(op(`${s}.L1.table.${pad(++seq)}`, "选 dataset", "多个", "brain-data-dataset-select", "selected 更新"));
  ops.push(op(`${s}.L1.table.${pad(++seq)}`, "筛选行", "table Tab", "输入 filter", "filtered 变化"));
  ops.push(op(`${s}.L1.table.${pad(++seq)}`, "下一页", "有多页", "下一页", "page+1"));
  ops.push(op(`${s}.L1.table.${pad(++seq)}`, "上一页", "page>0", "上一页", "page-1"));
  ops.push(op(`${s}.L1.table.${pad(++seq)}`, "首页禁上一页", "page=0", "上一页 disabled", "disabled"));
  ops.push(op(`${s}.L1.table.${pad(++seq)}`, "dataset 卡片点击", "import 列表", "点 card", "selected 更新"));
  seq = 0;
  ops.push(op(`${s}.L1.clean.${pad(++seq)}`, "进入清洗 Tab", "有 dataset", "clean Tab", "brain-data-quality"));
  ops.push(op(`${s}.L1.clean.${pad(++seq)}`, "空白单元格数", "有数据", "读 blankCells", "数字"));
  ops.push(op(`${s}.L1.clean.${pad(++seq)}`, "重复行数", "有数据", "读 duplicateRows", "数字"));
  ops.push(op(`${s}.L1.clean.${pad(++seq)}`, "无效数值数", "有数据", "读 invalidNumericCells", "数字"));
  ops.push(op(`${s}.L1.clean.${pad(++seq)}`, "质量结论文案", "有数据", "读 p", "质量提示"));
  seq = 0;
  ops.push(op(`${s}.L1.analysis.${pad(++seq)}`, "进入分析 Tab", "有 dataset", "analysis Tab", "运行摘要按钮"));
  ops.push(op(`${s}.L1.analysis.${pad(++seq)}`, "运行摘要", "有 dataset", "brain-data-analysis", "brain-data-analysis-result"));
  ops.push(op(`${s}.L1.analysis.${pad(++seq)}`, "摘要缓存命中", "再运行", "第二次 summarize", "同 hash 缓存"));
  ops.push(op(`${s}.L1.analysis.${pad(++seq)}`, "读列统计", "有 result", "span 列", "min/max/mean"));
  seq = 0;
  for (const ct of ["line", "bar", "scatter"]) {
    ops.push(op(`${s}.L1.chart.${pad(++seq)}`, `图表 Tab ${ct}`, "chart Tab", `选 ${ct}`, "DataTrendChart 渲染"));
  }
  ops.push(op(`${s}.L1.chart.${pad(++seq)}`, "无可绘制列空态", "无数值列", "读 empty", "没有可绘制的数值列"));
  ops.push(...sectionOps("data", "notes", "分析说明"));
  return [...ops, ...buildFlowL1("data")];
}

function buildFlowL1(prefix) {
  const ops = [];
  let seq = 0;
  ops.push(op(`${prefix}.L1.flow.${pad(++seq)}`, "进入 Flow Tab", "已选项目", "flow Tab", "flow-workspace"));
  ops.push(op(`${prefix}.L1.flow.${pad(++seq)}`, "编辑 Flow 名称", "flow Tab", "flow-name", "name 更新"));
  ops.push(op(`${prefix}.L1.flow.${pad(++seq)}`, "编辑定义 JSON", "flow Tab", "flow-definition", "text 更新"));
  ops.push(op(`${prefix}.L1.flow.${pad(++seq)}`, "非法 JSON", "flow Tab", "输入 {bad", "保存提示无法解析"));
  ops.push(op(`${prefix}.L1.flow.${pad(++seq)}`, "设调度时间", "flow Tab", "flow-schedule-time", "runAt 更新"));
  ops.push(op(`${prefix}.L1.flow.${pad(++seq)}`, "保存 Flow", "合法 JSON", "flow-save", "flow.id 存在", "CDP", true));
  ops.push(op(`${prefix}.L1.flow.${pad(++seq)}`, "未保存禁启动", "无 id", "flow-start disabled", "disabled"));
  ops.push(op(`${prefix}.L1.flow.${pad(++seq)}`, "启动执行", "已保存", "flow-start", "run 创建", "NATIVE"));
  ops.push(op(`${prefix}.L1.flow.${pad(++seq)}`, "读 audit", "有 run", "flow-run pre", "audit 非空"));
  ops.push(op(`${prefix}.L1.flow.${pad(++seq)}`, "刷新运行", "有 run", "刷新运行", "getBrainFlowRun"));
  ops.push(op(`${prefix}.L1.flow.${pad(++seq)}`, "取消运行", "RUNNING", "flow-cancel", "cancelled"));
  ops.push(op(`${prefix}.L1.flow.${pad(++seq)}`, "FAILED 重试", "FAILED", "flow-retry", "新 run"));
  ops.push(op(`${prefix}.L1.flow.${pad(++seq)}`, "保存每日调度", "有 flow", "flow-schedule-create", "schedules 增加"));
  ops.push(op(`${prefix}.L1.flow.${pad(++seq)}`, "调度列表", "有 schedule", "flow-schedules", "runAt 显示"));
  ops.push(op(`${prefix}.L1.flow.${pad(++seq)}`, "重启恢复 Flow", "曾保存", "重启", "definition 一致"));
  return ops;
}

function buildSoftwareL1() {
  const s = "software";
  const ops = [];
  let seq = 0;
  ops.push(op(`${s}.L1.files.${pad(++seq)}`, "进入项目文件", "已选项目", "files Tab", "brain-software-files"));
  ops.push(op(`${s}.L1.files.${pad(++seq)}`, "文件计数", "files Tab", "读 strong", "等于 files.length"));
  ops.push(op(`${s}.L1.files.${pad(++seq)}`, "打开通用文件面板", "files Tab", "点按钮", "切 files 全局 Tab"));
  seq = 0;
  ops.push(op(`${s}.L1.code.${pad(++seq)}`, "进入代码任务", "已绑定项目", "code Tab", "brain-software-code"));
  for (const op_ of ["build", "lint", "format"]) {
    ops.push(op(`${s}.L1.code.${pad(++seq)}`, `显示 ${op_} 脚本`, "有脚本", "读卡片", `${op_} 标签`));
    ops.push(op(`${s}.L1.code.${pad(++seq)}`, `执行 ${op_}`, "卡片可见", "请求执行", "task 创建", "NATIVE"));
    ops.push(op(`${s}.L1.code.${pad(++seq)}`, `轮询 ${op_} 输出`, "RUNNING", "等 status", "output 或终态"));
  }
  ops.push(op(`${s}.L1.code.${pad(++seq)}`, "取消 RUNNING 任务", "RUNNING", "取消任务", "CANCELLED"));
  seq = 0;
  const termCmds = ["git status", "echo BRAIN-1", "echo BRAIN-2", "dir", "node -v", "npm -v"];
  ops.push(op(`${s}.L1.terminal.${pad(++seq)}`, "进入项目终端", "已绑定", "terminal Tab", "brain-software-project-terminal"));
  ops.push(op(`${s}.L1.terminal.${pad(++seq)}`, "启动终端", "已绑定", "启动终端", "isRunning=true", "NATIVE"));
  ops.push(op(`${s}.L1.terminal.${pad(++seq)}`, "cwd 在项目根", "已启动", "读 code", "cwd 正确"));
  for (const cmd of termCmds) {
    ops.push(op(`${s}.L1.terminal.${pad(++seq)}`, `终端命令：${cmd}`, "运行中", `输入 ${cmd} 发送`, "output 含预期"));
  }
  ops.push(op(`${s}.L1.terminal.${pad(++seq)}`, "Enter 提交", "运行中", "form submit", "发送成功"));
  ops.push(op(`${s}.L1.terminal.${pad(++seq)}`, "发送按钮", "运行中", "点发送", "发送成功"));
  ops.push(op(`${s}.L1.terminal.${pad(++seq)}`, "未启动 disabled", "未启动", "input disabled", "true"));
  ops.push(op(`${s}.L1.terminal.${pad(++seq)}`, "重新连接", "已运行", "重新连接", "仍可用"));
  seq = 0;
  ops.push(op(`${s}.L1.test.${pad(++seq)}`, "进入测试 Tab", "已选项目", "test Tab", "brain-software-test"));
  for (let i = 1; i <= 4; i++) {
    ops.push(op(`${s}.L1.test.${pad(++seq)}`, `执行 test 脚本 ${i}`, "有脚本", "请求执行", "task 终态", "NATIVE"));
  }
  seq = 0;
  ops.push(op(`${s}.L1.deploy.${pad(++seq)}`, "进入部署 Tab", "已选项目", "deploy Tab", "brain-software-deploy"));
  ops.push(op(`${s}.L1.deploy.${pad(++seq)}`, "部署警告", "deploy Tab", "读 notice", "外部影响"));
  for (let i = 1; i <= 4; i++) {
    ops.push(op(`${s}.L1.deploy.${pad(++seq)}`, `执行 deploy ${i}`, "有脚本", "请求执行", "task 创建", "NATIVE"));
  }
  ops.push(...buildFlowL1("software"));
  seq = 0;
  ops.push(op(`${s}.L1.task.${pad(++seq)}`, "最近任务面板", "执行过", "读 task", "status 显示"));
  ops.push(op(`${s}.L1.task.${pad(++seq)}`, "任务 output", "有 output", "读 pre", "非空"));
  ops.push(op(`${s}.L1.task.${pad(++seq)}`, "tasks Tab 同步", "有 task", "tasks Tab", "列表含 task"));
  return ops;
}

function buildDocumentL1() {
  const s = "document";
  const ops = [];
  let seq = 0;
  ops.push(op(`${s}.L1.project.${pad(++seq)}`, "进入项目与文件", "已选项目", "files Tab", "brain-document-workspace"));
  ops.push(op(`${s}.L1.project.${pad(++seq)}`, "文档数量", "project Tab", "读 strong", "files.length"));
  ops.push(op(`${s}.L1.project.${pad(++seq)}`, "锚点数量", "project Tab", "读锚点", "availableAnchors.length"));
  ops.push(op(`${s}.L1.project.${pad(++seq)}`, "待处理标注数", "project Tab", "读标注", "OPEN 计数"));
  ops.push(op(`${s}.L1.project.${pad(++seq)}`, "打开文件面板", "project Tab", "点按钮", "files 全局 Tab"));
  const formats = ["txt", "md", "png", "pdf", "docx", "pptx", "xlsx"];
  for (const fmt of formats) {
    ops.push(op(`${s}.L1.ingest.${pad(++seq)}`, `导入 ${fmt.toUpperCase()}`, "有文件", `ingest ${fmt}`, "parseStatus OK"));
  }
  seq = 0;
  for (const view of ["outline", "body", "references", "slides"]) {
    ops.push(op(`${s}.L1.${view}.${pad(++seq)}`, `进入 ${view} Tab`, "有文档", `${view} Tab`, `activeView=${view}`));
    ops.push(op(`${s}.L1.${view}.${pad(++seq)}`, `${view} 选文档`, "多文档", "select 切换", "activeFile 更新"));
    ops.push(op(`${s}.L1.${view}.${pad(++seq)}`, `${view} 画笔开关`, "有文档", "画笔标记", "annotationActive 切换"));
    for (let a = 1; a <= 5; a++) {
      ops.push(op(`${s}.L1.${view}.${pad(++seq)}`, `${view} 锚点 ${a}`, "有锚点", `点锚点 ${a}`, "onSelectAnchor 触发"));
    }
    ops.push(op(`${s}.L1.${view}.${pad(++seq)}`, `${view} 无锚点空态`, "无锚点", "读 empty", "没有结构锚点"));
  }
  seq = 0;
  ops.push(op(`${s}.L1.review.${pad(++seq)}`, "进入审校 Tab", "有文档", "review Tab", "brain-document-review"));
  ops.push(op(`${s}.L1.review.${pad(++seq)}`, "审校画笔", "review Tab", "开始画笔", "annotationActive"));
  for (let i = 1; i <= 5; i++) {
    ops.push(op(`${s}.L1.review.${pad(++seq)}`, `标注 ${i} 加入对话`, "有 annotation", "加入对话", "onSendAnnotation"));
  }
  for (let i = 1; i <= 5; i++) {
    ops.push(op(`${s}.L1.review.${pad(++seq)}`, `change-set ${i} 预览`, "有 changeSet", "预览", "preview 非空"));
    ops.push(op(`${s}.L1.review.${pad(++seq)}`, `change-set ${i} 接受`, "PROPOSED", "接受", "ACCEPTED"));
    ops.push(op(`${s}.L1.review.${pad(++seq)}`, `change-set ${i} 拒绝`, "PROPOSED", "拒绝", "REJECTED"));
  }
  ops.push(op(`${s}.L1.review.${pad(++seq)}`, "导出新版本", "ACCEPTED", "导出新版本", "versionNo+1"));
  ops.push(op(`${s}.L1.review.${pad(++seq)}`, "审校空态", "无标注", "读 empty", "还没有标注"));
  seq = 0;
  ops.push(op(`${s}.L1.preview.${pad(++seq)}`, "PDF 上一页", "PDF 打开", "page prev", "页码减"));
  ops.push(op(`${s}.L1.preview.${pad(++seq)}`, "PDF 下一页", "PDF 打开", "page next", "页码加"));
  ops.push(op(`${s}.L1.preview.${pad(++seq)}`, "PDF 放大", "PDF 打开", "zoom in", "scale 增"));
  ops.push(op(`${s}.L1.preview.${pad(++seq)}`, "PDF 缩小", "PDF 打开", "zoom out", "scale 减"));
  ops.push(op(`${s}.L1.preview.${pad(++seq)}`, "PPT 上一页", "PPT 打开", "slide prev", "减"));
  ops.push(op(`${s}.L1.preview.${pad(++seq)}`, "PPT 下一页", "PPT 打开", "slide next", "加"));
  ops.push(op(`${s}.L1.preview.${pad(++seq)}`, "HTML preview 模式", "HTML 打开", "preview", "渲染"));
  ops.push(op(`${s}.L1.preview.${pad(++seq)}`, "HTML source 模式", "HTML 打开", "source", "源码"));
  ops.push(op(`${s}.L1.preview.${pad(++seq)}`, "保存 PDF 标注", "标注模式", "保存", "annotation 落库"));
  ops.push(op(`${s}.L1.preview.${pad(++seq)}`, "CJK 标注坐标", "PDF CJK", "保存后重启", "坐标可读"));
  return ops;
}

function buildL2(scene) {
  const chains = {
    quant: [
      ["001", "行情查询→买入→ledger", ["设 symbol", "查询", "买入"], "fills+ledger"],
      ["002", "切换标的→再查询", ["改 symbol", "查询"], "chart 更新"],
      ["003", "创建 radar→启用", ["创建计划", "启用"], "schedule enabled"],
      ["004", "research 链 scheduleId", ["写笔记", "保存"], "含 schedule 引用"],
      ["005", "多笔买卖守恒", ["买3卖2"], "ledger 守恒", "IPC", true],
      ["006", "strategy performance 出现", ["run schedule"], "performance 非空"],
      ["007", "portfolio 曲线", ["2笔交易"], "equity svg"],
      ["008", "三周期各查一次", ["日/周/月"], "三次 query"],
      ["009", "三复权各查一次", ["前/后/不复"], "三次 query"],
      ["010", "activity 时间线", ["交易后"], "getQuantActivity"],
      ["011", "雷达展开 runs", ["创建", "展开"], "run-list"],
      ["012", "会话 createQuantSession", ["进场景"], "session 创建", "IPC"]
    ],
    game: [
      ["001", "模板→inspect", ["Web模板", "重新检查"], "engine=web"],
      ["002", "四 section 保存链", ["design/world/level/combat"], "revision 各+1"],
      ["003", "试玩全链", ["启动", "打开", "截图", "停止"], "evidence 存在", "NATIVE"],
      ["004", "对话@截图", ["截图", "@产物"], "消息引用"],
      ["005", "assets=project 同面板", ["切 Tab"], "同 workspace"],
      ["006", "无绑定错误链", ["无 local", "inspect"], "错误提示"],
      ["007", "preview 拒绝", ["拒绝确认"], "DECLINED", "NATIVE"],
      ["008", "artifacts lineage", ["截图后"], "sourceWorkspaceKey=game"],
      ["009", "world→combat 跨 Tab", ["保存 world", "切 combat"], "不串"],
      ["010", "重新检查刷新资产", ["改文件", "重新检查"], "计数变"],
      ["011", "Epic 引导链", ["unreal", "检测"], "ensure engine"],
      ["012", "warnings 显示链", ["有问题工程"], "warnings 非空"]
    ],
    video: [
      ["001", "script→5镜→push", ["脚本", "5镜", "push"], "timeline clips"],
      ["002", "media add clip", ["选文件", "加入"], "clip+1"],
      ["003", "caption→import", ["3 cue", "写入轨"], "subtitle track"],
      ["004", "render 全链", ["render", "等 SUCCESS"], "mp4 fileId", "NATIVE"],
      ["005", "cancel render", ["render", "cancel"], "CANCELLED"],
      ["006", "三轨 timeline", ["video/audio/sub"], "三 lane"],
      ["007", "刷新恢复 timeline", ["add", "刷新"], "clips 仍在"],
      ["008", "export 空态", ["无 clip"], "禁渲染"],
      ["009", "storyboard 保存重启", ["保存", "重启"], "rows 在"],
      ["010", "script 保存重启", ["保存", "重启"], "content 在"],
      ["011", "多素材列表切换", ["点2文件"], "selected 变"],
      ["012", "ffprobe 输出", ["render OK"], "duration>0", "IPC"]
    ],
    music: [
      ["001", "词曲编混链", ["lyrics", "arrangement", "save"], "revision+1"],
      ["002", "audio+midi clip", ["各加1"], "2 clips"],
      ["003", "render 混音", ["render"], "wav fileId", "NATIVE"],
      ["004", "波形+inspect", ["SUCCESS"], "waveform+mediaInfo"],
      ["005", "源 preview 播放", ["选 wav"], "audio 可播"],
      ["006", "mix section 保存", ["mix", "save"], "revision"],
      ["007", "tracks 视图", ["2 clips"], "lanes"],
      ["008", "cancel render", ["cancel"], "CANCELLED"],
      ["009", "重启 timeline", ["重启"], "clips 在"],
      ["010", "BPM/key 持久化", ["改 BPM", "save"], "重启仍在"],
      ["011", "export preview audio", ["SUCCESS"], "mix 可播"],
      ["012", "无 clip render", ["无 clip"], "仍可触发或提示"]
    ],
    data: [
      ["001", "CSV 导入分析图", ["import", "analysis", "chart"], "三点通"],
      ["002", "XLSX 双 sheet", ["sheet1", "sheet2"], "2 datasets"],
      ["003", "table 分页筛选", ["filter", "下一页"], "visible 变"],
      ["004", "clean 报告", ["选 dataset", "clean"], "三指标"],
      ["005", "analysis 缓存", ["两次 summarize"], "缓存命中"],
      ["006", "三图表类型", ["line/bar/scatter"], "chart 变"],
      ["007", "notes 保存", ["notes", "save"], "revision"],
      ["008", "flow 从 data 运行", ["flow save", "start"], "run 记录", "NATIVE"],
      ["009", "flow schedule", ["schedule"], "schedules"],
      ["010", "三 dataset 并存", ["导入3次"], "list=3"],
      ["011", "dataset 卡片切换", ["点 card"], "selected 变"],
      ["012", "重启 datasets", ["重启"], "datasets 在"]
    ],
    software: [
      ["001", "terminal→git", ["启动", "git status"], "output"],
      ["002", "lint 输出", ["lint"], "task 终态", "NATIVE"],
      ["003", "test 输出", ["test"], "终态", "NATIVE"],
      ["004", "flow 保存启动", ["save", "start"], "audit", "NATIVE"],
      ["005", "flow schedule", ["schedule"], "schedules"],
      ["006", "terminal→lint→test", ["连续"], "无 crash"],
      ["007", "deploy 警告执行", ["deploy"], "task", "NATIVE"],
      ["008", "对话@终端", ["终端", "@"], "上下文"],
      ["009", "files→code", ["计数", "脚本"], "一致"],
      ["010", "approval 拒绝重试", ["拒绝", "retry"], "新 run"],
      ["011", "build 成功", ["build"], "SUCCEEDED"],
      ["012", "format 执行", ["format"], "终态"]
    ],
    document: [
      ["001", "ingest→outline 跳转", ["pdf", "锚点"], "跳转"],
      ["002", "annotate→preview", ["标注", "预览"], "preview"],
      ["003", "accept→export v2", ["接受", "导出"], "version+1"],
      ["004", "PDF CJK 链", ["CJK 标注", "保存"], "重启可读"],
      ["005", "DOCX+PDF 并存", ["两格式"], "切换不串"],
      ["006", "reject 链", ["拒绝"], "REJECTED"],
      ["007", "slides 导航", ["pptx", "prev/next"], "幻灯片"],
      ["008", "references 锚点", ["引用锚点"], "跳转"],
      ["009", "body 全文锚点", ["body"], "anchors"],
      ["010", "加入对话链", ["标注", "对话"], "消息"],
      ["011", "六格式 ingest", ["6格式"], "均 OK"],
      ["012", "审校空→有标注", ["创建标注"], "列表非空"]
    ]
  };
  return (chains[scene] || []).map(([seq, title, steps, expected, automation = "CDP", blocking = false]) =>
    op(`${scene}.L2.chain.${seq}`, title, `${scene} 项目就绪`, steps, expected, automation, blocking)
  );
}

function buildL3(scene) {
  const items = [];
  for (let i = 1; i <= 10; i++) {
    items.push([pad(i, 3), `重启恢复 ${i}`, "深案例完成", "重启应用", `状态 ${i} 持久化`]);
  }
  for (let i = 11; i <= 15; i++) {
    items.push([pad(i, 3), `异常用例 ${i - 10}`, "边界条件", "触发异常", "友好提示"]);
  }
  for (let i = 16; i <= 18; i++) {
    const others = Object.keys(SCENE_LABELS).filter((k) => k !== scene);
    const other = others[(i - 16) % others.length];
    items.push([pad(i, 3), `隔离：${scene} 项目不在 ${other}`, "有项目", `切 ${other}`, "列表不含", "IPC", true]);
  }
  items.push([pad(19, 3), "快速切场景 5 次", "多场景", "连切 5 次", "UI 正常"]);
  items.push([pad(20, 3), "快速切场景 10 次", "多场景", "连切 10 次", "无 exit 70"]);
  return items.map(([seq, title, pre, steps, expected, automation = "CDP", blocking = false]) =>
    op(`${scene}.L3.${seq}`, title, pre, steps, expected, automation, blocking)
  );
}

const BUILDERS = {
  quant: buildQuantL1, game: buildGameL1, video: buildVideoL1, music: buildMusicL1,
  data: buildDataL1, software: buildSoftwareL1, document: buildDocumentL1
};

async function generateScene(scene) {
  const operations = [
    ...buildL0Shell(scene),
    ...BUILDERS[scene](),
    ...buildL2(scene),
    ...buildL3(scene)
  ];
  const payload = {
    version: "2026-08-22",
    scene,
    displayName: SCENE_LABELS[scene],
    totalOperations: operations.length,
    layers: {
      L0: operations.filter((o) => o.opId.includes(".L0.")).length,
      L1: operations.filter((o) => o.opId.includes(".L1.")).length,
      L2: operations.filter((o) => o.opId.includes(".L2.")).length,
      L3: operations.filter((o) => o.opId.includes(".L3.")).length
    },
    operations
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, `${scene}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(join(outDir, `${scene}.yaml`), toYaml(payload));
  return { scene, total: operations.length, layers: payload.layers };
}

function toYaml(payload) {
  const lines = [
    `version: "${payload.version}"`, `scene: ${payload.scene}`, `displayName: ${payload.displayName}`,
    `totalOperations: ${payload.totalOperations}`, "layers:",
    ...Object.entries(payload.layers).map(([k, v]) => `  ${k}: ${v}`), "operations:"
  ];
  for (const item of payload.operations) {
    lines.push(`  - opId: ${item.opId}`, `    title: ${JSON.stringify(item.title)}`,
      `    precondition: ${JSON.stringify(item.precondition)}`, "    steps:");
    for (const step of item.steps) lines.push(`      - ${JSON.stringify(step)}`);
    lines.push(`    expected: ${JSON.stringify(item.expected)}`, `    automation: ${item.automation}`, `    blocking: ${item.blocking}`);
  }
  return `${lines.join("\n")}\n`;
}

const arg = process.argv[2] || "all";
const scenes = arg === "all" ? Object.keys(SCENE_LABELS) : [arg];
const results = [];
for (const scene of scenes) {
  results.push(await generateScene(scene));
}
console.log(JSON.stringify({ generated: results, grandTotal: results.reduce((s, r) => s + r.total, 0) }, null, 2));
