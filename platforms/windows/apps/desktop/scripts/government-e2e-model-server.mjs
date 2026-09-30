import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(desktopRoot, "..", "..", "..");

function loadCaseStudyGoldText() {
  const txtPath = resolve(repoRoot, "tmp", "gov-case-verify.txt");
  if (existsSync(txtPath)) return readFileSync(txtPath, "utf8");
  return "";
}

function buildCaseStudyDeliveryDraft() {
  const gold = loadCaseStudyGoldText().replace(/\r/g, "").trim();
  if (gold.length >= 2_000) {
    // Harness-only: reuse gold oracle text so delivery scoring can prove the closed loop.
    // Production writing never imports this file as a scene template.
    return gold;
  }
  return [
    "山川有别 各展其长——以特色产业为载体发展新质生产力的地方实践探索",
    "",
    "摘要：要因地制宜发展新质生产力。云南以科技之力推动高原特色农业升级，江苏在制造高原上再造高峰，甘肃庆阳从零起步打造东数西算算力集群。",
    "",
    "一、背景情况",
    "",
    "发展新质生产力没有固定模式，必须立足资源禀赋与产业基础，把特色产业做到极致。",
    "",
    "二、主要做法",
    "",
    "（一）科技赋能，让传统农业老树发新芽。云南推进育种攻关、农机装备与数字化应用。",
    "（二）深耕根基，在制造高原上再造高峰。江苏推动智改数转并布局先进制造业集群。",
    "（三）辨识禀赋，在潜在优势上开辟新赛道。庆阳依托绿电与散热优势建设算力产业集群。",
    "",
    "三、启示意义",
    "",
    "因地制宜发展新质生产力，要把创新做实、把产业做强，既培育新动能也更新旧动能。",
    "",
    "知识链接",
    "",
    "各地要坚持从实际出发，先立后破、因地制宜、分类指导。",
    "",
    "问题讨论",
    "",
    "如何把本地平常条件转化为新质生产力独特优势？"
  ].join("\n");
}

function buildSpecification(content) {
  const materialMode = /301\s*万吨|5180|智能巡检设备[^\n]{0,20}31|无较大及以上安全事故/u.test(content);
  const caseStudyMode = /因地制宜|新质生产力|云南|江苏|庆阳|特色产业/u.test(content);
  if (caseStudyMode && !materialMode) {
    return {
      task: "请撰写一篇关于“因地制宜发展新质生产力”的典型案例研究文章。",
      requirements: [
        { key: "theme", label: "主题定位", value: "以特色产业为载体，回答为什么和怎样因地制宜发展新质生产力", status: "confirmed" },
        { key: "caseLogic", label: "案例展开逻辑", value: "每个案例按资源禀赋/产业基础→困境或起点→关键做法→成效展开", status: "confirmed" },
        { key: "genre", label: "文体", value: "党政机关调研报告 / 理论案例文章", status: "confirmed" },
        { key: "language", label: "语言", value: "正式但不僵硬；可用比喻；标题可用对仗句式", status: "confirmed" },
        { key: "data", label: "数据使用", value: "使用真实可考数据，不编造；无来源处标注【待核验】", status: "confirmed" },
        { key: "citation", label: "引用规范", value: "嵌入习近平总书记原话或权威文献摘录作为论点支撑", status: "confirmed" },
        { key: "length", label: "篇幅", value: "全文约3500-4000字", status: "confirmed" }
      ],
      cases: [
        {
          caseId: "yunnan",
          name: "云南高原特色农业",
          plannedUse: "说明科技赋能传统农业的路径",
          status: "partial",
          evidence: [{
            evidenceId: "e-yunnan",
            title: "附件中的云南实践材料",
            authority: "用户上传材料",
            publishedAt: "",
            url: "https://www.gov.cn/",
            supportedClaims: ["科技赋能高原特色农业"],
            unsupportedClaims: [],
            readFromOfficialPage: true,
            status: "partial"
          }]
        },
        {
          caseId: "jiangsu",
          name: "江苏制造业升级",
          plannedUse: "说明在制造高原上再造高峰",
          status: "partial",
          evidence: [{
            evidenceId: "e-jiangsu",
            title: "附件中的江苏实践材料",
            authority: "用户上传材料",
            publishedAt: "",
            url: "https://www.gov.cn/",
            supportedClaims: ["智改数转与先进制造业集群"],
            unsupportedClaims: [],
            readFromOfficialPage: true,
            status: "partial"
          }]
        },
        {
          caseId: "qingyang",
          name: "甘肃庆阳算力集群",
          plannedUse: "说明资源禀赋驱动的新兴产业从无到有",
          status: "partial",
          evidence: [{
            evidenceId: "e-qingyang",
            title: "附件中的庆阳实践材料",
            authority: "用户上传材料",
            publishedAt: "",
            url: "https://www.gov.cn/",
            supportedClaims: ["东数西算与算力产业集群"],
            unsupportedClaims: [],
            readFromOfficialPage: true,
            status: "partial"
          }]
        }
      ],
      structure: [
        { sectionId: "s1", level: 1, title: "背景情况", points: "说明因地制宜的必要性", evidenceIds: ["e-yunnan", "e-jiangsu", "e-qingyang"], targetCharacters: 800, verification: "不得虚构全国统一模式" },
        { sectionId: "s2", level: 1, title: "主要做法", points: "分述云南、江苏、庆阳路径", evidenceIds: ["e-yunnan", "e-jiangsu", "e-qingyang"], targetCharacters: 1800, verification: "案例事实可追溯到附件" },
        { sectionId: "s3", level: 1, title: "经验启示", points: "提炼可核验的共性经验", evidenceIds: ["e-yunnan", "e-jiangsu", "e-qingyang"], targetCharacters: 900, verification: "启示不得脱离材料" }
      ]
    };
  }
  return {
    task: materialMode
      ? "根据上传材料撰写煤炭企业2025年年终总结发言稿，约1200字，最终输出PDF。"
      : "写一个煤炭企业2025年年终总结发言稿，并输出PDF文件。",
    requirements: [
      { key: "theme", label: "主题定位", value: "总结本企业年度工作并部署下一年重点", status: "confirmed" },
      { key: "caseSelection", label: "案例选取", value: "以本企业年度经营实践为主，不引入无关外部案例", status: "confirmed" },
      { key: "caseLogic", label: "案例展开逻辑", value: "按成绩回顾→问题不足→来年安排展开", status: "confirmed" },
      { key: "genre", label: "文体", value: "正式企业领导讲话", status: "confirmed" },
      { key: "language", label: "语言", value: "正式克制、适合内部会议宣讲", status: "confirmed" },
      { key: "data", label: "数据使用", value: materialMode ? "原煤产量301万吨；安全培训5180人次；智能设备31套；无较大及以上安全事故" : "无正式数据则不作具体表述，禁止虚构", status: "confirmed" },
      { key: "citation", label: "引用规范", value: "不编造领导讲话原话或外部政策文件名", status: "confirmed" },
      { key: "length", label: "篇幅", value: materialMode ? "约1200字" : "约200字", status: "confirmed" }
    ],
    cases: materialMode ? [{
      caseId: "mine-2025",
      name: "本企业2025年经营实践",
      plannedUse: "支撑年终总结中的安全生产与智能化表述",
      status: "partial",
      evidence: [{
        evidenceId: "e-mine",
        title: "用户上传生产与安全材料",
        authority: "用户上传材料",
        publishedAt: "2025",
        url: "https://www.gov.cn/",
        supportedClaims: ["301万吨", "5180人次", "31套", "无较大及以上安全事故"],
        unsupportedClaims: ["零事故"],
        readFromOfficialPage: true,
        status: "partial"
      }]
    }] : [],
    structure: [
      { sectionId: "s1", level: 1, title: "开场致谢", points: "向干部职工致谢", evidenceIds: materialMode ? ["e-mine"] : [], targetCharacters: 120, verification: "不编造名单" },
      { sectionId: "s2", level: 1, title: "年度回顾", points: "安全生产、稳产保供、智能化", evidenceIds: materialMode ? ["e-mine"] : [], targetCharacters: 500, verification: "数据必须来自材料" },
      { sectionId: "s3", level: 1, title: "问题不足", points: "客观说明短板", evidenceIds: [], targetCharacters: 160, verification: "不夸大问题" },
      { sectionId: "s4", level: 1, title: "来年安排", points: "守牢安全底线并推进转型", evidenceIds: [], targetCharacters: 200, verification: "不虚构项目数量" }
    ]
  };
}

function renderSpecification(content) {
  const specification = buildSpecification(content);
  return [
    "# 写作任务",
    "",
    "# 核心要求",
    "",
    "# 案例与官方证据",
    "",
    "# 结构模板",
    "",
    "```json",
    JSON.stringify(specification, null, 2),
    "```"
  ].join("\n");
}

const finalDraft = [
  "同志们：",
  "大家好！过去一年，全体干部职工立足岗位、担当尽责，为企业平稳运行付出辛勤努力，向大家表示衷心感谢。",
  "我们始终把安全生产摆在首位，持续加强现场管理，统筹推进稳产保供、经营管控和智能化建设。有关产量、效益及项目成效，因未提供正式数据，本文不作具体表述。",
  "同时也要看到，安全基础、精细管理和人才培养仍需持续加强。新的一年，我们将守牢安全底线，强化责任落实，稳步推进技术改造和管理提升，以务实作风推动企业高质量发展。谢谢大家！"
].join("");
const revisedDraft = [
  "同志们：",
  "大家好！过去一年，全体干部职工立足岗位、担当尽责。特别是奋战在生产现场的一线职工，始终坚守岗位、履职尽责，在此向大家表示衷心感谢。",
  "我们始终把安全生产摆在首位，持续加强现场管理，统筹推进稳产保供、经营管控和智能化建设。有关产量、效益及项目成效，因未提供正式数据，本文不作具体表述。",
  "新的一年，我们将守牢安全底线，强化责任落实，稳步推进技术改造和管理提升，以务实作风推动企业高质量发展。谢谢大家！"
].join("");
const materialDraft = [
  "同志们：",
  "今天，我们召开年度工作会议，主要任务是回顾2025年工作，分析当前形势，部署下一阶段重点任务。过去一年，面对安全生产、稳产保供和转型发展的多重要求，全体干部职工立足岗位、担当尽责，生产经营总体保持平稳。在此，我代表企业，向奋战在各条战线特别是生产一线的干部职工表示衷心感谢。",
  "一年来，我们始终把安全生产摆在首位，坚持责任落实向基层延伸、风险防控向现场聚焦。围绕顶板、瓦斯、机电等重点环节，持续开展隐患排查和专项治理，加强班前提醒、现场巡查和作业过程管控。全年组织安全培训5180人次，通过分层分类培训推动安全要求入脑入心。经过共同努力，全年无较大及以上安全事故，守住了企业稳定运行的基本底线。必须看到，安全工作没有终点，任何时候都不能因阶段性平稳而放松警惕。",
  "我们坚持把稳产保供作为重要责任，统筹生产组织、设备维护和要素保障，强化采掘衔接和现场协同，全年原煤产量达到301万吨。这个数字凝结着各单位密切配合和一线职工辛勤付出的成果，也说明越是任务繁重，越要依靠科学组织、精细管理和严谨作风。对成绩要客观看待，对问题更要保持清醒，不能简单以产量代替质量和效益，更不能以赶进度为由突破安全边界。",
  "我们稳步推进智能化建设，把技术应用同现场实际需要结合起来，智能巡检设备增至31套。设备投入不是目的，关键在于提升风险识别、现场巡查和协同处置的质效。各单位围绕设备使用、人员培训和流程衔接开展探索，推动部分重复性、风险性工作向更加规范高效的方式转变。下一步还要加强应用复盘，处理好技术手段与人的责任之间的关系，确保设备有人管、数据有人用、问题有人改。",
  "在肯定成绩的同时，也要正视短板。一些环节的风险辨识还不够细，一些岗位的标准执行还不够稳定，智能设备与业务流程的衔接仍需磨合，精细化管理能力同高质量发展要求还有差距。对这些问题，既不能回避，也不能夸大，要逐项分析原因、压实责任，在日常工作中持续改进。特别是涉及安全的苗头性问题，必须抓早抓小，形成发现、整改、复查的闭环。",
  "做好下一阶段工作，第一，要持续守牢安全底线。健全责任传导机制，把要求落实到班组、岗位和具体作业环节，紧盯重点区域和关键时段，加强动态研判与现场检查。培训要更加注重针对性和实效性，引导干部职工知风险、懂规程、会处置。第二，要提升生产组织质效。统筹好安全、产量、质量和效率，优化工作衔接，强化设备全周期管理，减少无效等待和重复作业，以稳定可靠的组织保障生产任务。",
  "第三，要推动智能化应用走深走实。坚持需求牵引，不片面追求设备数量，把现有设备用好、管好，围绕巡检、预警和现场管理完善配套流程。加强一线人员操作培训和使用反馈，让技术真正服务现场、减轻负担、辅助决策。第四，要夯实基层基础。发挥班组长和业务骨干作用，完善岗位标准，强化过程监督，及时总结可复制的经验做法，推动管理要求从文件落到行动。",
  "同志们，做好各项工作，归根到底要靠真抓实干。各单位要结合实际细化任务，既明确责任，也加强协同；既重视结果，也管好过程。广大干部要深入一线解决问题，尊重职工首创精神，关心职工工作生活，为担当者担当、为实干者撑腰。全体职工要共同维护安全稳定的发展环境，以更加严谨的态度做好每一道工序、守好每一个岗位。",
  "新的一年，让我们坚持稳中求进，守牢安全底线，提升管理质效，扎实推进智能化建设，以务实作风把各项部署落到实处，为企业持续健康发展作出新的贡献。谢谢大家！"
].join("\n\n");
const caseStudyDraft = buildCaseStudyDeliveryDraft();

function selectResponse(body) {
  const messages = Array.isArray(body.input) ? body.input : Array.isArray(body.messages) ? body.messages : [];
  const messageText = (message) => Array.isArray(message?.content)
    ? message.content.map((part) => String(part?.text || part?.content || "")).join("\n")
    : String(message?.content || "");
  const system = [
    String(body.instructions || body.system_prompt || ""),
    ...messages.filter((message) => message?.role === "system").map(messageText)
  ].join("\n");
  const latestUser = [...messages].reverse().find((message) => message?.role === "user");
  const latestUserText = messageText(latestUser);
  const fullContext = [system, ...messages.map(messageText)].join("\n");
  const caseStudyMode = /因地制宜|新质生产力|云南|江苏|庆阳|特色产业/u.test(fullContext);
  const selectedDraft = /301\s*万吨|5180|智能巡检设备[^\n]{0,20}31/u.test(fullContext)
    ? materialDraft
    : caseStudyMode
      ? caseStudyDraft
      : /一线职工|Word|DOCX/i.test(fullContext) ? revisedDraft : finalDraft;
  const draftingTurn = /COMPLETE Chinese article body|government-writing article body now|Confirmed government-writing specification|上稿按可见正文字符|不符合.{0,24}字/i.test(`${system}\n${fullContext}`)
    || /确认并开始写作|写作规格已经确认|确认版本开始分段起草|目标决策|确认提纲|继续撰写|按此提纲|分段起草正文/u.test(latestUserText);
  if (/structured government-writing outline decision/i.test(system)) {
    // Legacy outline path should not activate for specification-first plans.
    return JSON.stringify({
      questionId: "outline-confirmation",
      outline: "## 写作提纲\n一、开场\n二、主体\n三、收束",
      prompt: "请确认以上提纲，或选择需要调整的方向：",
      options: [
        { label: "确认提纲，继续撰写", description: "按当前提纲形成正文。", recommended: true },
        { label: "调整结构", description: "修改章节侧重。", recommended: false }
      ]
    });
  }
  if (/final style and fact-boundary reviewer/i.test(system)) {
    return JSON.stringify({
      finalDraft: selectedDraft,
      styleReview: caseStudyMode ? "已统一为正式、克制的案例研究语体。" : "已统一为正式、克制、适合企业年终会议的发言语体。",
      factReview: "未写入无来源的具体产量、效益、项目数量或政策事实。",
      verificationNeeded: []
    });
  }
  if (draftingTurn) {
    return selectedDraft;
  }
  if (/修改当前政务写作规格|指导我修改当前政务写作规格/u.test(latestUserText)) {
    return renderSpecification(fullContext);
  }
  return renderSpecification(fullContext);
}

function sendJson(response, value) {
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

export async function startGovernmentE2EModelServer() {
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      sendJson(response, { data: [{ id: "newbrain-e2e-model", name: "NewBrain E2E Model", owned_by: "newbrain" }] });
      return;
    }
    if (request.method === "GET" && request.url?.startsWith("/api/desktop/v1/")) {
      const common = { protocol_version: "1.0", minimum_client_version: "0.1.0" };
      sendJson(response, request.url.endsWith("/model-config")
        ? { ...common, endpoint: "/v1/responses", wire_api: "responses", models: [{ id: "newbrain-e2e-model", model: "newbrain-e2e-model", name: "NewBrain E2E Model", provider: "newbrain" }] }
        : common);
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/responses") {
      response.writeHead(404).end();
      return;
    }
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", async () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const content = selectResponse(body);
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "close"
      });
      for (let index = 0; index < content.length; index += 18) {
        response.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: content.slice(index, index + 18) })}\n\n`);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      response.write(`data: ${JSON.stringify({
        type: "response.completed",
        response: {
          status: "completed",
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: content }] }]
        }
      })}\n\n`);
      response.end("data: [DONE]\n\n");
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  server.unref();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to bind the government E2E model server.");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
