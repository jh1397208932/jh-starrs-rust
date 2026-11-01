import {
  BarChart,
  Callout,
  ChartComparisonGrid,
  ChartContainer,
  H1,
  LineChart,
  MetricsGrid,
  PieChart,
  ReportSection,
  ReportShell,
  Stack,
  Table,
  Text,
  type MetricItem,
} from "qoder/canvas";

// —— 报告数据契约（由 scripts/lib/breakdown.mjs 产出，plugin 注入）——
interface CatRow {
  key: string;
  label: string;
  tokens: number;
  share: number;
}
interface ToolRow {
  tool: string;
  tokens: number;
  calls: number;
  /** 平均每次调用带来的重发 token；无调用记录时 null（不给 0） */
  perCall?: number | null;
  share: number;
}
interface FileRow {
  attr: string;
  label: string;
  kind: string;
  tool: string | null;
  selfTokens: number;
  reads: number;
  trips: number;
  billed: number;
  /** 单次读取的总代价（含此后每一程重发）；reads=0 时 null */
  perRead?: number | null;
  share: number;
}
interface ReqRow {
  index: number;
  time: string | null;
  ratio: number;
  inputTokens: number;
  /** 代理或转录任一有真值即非 null；两者都没则 null（不写 0） */
  outputTokens?: number | null;
  /** proxy=代理实测 / transcript-tokens=转录 input_tokens / transcript-ratio=转录 ratio×window */
  usageSource?: "proxy" | "transcript-tokens" | "transcript-ratio" | "transcript";
  credits: number;
  originalCredits: number;
  afterCompact: boolean;
}
interface CatChild {
  tool: string | null;
  label: string;
  kind: string | null;
  tokens: number;
  share: number;
  catShare: number;
  trips: number;
}
interface CatDetail {
  key: string;
  label: string;
  tokens: number;
  share: number;
  children: CatChild[];
}
interface SubagentRow {
  agentId: string;
  agentType: string | null;
  description: string | null;
  toolUseId: string | null;
  roundTrips: number;
  billedInputTokens: number;
  peakContextRatio: number;
  credits: number;
  originalCredits: number;
  error: string | null;
}
interface SubagentTotals {
  roundTrips: number;
  billedInputTokens: number;
  credits: number;
  originalCredits: number;
}
interface Subagents {
  scanned: boolean;
  dir: string | null;
  /** 试过的候选目录；用于区分「真没子代理」与「路径没找对」。 */
  probedPaths?: string[];
  /** ok=已汇总 / no-dir=无子代理目录 / dir-empty=目录在但无 agent 文件 / no-usage=有文件但转录无 usage / error=读取抛错 */
  reason?: string;
  count: number;
  items: SubagentRow[];
  totals: SubagentTotals;
  combined: SubagentTotals;
}
/** 逐项可用性：报告里每个数字到底是模型上报的真值、按真值推导、回退默认、手工录入，还是本地根本没有。
 *  v2 旧报告没这个对象，故全部字段可选，读取时一律走默认值（旧报告只可能来自桌面端富转录）。 */
type Avail = "measured" | "derived" | "fallback" | "manual" | "unavailable";
interface Availability {
  credits?: Avail;
  roundTrips?: Avail;
  contextRatio?: Avail;
  tokens?: Avail;
  /** 输出 token：代理或转录 output_tokens 任一有真值即 measured */
  outputTokens?: Avail;
  /** 缓存命中 token：代理或转录 cache_read_input_tokens 任一有真值即 measured */
  cachedTokens?: Avail;
  categoryShare?: Avail;
  toolShare?: Avail;
  fileShare?: Avail;
  systemPrompt?: Avail;
  contextWindow?: Avail;
  compactions?: Avail;
  compactionCost?: Avail;
  model?: Avail;
  title?: Avail;
  toolCalls?: Avail;
  fileReads?: Avail;
  userTurns?: Avail;
  /** 用户压缩阈值：manual 覆盖 → manual；默认 200K → fallback */
  userContextLimit?: Avail;
}
/** 官方 UI 真值（手工录入，来自 .qoder-credits/overrides/<sessionId>.json）。
 *  IDE 端转录不含 usage，本地算不出 Credits，这是唯一的真值通道；绝不覆盖 totals，只并列展示。 */
interface ManualTruth {
  file?: string;
  credits: number | null;
  originalCredits: number | null;
  model: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMin: number | null;
  note: string | null;
  /** 手工锁定模型窗口（如 qwen3-max=1000000），优先于 runtime-config / 反推 / fallback */
  contextWindow?: number | null;
  /** 手工指定 Qoder 压缩触发阈值（默认 200000），驱动 peakUserAdvice */
  userContextLimit?: number | null;
  /** 本地 credits ÷ 官方真值。有子代理时拿 combined 比（官方 UI 扣费 = 主链 + 子代理），
   *  否则覆盖率会被系统性低估（实测 ca2f7834：主链比 0.46、combined 比 0.89）。 */
  localCoverage?: number | null;
  /** main=只比主链 / combined=比主链+子代理 */
  localScope?: "main" | "combined";
  /** 参与对账的本地 credits（按 localScope 取 totals.credits 或 subagents.combined.credits） */
  localCredits?: number | null;
}
/** 峰值占比的「该不该压」结论。阈值算在数据层（breakdown.mjs peakAdvice），
 *  这里只管展示——否则 Canvas 与终端各持一套阈值迟早走偏。tone 直接喂 Callout。 */
interface PeakAdvice {
  level: "low" | "mid" | "sweet" | "high" | "over";
  tone: "info" | "success" | "warning" | "danger";
  text: string;
}
/** 一次压缩 = 一笔普通模型调用（整份上下文当 prompt、摘要当 completion），是会话里单笔最贵的开销。
 *  pre/post 是客户端自估口径；proxy 是能在代理日志里唯一对上时回填的供应商实测值，对不上就 null。 */
interface CompactionEvent {
  index: number;
  at: string | null;
  trigger: string | null;
  preTokens: number | null;
  postTokens: number | null;
  messagesSummarized: number | null;
  /** 压缩后首轮的往返序号与实测输入 = 压缩把上下文压到的地板 */
  nextRequestIndex: number | null;
  nextInputTokens: number | null;
  savedTokens: number | null;
  /** 数据层归一后的生效值：有代理实测就用实测，否则是客户端自估。
   *  渲染端直接取这两个，别自己按 proxy 分支——否则会与合计的口径分叉。 */
  effectiveInputTokens?: number | null;
  effectiveOutputTokens?: number | null;
  proxy?: {
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number | null;
    ms: number | null;
    matchedBy: string;
  } | null;
}
interface CompactionCost {
  count: number;
  items: CompactionEvent[];
  /** measured = items 里有几笔拿到了供应商实测（其余为客户端自估） */
  totals: { preTokens: number; postTokens: number; savedTokens: number; measured?: number };
}
/** 链路健康度：代理覆盖率 + 最近记录时间 + 最近若干笔的三方归因计数。
 *  逐笔明细属于排障（CLI --request-log），报告只给一行结论。 */
interface LinkHealth {
  matched: number;
  requests: number;
  coverage: number;
  /** proxy / transcript-tokens / transcript-ratio / mixed / transcript（v3 旧报告）/ null */
  usageSource?: "proxy" | "transcript-tokens" | "transcript-ratio" | "mixed" | "transcript" | null;
  /** 三档拆分：代理实测 / 转录 input_tokens / 转录 ratio×window */
  breakdown?: { proxy: number; transcriptTokens: number; transcriptRatio: number };
  logRecords?: number;
  lastRecordAt?: string | null;
  /** 参与归因的最近笔数；0 = 运行中的代理是旧版或还没记到诊断 */
  recentRequests?: number;
  proxyErrors?: number | null;
  upstreamRejected?: number | null;
  aborted?: number | null;
  truncated?: number | null;
  noUsage?: number | null;
  slowestMs?: number | null;
  /** 被更新流量推翻的那条陈旧拉起失败记录；null = 没有 */
  supersededFailure?: { error: string; port?: number; at?: string | null } | null;
}
interface Report {
  schemaVersion: number;
  generatedAt: string;
  pluginVersion?: string;
  /** 转录来自哪一代客户端：桌面端富转录有 usage 真值，IDE 端精简转录没有。v2 旧报告无此字段。 */
  source?: "desktop-rich" | "ide-lite" | "unknown";
  /** usage 数字的来源：proxy=代理实测 / transcript-tokens=转录 input_tokens 真值 /
   *  transcript-ratio=转录 ratio×window 推导 / mixed=多档混合 / transcript=v3 旧报告兼容。无 usage 时 null。 */
  usageSource?: "proxy" | "transcript-tokens" | "transcript-ratio" | "mixed" | "transcript" | null;
  /** 可直接粘贴执行的插件入口命令（generate.mjs 用 proxy.mjs 的 selfCmd() 注入）。
   *  Windows 上是插件自带启动器的绝对路径，不要求用户装 Node；模板是静态文本，拿不到就只能硬编码。 */
  selfCmd?: string | null;
  /** 链路健康度一行结论（逐笔明细留给 CLI --request-log） */
  linkHealth?: LinkHealth | null;
  /** 代理 join 诊断（lib/proxylog.mjs）+ 配置/状态（generate.mjs 注入） */
  proxy?: {
    matched: number;
    requests: number;
    /** 三档拆分：代理实测 / 转录 input_tokens / 转录 ratio×window */
    breakdown?: { proxy: number; transcriptTokens: number; transcriptRatio: number };
    logPath?: string;
    logExists?: boolean;
    logRecords?: number;
    /** config.json 里 upstream 合法 = 用户已配置代理 */
    configured?: boolean;
    enabled?: boolean;
    port?: number;
    /** 最近一条代理记录的时间；null = 从无流量 */
    lastRecordAt?: string | null;
    /** 已配置但长期零流量（多半已改回官方模型）——软提示可 --stop-proxy */
    dormant?: boolean;
    /** 最近一次自动拉起失败（如端口被占）；ok 时为 null */
    status?: { error: string; port?: number; at?: string | null } | null;
    /** status 那条失败记录是否已被更新的流量推翻（代理在它之后还记到了流量）。
     *  status.json 只写不清，陈旧失败会把用户推去改本来正确的 Base URL，故必须判掉。 */
    statusSuperseded?: boolean;
  };
  availability?: Availability;
  manual?: ManualTruth | null;
  session: {
    id: string | null;
    title: string | null;
    /** custom-title / first-user / session-id —— 令产物文件名可解释 */
    titleSource?: string;
    model: string | null;
    /** runtime-config / manual / unavailable */
    modelSource?: string;
    cwd: string | null;
    turns: number;
    roundTrips: number;
    compactions: number;
    startedAt: string | null;
    endedAt: string | null;
  };
  context: {
    contextWindow: number;
    /** runtime-config=实测 / derived-from-usage=从 usage 反推 / manual=ManualTruth 手工锁定 /
     *  fallback=读不到静默回退 200000 / caller=调用方传入（旧枚举，兼容）。
     *  报告里每个 token 数字都要乘它，回退时必须标出来。 */
    contextWindowSource?: string;
    systemPromptTokens: number;
    netContextTokens: number;
    /** 峰值 = 当前窗口口径：自最近一次压缩起算，压缩边界处归零重新累积 */
    peakContextTokens: number;
    peakContextRatio: number;
    /** 本场历史峰值（跨压缩）；整场没压缩过时与上面相等 */
    peakSessionTokens?: number;
    peakSessionRatio?: number;
    /** 历史峰值是否值得单独交代（与当前窗口峰值相差 ≥1 个百分点），渲染端直接取用不再自判 */
    peakSessionNotable?: boolean;
    /** 峰值占比的「该不该压」结论（对模型窗口）；无有效占比时 null */
    peakAdvice?: PeakAdvice | null;
    /** 用户压缩阈值（Qoder 自动触发点），与模型窗口独立。默认 200000，ManualTruth 可覆盖 */
    userContextLimit?: number;
    /** default=内置 200K / manual=overrides 手写 / config=插件配置 / derived=实测反推 */
    userContextLimitSource?: "default" | "manual" | "config" | "derived";
    /** peakContextTokens ÷ userContextLimit */
    peakUserRatio?: number;
    /** 对用户阈值的「快自动压缩了吗」结论；与 peakAdvice 可矛盾（模型窗口未满但用户阈值已超） */
    peakUserAdvice?: PeakAdvice | null;
    /** v3.2 当前占用头条口径：段内单调递增 ⇒ 峰值≡当前，故以 netContextTokens 作头条，peak 退灰字 */
    currentContextTokens?: number;
    netUserRatio?: number;
    netUserAdvice?: PeakAdvice | null;
    netWindowRatio?: number;
    /** v3.2 自动压缩自校准：本场 trigger=auto 的实际触发点（无需外部配置）与「阈值是否被强制」判定 */
    observedAutoCompactions?: number;
    observedAutoTriggerTokens?: number | null;
    autoTriggerRatio?: number | null;
    thresholdNotEnforced?: boolean;
  };
  totals: {
    billedInputTokens: number;
    netContextTokens: number;
    peakContextTokens: number;
    amplification: number;
    attributedTokens: number;
    coverage: number;
    credits: number;
    originalCredits: number;
    /** 输出 token 总量：仅代理路径有真值，否则 0 且 availability.outputTokens=unavailable */
    outputTokens?: number;
    /** 供应商上下文缓存命中的那部分 prompt：仅代理路径有真值 */
    cachedTokens?: number;
    cachedTrips?: number;
    /** 缓存命中 ÷ 计费输入总量（全局实测约 91.5%：重复叠加的前缀正是缓存的命中对象） */
    cachedShare?: number;
    /** 两个不依赖 usage 的计数，IDE 端占比全缺时仍有可展示的真值 */
    toolCalls?: number;
    fileReads?: number;
  };
  /** credits 的分子到底覆盖了多少：与计费输入总量并排展示时，部分覆盖不说就等于把局部真值当全量。 */
  creditsCoverage?: {
    /** 真正累加进 totals.credits 的往返数 */
    trips: number;
    roundTrips: number;
    /** 这些往返的计费输入之和 */
    tokens: number;
    tokenShare: number;
    /** trips === roundTrips：全覆盖时不必再啰嗦覆盖范围 */
    full: boolean;
  };
  /** 压缩单笔成本（此前只显示「压缩 N 次」，而它是会话里单笔最贵的调用） */
  compactionCost?: CompactionCost;
  byCategory: CatRow[];
  byCategoryDetail: CatDetail[];
  byTool: ToolRow[];
  byFile: FileRow[];
  byRequest: ReqRow[];
  subagents?: Subagents;
  identity: { sumAttributed: number; billedInputTokens: number; absDiff: number; ok: boolean | null };
}

// 注入点：下一行的 REPORT 初值会被 render-canvas.mjs 按整行替换为真实报告 JSON。
const REPORT = {"schemaVersion":3.2,"generatedAt":"2026-11-01T04:00:57.913Z","source":"desktop-rich","usageSource":"transcript-ratio","availability":{"credits":"measured","roundTrips":"measured","contextRatio":"measured","tokens":"derived","outputTokens":"unavailable","cachedTokens":"unavailable","categoryShare":"derived","toolShare":"derived","fileShare":"derived","systemPrompt":"derived","contextWindow":"fallback","compactions":"measured","compactionCost":"measured","model":"measured","title":"measured","toolCalls":"measured","fileReads":"measured","userTurns":"measured","userContextLimit":"fallback"},"session":{"id":"e4c305be-88c7-4178-baac-55e83a09ba12","title":"A goal has been set. The","titleSource":"first-user","model":"dfmodel","modelSource":"runtime-config","cwd":"D:\\workspace\\jh-starrs-rust","turns":2,"roundTrips":298,"compactions":0,"startedAt":"2026-10-31T14:27:08.177Z","endedAt":"2026-11-01T04:00:57.591Z"},"context":{"contextWindow":200000,"contextWindowSource":"fallback","systemPromptTokens":0,"netContextTokens":103651,"peakContextTokens":103651,"peakContextRatio":0.518255,"peakSessionTokens":103651,"peakSessionRatio":0.518255,"peakSessionNotable":false,"peakAdvice":{"level":"mid","tone":"info","text":"已过盈亏线（39%）但还没进性价比区间，压缩有净收益但不大；不急着压"},"userContextLimit":200000,"userContextLimitSource":"default","peakUserRatio":0.518255,"peakUserAdvice":{"level":"mid","tone":"info","text":"已过盈亏线（39%）但还没进性价比区间，压缩有净收益但不大；不急着压"},"currentContextTokens":103651,"netUserRatio":0.518255,"netUserAdvice":{"level":"mid","tone":"info","text":"已过盈亏线（39%）但还没进性价比区间，压缩有净收益但不大；不急着压"},"netWindowRatio":0.518255,"observedAutoCompactions":0,"observedAutoTriggerTokens":null,"autoTriggerRatio":null,"thresholdNotEnforced":false},"totals":{"billedInputTokens":18580764,"netContextTokens":103651,"peakContextTokens":103651,"amplification":179.26,"attributedTokens":18580764,"coverage":1,"credits":87.352,"originalCredits":87.352,"outputTokens":0,"cachedTokens":0,"cachedTrips":0,"cachedShare":0,"toolCalls":422,"fileReads":135},"creditsCoverage":{"trips":298,"roundTrips":298,"tokens":18580764,"tokenShare":1.0000000215276406,"full":true},"compactionCost":{"count":0,"items":[],"totals":{"preTokens":0,"postTokens":0,"savedTokens":0,"measured":0}},"proxy":{"matched":0,"requests":298,"breakdown":{"proxy":0,"transcriptTokens":0,"transcriptRatio":298},"logPath":"C:\\Users\\13972\\.qoder-credits-proxy\\usage.jsonl","logExists":false,"logRecords":0,"configured":false,"enabled":true,"port":49787,"lastRecordAt":null,"dormant":false,"status":null,"statusSuperseded":false},"byCategory":[{"key":"tool_result","label":"工具返回","tokens":5406281,"share":0.2909611857238423},{"key":"assistant_thinking","label":"模型思考","tokens":2435071,"share":0.13105334100237934},{"key":"assistant_tool_use","label":"工具调用","tokens":2825273,"share":0.15205364659656845},{"key":"assistant_text","label":"模型回复","tokens":4000,"share":0.00021527156560930888},{"key":"user_input","label":"用户输入","tokens":90231,"share":0.004856145788191044},{"key":"attachment","label":"附件/技能","tokens":7819908,"share":0.420860430851102}],"byCategoryDetail":[{"key":"tool_result","label":"工具返回","tokens":5406281,"share":0.2909611857238423,"children":[{"tool":"Bash","label":"（无路径）","kind":"shell","tokens":5208934,"share":0.2803401674666184,"catShare":0.9634967865875261,"trips":45115},{"tool":"Edit","label":"src/features/workspace/components/WindowControls.tsx","kind":"write","tokens":11813,"share":0.0006357464294923752,"catShare":0.002184987072797319,"trips":1105},{"tool":"Edit","label":"src/features/workspace/components/WindowBar.tsx","kind":"write","tokens":11603,"share":0.0006244794635726255,"catShare":0.0021462638118519796,"trips":1746},{"tool":"Edit","label":"docs/开发/数据库设计与迁移.md","kind":"write","tokens":8257,"share":0.0004444104054709689,"catShare":0.0015273872505206542,"trips":1127},{"tool":"TaskCreate","label":"（无路径）","kind":"other","tokens":7046,"share":0.0003792114494425313,"catShare":0.0013033059667362278,"trips":1152},{"tool":"Edit","label":"src/features/workspace/components/Sidebar.tsx","kind":"write","tokens":6881,"share":0.0003703195458715086,"catShare":0.0012727455208509742,"trips":1032},{"tool":"Edit","label":"src/api/fileDialog.ts","kind":"write","tokens":6372,"share":0.0003429425580907284,"catShare":0.0011786539748852372,"trips":1205},{"tool":"Edit","label":"docs/开发/README.md","kind":"write","tokens":5863,"share":0.00031554555528328726,"catShare":0.0010844936395838674,"trips":1088},{"tool":"Edit","label":"src-tauri/src/menu.rs","kind":"write","tokens":5240,"share":0.000282029956417563,"catShare":0.0009693043961033479,"trips":988},{"tool":"Read","label":"docs/设计/2026-10-27-README-001/图片/doc-editor.png","kind":"read","tokens":5225,"share":0.0002812272873590277,"catShare":0.0009665457152279643,"trips":279},{"tool":"Edit","label":"src-tauri/Cargo.toml","kind":"write","tokens":5162,"share":0.0002778050809100938,"catShare":0.0009547839868021598,"trips":975},{"tool":"Edit","label":"src/features/shortcuts/shortcutKeys.ts","kind":"write","tokens":4990,"share":0.0002685622442340005,"catShare":0.000923017424354666,"trips":798},{"tool":"Edit","label":"docs/开发/图表总览.md","kind":"write","tokens":4500,"share":0.0002421595903945624,"catShare":0.0008322745516455293,"trips":435},{"tool":"Edit","label":"src/features/workspace/hooks/useWorkspaceDialogActions.ts","kind":"write","tokens":3751,"share":0.0002018697843080782,"catShare":0.000693803140119443,"trips":512},{"tool":"Edit","label":"src/features/workspace/components/TabContentView.tsx","kind":"write","tokens":3637,"share":0.00019575251811692455,"catShare":0.0006727788025400667,"trips":512},{"tool":null,"label":"其他 62 项","kind":null,"tokens":107006,"share":0.00575895638826638,"catShare":0.019792868158477788,"trips":12092}]},{"key":"assistant_thinking","label":"模型思考","tokens":2435071,"share":0.13105334100237934,"children":[]},{"key":"assistant_tool_use","label":"工具调用","tokens":2825273,"share":0.15205364659656845,"children":[{"tool":"Bash","label":"（无路径）","kind":"shell","tokens":661280,"share":0.03558949884403302,"catShare":0.23405883147583917,"trips":45115},{"tool":"Write","label":"docs/开发/图表总览.md","kind":"write","tokens":260454,"share":0.014017387447448938,"catShare":0.0921871179100369,"trips":198},{"tool":"Write","label":"docs/需求文档/2026-10-31-需求文档-Windows适配与开源文档.md","kind":"write","tokens":178446,"share":0.009603795577618356,"catShare":0.06316057386705973,"trips":185},{"tool":"Write","label":"README.md","kind":"write","tokens":155954,"share":0.008393327740779935,"catShare":0.055199779345307426,"trips":203},{"tool":"Edit","label":"docs/开发/数据库设计与迁移.md","kind":"write","tokens":125629,"share":0.006761254632685311,"catShare":0.044466244539497275,"trips":1127},{"tool":"Edit","label":"src/features/workspace/components/WindowBar.tsx","kind":"write","tokens":114014,"share":0.006136143806074787,"catShare":0.04035512428291389,"trips":1746},{"tool":"Write","label":"docs/开发任务清单/2026-10-31-任务-001/项目文件改造清单.md","kind":"write","tokens":99344,"share":0.005346591247093978,"catShare":0.03516253221653837,"trips":178},{"tool":"Edit","label":"docs/开发/README.md","kind":"write","tokens":92189,"share":0.004961530630427621,"catShare":0.03263013246628439,"trips":1088},{"tool":"Write","label":"docs/开发/环境安装与运行.md","kind":"write","tokens":91268,"share":0.004911941877555791,"catShare":0.03230400577362176,"trips":195},{"tool":"Write","label":"src/features/workspace/components/WindowControls.tsx","kind":"write","tokens":67417,"share":0.0036283046408431855,"catShare":0.02386200345769984,"trips":263},{"tool":"Edit","label":"src/api/fileDialog.ts","kind":"write","tokens":60918,"share":0.003278558801191273,"catShare":0.021561855796132307,"trips":1205},{"tool":"Write","label":"src/lib/window.ts","kind":"write","tokens":52641,"share":0.0028331108360867873,"catShare":0.018632311026408,"trips":264},{"tool":"Edit","label":"UI-SPEC.md","kind":"write","tokens":52163,"share":0.0028073445878450997,"catShare":0.018462856042470315,"trips":569},{"tool":"Write","label":"docs/更新日志/2026-10-31-更新内容-001.md","kind":"write","tokens":46484,"share":0.002501735190278824,"catShare":0.016452977263455404,"trips":170},{"tool":"Write","label":"src/lib/platform.ts","kind":"write","tokens":41834,"share":0.0022514781145872437,"catShare":0.014807130016164011,"trips":269},{"tool":null,"label":"其他 62 项","kind":null,"tokens":725238,"share":0.039031642622019094,"catShare":0.2566965245205764,"trips":17386}]},{"key":"assistant_text","label":"模型回复","tokens":4000,"share":0.00021527156560930888,"children":[]},{"key":"user_input","label":"用户输入","tokens":90231,"share":0.004856145788191044,"children":[]},{"key":"attachment","label":"附件/技能","tokens":7819908,"share":0.420860430851102,"children":[]}],"byTool":[{"tool":"Bash","tokens":5870215,"calls":277,"perCall":21192,"share":0.31592966631064784},{"tool":"Write","tokens":1211902,"calls":20,"perCall":60595,"share":0.06522349510272177},{"tool":"Edit","tokens":1071579,"calls":98,"perCall":10934,"share":0.05767143653525642},{"tool":"Read","tokens":43316,"calls":17,"perCall":2548,"share":0.0023312430669363334},{"tool":"TaskCreate","tokens":33189,"calls":4,"perCall":8297,"share":0.0017861922478414557},{"tool":"TaskUpdate","tokens":1216,"calls":5,"perCall":243,"share":0.00006545112046427965},{"tool":"UpdateGoal","tokens":137,"calls":1,"perCall":137,"share":0.00000734793654686102}],"byFile":[{"attr":"file:d:/workspace/jh-starrs-rust/docs/开发/图表总览.md","label":"docs/开发/图表总览.md","kind":"write","tool":"Write","selfTokens":6778,"reads":4,"trips":1266,"billed":278340,"perRead":69585,"share":0.014980016014046589},{"attr":"file:d:/workspace/jh-starrs-rust/docs/需求文档/2026-10-31-需求文档-Windows适配与开源文档.md","label":"docs/需求文档/2026-10-31-需求文档-Windows适配与开源文档.md","kind":"write","tool":"Write","selfTokens":4537,"reads":1,"trips":370,"billed":180757,"perRead":180757,"share":0.00972815819059042},{"attr":"file:d:/workspace/jh-starrs-rust/README.md","label":"README.md","kind":"write","tool":"Write","selfTokens":3893,"reads":3,"trips":818,"billed":164628,"perRead":54876,"share":0.008860152876215091},{"attr":"file:d:/workspace/jh-starrs-rust/docs/开发/数据库设计与迁移.md","label":"docs/开发/数据库设计与迁移.md","kind":"write","tool":"Edit","selfTokens":3305,"reads":6,"trips":2254,"billed":133887,"perRead":22314,"share":0.007205665038156263},{"attr":"file:d:/workspace/jh-starrs-rust/src/features/workspace/components/WindowBar.tsx","label":"src/features/workspace/components/WindowBar.tsx","kind":"write","tool":"Edit","selfTokens":2227,"reads":7,"trips":3492,"billed":125618,"perRead":17945,"share":0.006760623269647406},{"attr":"file:d:/workspace/jh-starrs-rust/docs/开发任务清单/2026-10-31-任务-001/项目文件改造清单.md","label":"docs/开发任务清单/2026-10-31-任务-001/项目文件改造清单.md","kind":"write","tool":"Write","selfTokens":4232,"reads":6,"trips":792,"billed":116734,"perRead":19456,"share":0.006282524162455463},{"attr":"file:d:/workspace/jh-starrs-rust/src/features/workspace/components/WindowControls.tsx","label":"src/features/workspace/components/WindowControls.tsx","kind":"write","tool":"Write","selfTokens":1882,"reads":6,"trips":2736,"billed":103178,"perRead":17196,"share":0.005552966664927487},{"attr":"file:d:/workspace/jh-starrs-rust/docs/开发/README.md","label":"docs/开发/README.md","kind":"write","tool":"Edit","selfTokens":3045,"reads":8,"trips":2176,"billed":98052,"perRead":12257,"share":0.005277076185710894},{"attr":"file:d:/workspace/jh-starrs-rust/docs/开发/环境安装与运行.md","label":"docs/开发/环境安装与运行.md","kind":"write","tool":"Write","selfTokens":2642,"reads":2,"trips":494,"billed":97928,"perRead":48964,"share":0.0052703745330768634},{"attr":"file:d:/workspace/jh-starrs-rust/src/api/fileDialog.ts","label":"src/api/fileDialog.ts","kind":"write","tool":"Edit","selfTokens":1263,"reads":5,"trips":2410,"billed":67290,"perRead":13458,"share":0.0036215013592820135},{"attr":"file:d:/workspace/jh-starrs-rust/UI-SPEC.md","label":"UI-SPEC.md","kind":"write","tool":"Edit","selfTokens":1576,"reads":4,"trips":1138,"billed":54958,"perRead":13740,"share":0.0029578168592355844},{"attr":"file:d:/workspace/jh-starrs-rust/src/lib/window.ts","label":"src/lib/window.ts","kind":"write","tool":"Write","selfTokens":932,"reads":1,"trips":528,"billed":54879,"perRead":54879,"share":0.0029535338917593794},{"attr":"file:d:/workspace/jh-starrs-rust/docs/更新日志/2026-10-31-更新内容-001.md","label":"docs/更新日志/2026-10-31-更新内容-001.md","kind":"write","tool":"Write","selfTokens":1927,"reads":2,"trips":442,"billed":54863,"perRead":27431,"share":0.002952659089884705},{"attr":"file:d:/workspace/jh-starrs-rust/docs/开发任务清单/2026-10-31-任务-001/完成进度.md","label":"docs/开发任务清单/2026-10-31-任务-001/完成进度.md","kind":"write","tool":"Write","selfTokens":1851,"reads":4,"trips":702,"billed":52034,"perRead":13008,"share":0.00280041492798252},{"attr":"file:d:/workspace/jh-starrs-rust/src-tauri/src/menu.rs","label":"src-tauri/src/menu.rs","kind":"write","tool":"Edit","selfTokens":804,"reads":4,"trips":1976,"billed":44391,"perRead":11098,"share":0.002389105548744439},{"attr":"file:d:/workspace/jh-starrs-rust/src/features/workspace/components/Sidebar.tsx","label":"src/features/workspace/components/Sidebar.tsx","kind":"write","tool":"Edit","selfTokens":774,"reads":4,"trips":2064,"billed":44381,"perRead":11095,"share":0.0023885610708712286},{"attr":"file:d:/workspace/jh-starrs-rust/src/lib/platform.ts","label":"src/lib/platform.ts","kind":"write","tool":"Write","selfTokens":731,"reads":1,"trips":538,"billed":44001,"perRead":44001,"share":0.0023681014413860072},{"attr":"file:d:/workspace/jh-starrs-rust/src/mocks/shortcuts.ts","label":"src/mocks/shortcuts.ts","kind":"write","tool":"Edit","selfTokens":701,"reads":1,"trips":510,"billed":39662,"perRead":39662,"share":0.0021345498373381887},{"attr":"file:d:/workspace/jh-starrs-rust/src-tauri/src/services/attachment_service.rs","label":"src-tauri/src/services/attachment_service.rs","kind":"write","tool":"Edit","selfTokens":671,"reads":1,"trips":496,"billed":36785,"perRead":36785,"share":0.0019797246782126813},{"attr":"file:d:/workspace/jh-starrs-rust/docs/开发/架构说明.md","label":"docs/开发/架构说明.md","kind":"write","tool":"Edit","selfTokens":870,"reads":3,"trips":1158,"billed":36230,"perRead":12077,"share":0.0019498620129375752},{"attr":"file:d:/workspace/jh-starrs-rust/docs/开发任务清单/2026-10-31-任务-001/任务计划.md","label":"docs/开发任务清单/2026-10-31-任务-001/任务计划.md","kind":"write","tool":"Write","selfTokens":918,"reads":1,"trips":366,"billed":36172,"perRead":36172,"share":0.001946769582463717},{"attr":"file:d:/workspace/jh-starrs-rust/src-tauri/src/db/paths.rs","label":"src-tauri/src/db/paths.rs","kind":"write","tool":"Edit","selfTokens":1198,"reads":3,"trips":770,"billed":34902,"perRead":11634,"share":0.0018784125149852594},{"attr":"file:d:/workspace/jh-starrs-rust/src/features/shortcuts/actions.ts","label":"src/features/shortcuts/actions.ts","kind":"write","tool":"Edit","selfTokens":585,"reads":2,"trips":1060,"billed":34599,"perRead":17300,"share":0.0018621041967175882},{"attr":"file:d:/workspace/jh-starrs-rust/src-tauri/Cargo.toml","label":"src-tauri/Cargo.toml","kind":"write","tool":"Edit","selfTokens":541,"reads":4,"trips":1950,"billed":29127,"perRead":7282,"share":0.0015676102341955621},{"attr":"file:d:/workspace/jh-starrs-rust/src/features/shortcuts/shortcutKeys.ts","label":"src/features/shortcuts/shortcutKeys.ts","kind":"write","tool":"Edit","selfTokens":473,"reads":3,"trips":1596,"billed":28099,"perRead":9366,"share":0.0015122612086033598},{"attr":"file:d:/workspace/jh-starrs-rust/src-tauri/tauri.conf.json","label":"src-tauri/tauri.conf.json","kind":"write","tool":"Write","selfTokens":489,"reads":1,"trips":490,"billed":26443,"perRead":26443,"share":0.0014231237524219968},{"attr":"file:d:/workspace/jh-starrs-rust/tmp/win-e2e/ui.ps1","label":"tmp/win-e2e/ui.ps1","kind":"write","tool":"Write","selfTokens":824,"reads":1,"trips":276,"billed":24444,"perRead":24444,"share":0.001315533323812129},{"attr":"file:d:/workspace/jh-starrs-rust/src-tauri/src/services/workspace_service.rs","label":"src-tauri/src/services/workspace_service.rs","kind":"write","tool":"Edit","selfTokens":418,"reads":1,"trips":498,"billed":23019,"perRead":23019,"share":0.0012388843441253814},{"attr":"file:d:/workspace/jh-starrs-rust/src/styles/tokens.css","label":"src/styles/tokens.css","kind":"write","tool":"Edit","selfTokens":385,"reads":2,"trips":1020,"billed":21783,"perRead":10891,"share":0.0011723276567406594},{"attr":"file:d:/workspace/jh-starrs-rust/src/features/workspace/components/WorkspaceRoot.tsx","label":"src/features/workspace/components/WorkspaceRoot.tsx","kind":"write","tool":"Edit","selfTokens":697,"reads":4,"trips":1032,"billed":19325,"perRead":4831,"share":0.0010400732248374575},{"attr":"file:d:/workspace/jh-starrs-rust/src/lib/i18n.tsx","label":"src/lib/i18n.tsx","kind":"write","tool":"Edit","selfTokens":296,"reads":2,"trips":1070,"billed":17692,"perRead":8846,"share":0.0009521887229509104},{"attr":"file:d:/workspace/jh-starrs-rust/src-tauri/tauri.macos.conf.json","label":"src-tauri/tauri.macos.conf.json","kind":"write","tool":"Write","selfTokens":309,"reads":1,"trips":490,"billed":16709,"perRead":16709,"share":0.0008992745184016298},{"attr":"file:d:/workspace/jh-starrs-rust/src/features/workspace/components/TabContentView.tsx","label":"src/features/workspace/components/TabContentView.tsx","kind":"write","tool":"Edit","selfTokens":271,"reads":2,"trips":1024,"billed":15401,"perRead":7701,"share":0.0008288895689013517},{"attr":"file:d:/workspace/jh-starrs-rust/src/features/workspace/hooks/useWorkspaceDialogActions.ts","label":"src/features/workspace/hooks/useWorkspaceDialogActions.ts","kind":"write","tool":"Edit","selfTokens":265,"reads":2,"trips":1024,"billed":15060,"perRead":7530,"share":0.0008105377703278905},{"attr":"file:d:/workspace/jh-starrs-rust/src-tauri/tauri.windows.conf.json","label":"src-tauri/tauri.windows.conf.json","kind":"write","tool":"Write","selfTokens":251,"reads":1,"trips":490,"billed":13573,"perRead":13573,"share":0.0007304786541061796},{"attr":"file:d:/workspace/jh-starrs-rust/src/components/common/TrafficLightSlot.tsx","label":"src/components/common/TrafficLightSlot.tsx","kind":"write","tool":"Edit","selfTokens":233,"reads":2,"trips":1040,"billed":13479,"perRead":6740,"share":0.0007254493124236035},{"attr":"file:d:/workspace/jh-starrs-rust/src/features/workspace/components/CreateWorkspaceWizard.tsx","label":"src/features/workspace/components/CreateWorkspaceWizard.tsx","kind":"write","tool":"Edit","selfTokens":385,"reads":1,"trips":314,"billed":12997,"perRead":12997,"share":0.000699490195692986},{"attr":"file:d:/workspace/jh-starrs-rust/src/features/workspace/components/WindowChromeOverlay.tsx","label":"src/features/workspace/components/WindowChromeOverlay.tsx","kind":"write","tool":"Write","selfTokens":449,"reads":1,"trips":260,"billed":12546,"perRead":12546,"share":0.0006752063766021741},{"attr":"file:d:/workspace/jh-starrs-rust/docs/设计/2026-10-31-Windows适配-001/说明.md","label":"docs/设计/2026-10-31-Windows适配-001/说明.md","kind":"write","tool":"Write","selfTokens":751,"reads":1,"trips":142,"billed":11422,"perRead":11422,"share":0.0006146987617834121},{"attr":"file:d:/workspace/jh-starrs-rust/src-tauri/src/commands/memory.rs","label":"src-tauri/src/commands/memory.rs","kind":"write","tool":"Edit","selfTokens":203,"reads":1,"trips":460,"billed":10230,"perRead":10230,"share":0.0005505950145127273},{"attr":"file:d:/workspace/jh-starrs-rust/docs/功能测试/2026-10-31-功能测试-Windows适配-001.md","label":"docs/功能测试/2026-10-31-功能测试-Windows适配-001.md","kind":"write","tool":"Write","selfTokens":1613,"reads":1,"trips":50,"billed":8579,"perRead":8579,"share":0.00046172761043522563},{"attr":"file:d:/workspace/jh-starrs-rust/package.json","label":"package.json","kind":"write","tool":"Edit","selfTokens":148,"reads":1,"trips":488,"billed":7967,"perRead":7967,"share":0.00042875320508930956},{"attr":"file:d:/workspace/jh-starrs-rust/src-tauri/src/lib.rs","label":"src-tauri/src/lib.rs","kind":"write","tool":"Edit","selfTokens":138,"reads":1,"trips":502,"billed":7669,"perRead":7669,"share":0.0004127252647780431},{"attr":"file:d:/workspace/jh-starrs-rust/docs/设计/2026-10-27-README-001/图片/doc-editor.png","label":"docs/设计/2026-10-27-README-001/图片/doc-editor.png","kind":"read","tool":"Read","selfTokens":110,"reads":1,"trips":558,"billed":6925,"perRead":6925,"share":0.00037271086276497616},{"attr":"file:d:/workspace/jh-starrs-rust/docs/单元测试/2026-10-31-单元测试-平台路径与窗口依赖-001.md","label":"docs/单元测试/2026-10-31-单元测试-平台路径与窗口依赖-001.md","kind":"write","tool":"Write","selfTokens":1170,"reads":1,"trips":52,"billed":6473,"perRead":6473,"share":0.0003483946551197719},{"attr":"file:d:/workspace/jh-starrs-rust/biome.json","label":"biome.json","kind":"write","tool":"Edit","selfTokens":115,"reads":1,"trips":448,"billed":5628,"perRead":5628,"share":0.00030289715969785926},{"attr":"file:d:/workspace/jh-starrs-rust/src-tauri/src/integration_tests.rs","label":"src-tauri/src/integration_tests.rs","kind":"read","tool":"Read","selfTokens":358,"reads":2,"trips":250,"billed":4791,"perRead":2395,"share":0.00025782415584579236},{"attr":"file:d:/workspace/jh-starrs-rust/tmp/win-e2e/shots/01-onboarding.png","label":"tmp/win-e2e/shots/01-onboarding.png","kind":"read","tool":"Read","selfTokens":103,"reads":1,"trips":268,"billed":2967,"perRead":2967,"share":0.000159670938054064},{"attr":"file:d:/workspace/jh-starrs-rust/tmp/win-e2e/shots/screen.png","label":"tmp/win-e2e/shots/screen.png","kind":"read","tool":"Read","selfTokens":102,"reads":1,"trips":264,"billed":2894,"perRead":2894,"share":0.00015575529747852048},{"attr":"file:d:/workspace/jh-starrs-rust/tmp/win-e2e/shots/02-onboarding-win.png","label":"tmp/win-e2e/shots/02-onboarding-win.png","kind":"read","tool":"Read","selfTokens":105,"reads":1,"trips":226,"billed":2550,"perRead":2550,"share":0.00013722536174057626},{"attr":"file:d:/workspace/jh-starrs-rust/tmp/win-e2e/shots/03-maximized.png","label":"tmp/win-e2e/shots/03-maximized.png","kind":"read","tool":"Read","selfTokens":104,"reads":1,"trips":222,"billed":2481,"perRead":2481,"share":0.0001335107612287602},{"attr":"file:d:/workspace/jh-starrs-rust/tmp/win-e2e/shots/03-controls-zoom.png","label":"tmp/win-e2e/shots/03-controls-zoom.png","kind":"read","tool":"Read","selfTokens":105,"reads":1,"trips":218,"billed":2459,"perRead":2459,"share":0.0001323581377156178},{"attr":"file:d:/workspace/jh-starrs-rust/tmp/win-e2e/shots/05-create-dialog.png","label":"tmp/win-e2e/shots/05-create-dialog.png","kind":"read","tool":"Read","selfTokens":104,"reads":1,"trips":210,"billed":2346,"perRead":2346,"share":0.0001262692788340162},{"attr":"file:d:/workspace/jh-starrs-rust/tmp/win-e2e/shots/06-filled.png","label":"tmp/win-e2e/shots/06-filled.png","kind":"read","tool":"Read","selfTokens":103,"reads":1,"trips":206,"billed":2279,"perRead":2279,"share":0.00012266194443857887},{"attr":"file:d:/workspace/jh-starrs-rust/tmp/win-e2e/shots/07-filled2.png","label":"tmp/win-e2e/shots/07-filled2.png","kind":"read","tool":"Read","selfTokens":102,"reads":1,"trips":202,"billed":2213,"perRead":2213,"share":0.00011909919452576677},{"attr":"file:d:/workspace/jh-starrs-rust/tmp/win-e2e/shots/09-close-hover-zoom.png","label":"tmp/win-e2e/shots/09-close-hover-zoom.png","kind":"read","tool":"Read","selfTokens":105,"reads":1,"trips":194,"billed":2187,"perRead":2187,"share":0.00011770841475153983},{"attr":"file:d:/workspace/jh-starrs-rust/tmp/win-e2e/shots/08-main.png","label":"tmp/win-e2e/shots/08-main.png","kind":"read","tool":"Read","selfTokens":102,"reads":1,"trips":198,"billed":2169,"perRead":2169,"share":0.00011672388836328402},{"attr":"file:d:/workspace/jh-starrs-rust/tmp/win-e2e/shots/15-ctrl-n.png","label":"tmp/win-e2e/shots/15-ctrl-n.png","kind":"read","tool":"Read","selfTokens":103,"reads":1,"trips":158,"billed":1745,"perRead":1745,"share":0.0000938986674522214},{"attr":"file:d:/workspace/jh-starrs-rust/tmp/win-e2e/shots/16-editor.png","label":"tmp/win-e2e/shots/16-editor.png","kind":"read","tool":"Read","selfTokens":102,"reads":1,"trips":154,"billed":1684,"perRead":1684,"share":0.00009061452567429368},{"attr":"file:d:/workspace/jh-starrs-rust/docs/开发/前端代码规范.md","label":"docs/开发/前端代码规范.md","kind":"write","tool":"Edit","selfTokens":166,"reads":1,"trips":94,"billed":1665,"perRead":1665,"share":0.00008963554830279419},{"attr":"file:d:/workspace/jh-starrs-rust/tmp/win-e2e/shots/17-editor-saved.png","label":"tmp/win-e2e/shots/17-editor-saved.png","kind":"read","tool":"Read","selfTokens":103,"reads":1,"trips":150,"billed":1656,"perRead":1656,"share":0.00008910427821162044},{"attr":"file:d:/workspace/jh-starrs-rust/src-tauri/src/commands/log.rs","label":"src-tauri/src/commands/log.rs","kind":"write","tool":"Edit","selfTokens":194,"reads":2,"trips":96,"billed":991,"perRead":495,"share":0.00005330965252356049},{"attr":"file:d:/workspace/jh-starrs-rust/tmp/win-e2e/shots/18-final-release-onboarding.png","label":"tmp/win-e2e/shots/18-final-release-onboarding.png","kind":"read","tool":"Read","selfTokens":107,"reads":1,"trips":66,"billed":753,"perRead":753,"share":0.000040500795830193366},{"attr":"file:d:/workspace/jh-starrs-rust/docs/更新日志/2026-11-01-更新内容-001.md","label":"docs/更新日志/2026-11-01-更新内容-001.md","kind":"write","tool":"Write","selfTokens":508,"reads":1,"trips":2,"billed":108,"perRead":108,"share":0.000005798518991083614}],"byAttr":[{"attr":"attachment","tokens":7819908,"share":0.420860430851102},{"attr":"tool_result|Bash","tokens":5208934,"share":0.2803401674666184},{"attr":"assistant_thinking","tokens":2435071,"share":0.13105334100237934},{"attr":"tool_use|Write","tokens":1178957,"share":0.06345038413854896},{"attr":"tool_use|Edit","tokens":949849,"share":0.05112002941331182},{"attr":"tool_use|Bash","tokens":661280,"share":0.03558949884403302},{"attr":"tool_result|Edit","tokens":121730,"share":0.006551407121944474},{"attr":"user_input","tokens":90231,"share":0.004856145788191044},{"attr":"tool_result|Read","tokens":35017,"share":0.0018845590256932098},{"attr":"tool_result|Write","tokens":32946,"share":0.0017731109641729366},{"attr":"tool_use|TaskCreate","tokens":26143,"share":0.0014069807983989248},{"attr":"tool_use|Read","tokens":8300,"share":0.0004466840412431434},{"attr":"tool_result|TaskCreate","tokens":7046,"share":0.0003792114494425313},{"attr":"assistant_text","tokens":4000,"share":0.00021527156560930888},{"attr":"tool_use|TaskUpdate","tokens":730,"share":0.0000392706722785678},{"attr":"tool_result|TaskUpdate","tokens":486,"share":0.00002618044818571188},{"attr":"tool_result|UpdateGoal","tokens":122,"share":0.000006549247791767431},{"attr":"tool_use|UpdateGoal","tokens":15,"share":7.986887550935891e-7},{"attr":"system","tokens":0,"share":0}],"byRequest":[{"index":1,"time":"22:27","ratio":0.045077,"inputTokens":9015,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.984,"originalCredits":0.984,"afterCompact":false},{"index":2,"time":"22:27","ratio":0.046903,"inputTokens":9381,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.074,"originalCredits":0.074,"afterCompact":false},{"index":3,"time":"22:27","ratio":0.049238,"inputTokens":9848,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.096,"originalCredits":0.096,"afterCompact":false},{"index":4,"time":"22:27","ratio":0.052933,"inputTokens":10587,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.142,"originalCredits":0.142,"afterCompact":false},{"index":5,"time":"22:27","ratio":0.058128,"inputTokens":11626,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.184,"originalCredits":0.184,"afterCompact":false},{"index":6,"time":"22:27","ratio":0.060975,"inputTokens":12195,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.13,"originalCredits":0.13,"afterCompact":false},{"index":7,"time":"22:27","ratio":0.062849,"inputTokens":12570,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.075,"originalCredits":0.075,"afterCompact":false},{"index":8,"time":"22:27","ratio":0.063557,"inputTokens":12711,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.058,"originalCredits":0.058,"afterCompact":false},{"index":9,"time":"22:27","ratio":0.06441,"inputTokens":12882,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.055,"originalCredits":0.055,"afterCompact":false},{"index":10,"time":"22:27","ratio":0.065058,"inputTokens":13012,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.165,"originalCredits":0.165,"afterCompact":false},{"index":11,"time":"22:27","ratio":0.067048,"inputTokens":13410,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.084,"originalCredits":0.084,"afterCompact":false},{"index":12,"time":"22:27","ratio":0.068222,"inputTokens":13644,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.068,"originalCredits":0.068,"afterCompact":false},{"index":13,"time":"22:28","ratio":0.074136,"inputTokens":14827,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.209,"originalCredits":0.209,"afterCompact":false},{"index":14,"time":"22:28","ratio":0.077415,"inputTokens":15483,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.148,"originalCredits":0.148,"afterCompact":false},{"index":15,"time":"22:28","ratio":0.083921,"inputTokens":16784,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.263,"originalCredits":0.263,"afterCompact":false},{"index":16,"time":"22:28","ratio":0.089132,"inputTokens":17826,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.192,"originalCredits":0.192,"afterCompact":false},{"index":17,"time":"22:28","ratio":0.092549,"inputTokens":18510,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.393,"originalCredits":0.393,"afterCompact":false},{"index":18,"time":"22:28","ratio":0.100558,"inputTokens":20112,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.213,"originalCredits":0.213,"afterCompact":false},{"index":19,"time":"22:29","ratio":0.102239,"inputTokens":20448,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.081,"originalCredits":0.081,"afterCompact":false},{"index":20,"time":"22:29","ratio":0.10386,"inputTokens":20772,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.112,"originalCredits":0.112,"afterCompact":false},{"index":21,"time":"22:29","ratio":0.104706,"inputTokens":20941,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.425,"originalCredits":0.425,"afterCompact":false},{"index":22,"time":"22:29","ratio":0.110972,"inputTokens":22194,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.141,"originalCredits":0.141,"afterCompact":false},{"index":23,"time":"22:29","ratio":0.112629,"inputTokens":22526,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.091,"originalCredits":0.091,"afterCompact":false},{"index":24,"time":"22:29","ratio":0.114217,"inputTokens":22843,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.318,"originalCredits":0.318,"afterCompact":false},{"index":25,"time":"22:30","ratio":0.120384,"inputTokens":24077,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.156,"originalCredits":0.156,"afterCompact":false},{"index":26,"time":"22:30","ratio":0.122803,"inputTokens":24561,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.21,"originalCredits":0.21,"afterCompact":false},{"index":27,"time":"22:30","ratio":0.125506,"inputTokens":25101,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.161,"originalCredits":0.161,"afterCompact":false},{"index":28,"time":"22:30","ratio":0.131086,"inputTokens":26217,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.233,"originalCredits":0.233,"afterCompact":false},{"index":29,"time":"22:30","ratio":0.133057,"inputTokens":26611,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.15,"originalCredits":0.15,"afterCompact":false},{"index":30,"time":"22:30","ratio":0.134491,"inputTokens":26898,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.095,"originalCredits":0.095,"afterCompact":false},{"index":31,"time":"22:30","ratio":0.13523,"inputTokens":27046,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.092,"originalCredits":0.092,"afterCompact":false},{"index":32,"time":"22:30","ratio":0.135967,"inputTokens":27193,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.13,"originalCredits":0.13,"afterCompact":false},{"index":33,"time":"22:30","ratio":0.137214,"inputTokens":27443,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.134,"originalCredits":0.134,"afterCompact":false},{"index":34,"time":"22:30","ratio":0.138433,"inputTokens":27687,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.267,"originalCredits":0.267,"afterCompact":false},{"index":35,"time":"22:31","ratio":0.141135,"inputTokens":28227,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.178,"originalCredits":0.178,"afterCompact":false},{"index":36,"time":"22:31","ratio":0.142826,"inputTokens":28565,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.204,"originalCredits":0.204,"afterCompact":false},{"index":37,"time":"22:31","ratio":0.145042,"inputTokens":29008,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.143,"originalCredits":0.143,"afterCompact":false},{"index":38,"time":"22:31","ratio":0.146264,"inputTokens":29253,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.103,"originalCredits":0.103,"afterCompact":false},{"index":39,"time":"22:31","ratio":0.147107,"inputTokens":29421,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.088,"originalCredits":0.088,"afterCompact":false},{"index":40,"time":"22:31","ratio":0.148329,"inputTokens":29666,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.167,"originalCredits":0.167,"afterCompact":false},{"index":41,"time":"22:31","ratio":0.149813,"inputTokens":29963,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.093,"originalCredits":0.093,"afterCompact":false},{"index":42,"time":"22:31","ratio":0.151207,"inputTokens":30241,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.151,"originalCredits":0.151,"afterCompact":false},{"index":43,"time":"22:31","ratio":0.152482,"inputTokens":30496,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.202,"originalCredits":0.202,"afterCompact":false},{"index":44,"time":"22:31","ratio":0.154418,"inputTokens":30884,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.094,"originalCredits":0.094,"afterCompact":false},{"index":45,"time":"22:31","ratio":0.155628,"inputTokens":31126,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.159,"originalCredits":0.159,"afterCompact":false},{"index":46,"time":"22:31","ratio":0.157153,"inputTokens":31431,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.18,"originalCredits":0.18,"afterCompact":false},{"index":47,"time":"22:31","ratio":0.158949,"inputTokens":31790,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.111,"originalCredits":0.111,"afterCompact":false},{"index":48,"time":"22:31","ratio":0.159704,"inputTokens":31941,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.137,"originalCredits":0.137,"afterCompact":false},{"index":49,"time":"22:32","ratio":0.161139,"inputTokens":32228,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.197,"originalCredits":0.197,"afterCompact":false},{"index":50,"time":"22:32","ratio":0.162901,"inputTokens":32580,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.166,"originalCredits":0.166,"afterCompact":false},{"index":51,"time":"22:32","ratio":0.164371,"inputTokens":32874,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.106,"originalCredits":0.106,"afterCompact":false},{"index":52,"time":"22:32","ratio":0.165096,"inputTokens":33019,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.206,"originalCredits":0.206,"afterCompact":false},{"index":53,"time":"22:32","ratio":0.167249,"inputTokens":33450,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.275,"originalCredits":0.275,"afterCompact":false},{"index":54,"time":"22:32","ratio":0.169933,"inputTokens":33987,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.125,"originalCredits":0.125,"afterCompact":false},{"index":55,"time":"22:32","ratio":0.170828,"inputTokens":34166,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.105,"originalCredits":0.105,"afterCompact":false},{"index":56,"time":"22:34","ratio":0.171598,"inputTokens":34320,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.103,"originalCredits":0.103,"afterCompact":false},{"index":57,"time":"22:35","ratio":0.172458,"inputTokens":34492,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.113,"originalCredits":0.113,"afterCompact":false},{"index":58,"time":"22:35","ratio":0.173592,"inputTokens":34718,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.18,"originalCredits":0.18,"afterCompact":false},{"index":59,"time":"22:35","ratio":0.175282,"inputTokens":35056,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.116,"originalCredits":0.116,"afterCompact":false},{"index":60,"time":"22:35","ratio":0.176328,"inputTokens":35266,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.114,"originalCredits":0.114,"afterCompact":false},{"index":61,"time":"22:35","ratio":0.177934,"inputTokens":35587,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.127,"originalCredits":0.127,"afterCompact":false},{"index":62,"time":"22:36","ratio":0.178658,"inputTokens":35732,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.109,"originalCredits":0.109,"afterCompact":false},{"index":63,"time":"22:36","ratio":0.179357,"inputTokens":35871,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.102,"originalCredits":0.102,"afterCompact":false},{"index":64,"time":"22:36","ratio":0.180022,"inputTokens":36004,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.121,"originalCredits":0.121,"afterCompact":false},{"index":65,"time":"22:36","ratio":0.180937,"inputTokens":36187,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.112,"originalCredits":0.112,"afterCompact":false},{"index":66,"time":"22:36","ratio":0.181862,"inputTokens":36372,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.126,"originalCredits":0.126,"afterCompact":false},{"index":67,"time":"22:36","ratio":0.183313,"inputTokens":36663,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.115,"originalCredits":0.115,"afterCompact":false},{"index":68,"time":"22:36","ratio":0.184316,"inputTokens":36863,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.134,"originalCredits":0.134,"afterCompact":false},{"index":69,"time":"22:36","ratio":0.185233,"inputTokens":37047,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.115,"originalCredits":0.115,"afterCompact":false},{"index":70,"time":"22:36","ratio":0.186629,"inputTokens":37326,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.16,"originalCredits":0.16,"afterCompact":false},{"index":71,"time":"22:36","ratio":0.188072,"inputTokens":37614,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.111,"originalCredits":0.111,"afterCompact":false},{"index":72,"time":"22:36","ratio":0.188872,"inputTokens":37774,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.11,"originalCredits":0.11,"afterCompact":false},{"index":73,"time":"22:36","ratio":0.189563,"inputTokens":37913,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.105,"originalCredits":0.105,"afterCompact":false},{"index":74,"time":"22:37","ratio":0.190305,"inputTokens":38061,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.139,"originalCredits":0.139,"afterCompact":false},{"index":75,"time":"22:37","ratio":0.19209,"inputTokens":38418,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.128,"originalCredits":0.128,"afterCompact":false},{"index":76,"time":"22:37","ratio":0.193147,"inputTokens":38629,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.122,"originalCredits":0.122,"afterCompact":false},{"index":77,"time":"22:37","ratio":0.194189,"inputTokens":38838,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.286,"originalCredits":0.286,"afterCompact":false},{"index":78,"time":"22:37","ratio":0.197056,"inputTokens":39411,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.15,"originalCredits":0.15,"afterCompact":false},{"index":79,"time":"22:37","ratio":0.198492,"inputTokens":39698,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.123,"originalCredits":0.123,"afterCompact":false},{"index":80,"time":"22:37","ratio":0.199431,"inputTokens":39886,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.123,"originalCredits":0.123,"afterCompact":false},{"index":81,"time":"22:37","ratio":0.20032,"inputTokens":40064,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.156,"originalCredits":0.156,"afterCompact":false},{"index":82,"time":"22:37","ratio":0.201424,"inputTokens":40285,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.113,"originalCredits":0.113,"afterCompact":false},{"index":83,"time":"22:37","ratio":0.202066,"inputTokens":40413,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.123,"originalCredits":0.123,"afterCompact":false},{"index":84,"time":"22:37","ratio":0.203146,"inputTokens":40629,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.133,"originalCredits":0.133,"afterCompact":false},{"index":85,"time":"22:38","ratio":0.203979,"inputTokens":40796,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.113,"originalCredits":0.113,"afterCompact":false},{"index":86,"time":"22:38","ratio":0.204845,"inputTokens":40969,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.154,"originalCredits":0.154,"afterCompact":false},{"index":87,"time":"22:38","ratio":0.205964,"inputTokens":41193,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.139,"originalCredits":0.139,"afterCompact":false},{"index":88,"time":"22:38","ratio":0.207855,"inputTokens":41571,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.183,"originalCredits":0.183,"afterCompact":false},{"index":89,"time":"22:38","ratio":0.210427,"inputTokens":42085,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.233,"originalCredits":0.233,"afterCompact":false},{"index":90,"time":"22:38","ratio":0.212591,"inputTokens":42518,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.129,"originalCredits":0.129,"afterCompact":false},{"index":91,"time":"22:38","ratio":0.219154,"inputTokens":43831,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.274,"originalCredits":0.274,"afterCompact":false},{"index":92,"time":"22:39","ratio":0.222432,"inputTokens":44486,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.178,"originalCredits":0.178,"afterCompact":false},{"index":93,"time":"22:39","ratio":0.224274,"inputTokens":44855,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.147,"originalCredits":0.147,"afterCompact":false},{"index":94,"time":"22:39","ratio":0.22789,"inputTokens":45578,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.198,"originalCredits":0.198,"afterCompact":false},{"index":95,"time":"22:39","ratio":0.228957,"inputTokens":45791,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.473,"originalCredits":0.473,"afterCompact":false},{"index":96,"time":"22:39","ratio":0.233451,"inputTokens":46690,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.177,"originalCredits":0.177,"afterCompact":false},{"index":97,"time":"22:39","ratio":0.238779,"inputTokens":47756,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.217,"originalCredits":0.217,"afterCompact":false},{"index":98,"time":"22:39","ratio":0.239959,"inputTokens":47992,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.208,"originalCredits":0.208,"afterCompact":false},{"index":99,"time":"22:39","ratio":0.241347,"inputTokens":48269,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.145,"originalCredits":0.145,"afterCompact":false},{"index":100,"time":"22:40","ratio":0.242086,"inputTokens":48417,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.69,"originalCredits":0.69,"afterCompact":false},{"index":101,"time":"22:40","ratio":0.249036,"inputTokens":49807,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.151,"originalCredits":0.151,"afterCompact":false},{"index":102,"time":"22:40","ratio":0.251549,"inputTokens":50310,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.206,"originalCredits":0.206,"afterCompact":false},{"index":103,"time":"22:40","ratio":0.253043,"inputTokens":50609,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.324,"originalCredits":0.324,"afterCompact":false},{"index":104,"time":"22:40","ratio":0.255705,"inputTokens":51141,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.313,"originalCredits":0.313,"afterCompact":false},{"index":105,"time":"22:41","ratio":0.258459,"inputTokens":51692,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.219,"originalCredits":0.219,"afterCompact":false},{"index":106,"time":"22:41","ratio":0.260835,"inputTokens":52167,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.215,"originalCredits":0.215,"afterCompact":false},{"index":107,"time":"22:41","ratio":0.262113,"inputTokens":52423,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.143,"originalCredits":0.143,"afterCompact":false},{"index":108,"time":"22:41","ratio":0.263112,"inputTokens":52622,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.152,"originalCredits":0.152,"afterCompact":false},{"index":109,"time":"22:41","ratio":0.264027,"inputTokens":52805,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.242,"originalCredits":0.242,"afterCompact":false},{"index":110,"time":"22:41","ratio":0.265778,"inputTokens":53156,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.238,"originalCredits":0.238,"afterCompact":false},{"index":111,"time":"22:41","ratio":0.267509,"inputTokens":53502,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.225,"originalCredits":0.225,"afterCompact":false},{"index":112,"time":"22:41","ratio":0.269141,"inputTokens":53828,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.14,"originalCredits":0.14,"afterCompact":false},{"index":113,"time":"22:42","ratio":0.270735,"inputTokens":54147,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.497,"originalCredits":0.497,"afterCompact":false},{"index":114,"time":"22:42","ratio":0.286882,"inputTokens":57376,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.409,"originalCredits":0.409,"afterCompact":false},{"index":115,"time":"22:42","ratio":0.287549,"inputTokens":57510,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.305,"originalCredits":0.305,"afterCompact":false},{"index":116,"time":"22:42","ratio":0.290005,"inputTokens":58001,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.152,"originalCredits":0.152,"afterCompact":false},{"index":117,"time":"22:42","ratio":0.291262,"inputTokens":58252,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.171,"originalCredits":0.171,"afterCompact":false},{"index":118,"time":"22:42","ratio":0.292265,"inputTokens":58453,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.179,"originalCredits":0.179,"afterCompact":false},{"index":119,"time":"22:42","ratio":0.293085,"inputTokens":58617,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.152,"originalCredits":0.152,"afterCompact":false},{"index":120,"time":"22:42","ratio":0.293725,"inputTokens":58745,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.361,"originalCredits":0.361,"afterCompact":false},{"index":121,"time":"22:42","ratio":0.296715,"inputTokens":59343,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.153,"originalCredits":0.153,"afterCompact":false},{"index":122,"time":"22:43","ratio":0.298519,"inputTokens":59704,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.251,"originalCredits":0.251,"afterCompact":false},{"index":123,"time":"22:43","ratio":0.300036,"inputTokens":60007,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.175,"originalCredits":0.175,"afterCompact":false},{"index":124,"time":"22:43","ratio":0.30084,"inputTokens":60168,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.217,"originalCredits":0.217,"afterCompact":false},{"index":125,"time":"22:43","ratio":0.302138,"inputTokens":60428,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.19,"originalCredits":0.19,"afterCompact":false},{"index":126,"time":"22:43","ratio":0.303137,"inputTokens":60627,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.17,"originalCredits":0.17,"afterCompact":false},{"index":127,"time":"22:43","ratio":0.304391,"inputTokens":60878,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.19,"originalCredits":0.19,"afterCompact":false},{"index":128,"time":"22:43","ratio":0.305525,"inputTokens":61105,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.288,"originalCredits":0.288,"afterCompact":false},{"index":129,"time":"22:43","ratio":0.307557,"inputTokens":61511,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.197,"originalCredits":0.197,"afterCompact":false},{"index":130,"time":"22:43","ratio":0.308642,"inputTokens":61728,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.178,"originalCredits":0.178,"afterCompact":false},{"index":131,"time":"22:43","ratio":0.310541,"inputTokens":62108,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.184,"originalCredits":0.184,"afterCompact":false},{"index":132,"time":"22:43","ratio":0.311332,"inputTokens":62266,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.189,"originalCredits":0.189,"afterCompact":false},{"index":133,"time":"22:43","ratio":0.31259,"inputTokens":62518,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.168,"originalCredits":0.168,"afterCompact":false},{"index":134,"time":"22:44","ratio":0.313197,"inputTokens":62639,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.184,"originalCredits":0.184,"afterCompact":false},{"index":135,"time":"22:44","ratio":0.314081,"inputTokens":62816,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.253,"originalCredits":0.253,"afterCompact":false},{"index":136,"time":"22:44","ratio":0.315719,"inputTokens":63144,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.161,"originalCredits":0.161,"afterCompact":false},{"index":137,"time":"22:44","ratio":0.31674,"inputTokens":63348,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.215,"originalCredits":0.215,"afterCompact":false},{"index":138,"time":"22:44","ratio":0.318123,"inputTokens":63625,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.167,"originalCredits":0.167,"afterCompact":false},{"index":139,"time":"22:44","ratio":0.320077,"inputTokens":64015,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.194,"originalCredits":0.194,"afterCompact":false},{"index":140,"time":"22:44","ratio":0.32093,"inputTokens":64186,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.167,"originalCredits":0.167,"afterCompact":false},{"index":141,"time":"22:44","ratio":0.322735,"inputTokens":64547,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.257,"originalCredits":0.257,"afterCompact":false},{"index":142,"time":"22:44","ratio":0.324094,"inputTokens":64819,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.168,"originalCredits":0.168,"afterCompact":false},{"index":143,"time":"22:44","ratio":0.324988,"inputTokens":64998,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.217,"originalCredits":0.217,"afterCompact":false},{"index":144,"time":"22:44","ratio":0.326165,"inputTokens":65233,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.249,"originalCredits":0.249,"afterCompact":false},{"index":145,"time":"22:45","ratio":0.328052,"inputTokens":65610,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.177,"originalCredits":0.177,"afterCompact":false},{"index":146,"time":"22:45","ratio":0.328753,"inputTokens":65751,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.174,"originalCredits":0.174,"afterCompact":false},{"index":147,"time":"22:45","ratio":0.330023,"inputTokens":66005,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.204,"originalCredits":0.204,"afterCompact":false},{"index":148,"time":"22:45","ratio":0.33189,"inputTokens":66378,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.197,"originalCredits":0.197,"afterCompact":false},{"index":149,"time":"22:45","ratio":0.332859,"inputTokens":66572,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.186,"originalCredits":0.186,"afterCompact":false},{"index":150,"time":"22:45","ratio":0.334059,"inputTokens":66812,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.205,"originalCredits":0.205,"afterCompact":false},{"index":151,"time":"22:45","ratio":0.335194,"inputTokens":67039,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.192,"originalCredits":0.192,"afterCompact":false},{"index":152,"time":"22:45","ratio":0.336855,"inputTokens":67371,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.199,"originalCredits":0.199,"afterCompact":false},{"index":153,"time":"22:45","ratio":0.337665,"inputTokens":67533,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.185,"originalCredits":0.185,"afterCompact":false},{"index":154,"time":"22:45","ratio":0.338487,"inputTokens":67697,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.181,"originalCredits":0.181,"afterCompact":false},{"index":155,"time":"22:45","ratio":0.339375,"inputTokens":67875,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.205,"originalCredits":0.205,"afterCompact":false},{"index":156,"time":"22:45","ratio":0.340298,"inputTokens":68060,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.175,"originalCredits":0.175,"afterCompact":false},{"index":157,"time":"22:46","ratio":0.341062,"inputTokens":68212,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.242,"originalCredits":0.242,"afterCompact":false},{"index":158,"time":"22:46","ratio":0.34303,"inputTokens":68606,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.202,"originalCredits":0.202,"afterCompact":false},{"index":159,"time":"22:46","ratio":0.344049,"inputTokens":68810,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.187,"originalCredits":0.187,"afterCompact":false},{"index":160,"time":"22:46","ratio":0.34483,"inputTokens":68966,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.278,"originalCredits":0.278,"afterCompact":false},{"index":161,"time":"22:46","ratio":0.346611,"inputTokens":69322,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.189,"originalCredits":0.189,"afterCompact":false},{"index":162,"time":"22:47","ratio":0.34735,"inputTokens":69470,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.184,"originalCredits":0.184,"afterCompact":false},{"index":163,"time":"22:47","ratio":0.348297,"inputTokens":69659,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.219,"originalCredits":0.219,"afterCompact":false},{"index":164,"time":"22:47","ratio":0.349375,"inputTokens":69875,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.173,"originalCredits":0.173,"afterCompact":false},{"index":165,"time":"22:47","ratio":0.350571,"inputTokens":70114,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.258,"originalCredits":0.258,"afterCompact":false},{"index":166,"time":"22:47","ratio":0.351903,"inputTokens":70381,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.174,"originalCredits":0.174,"afterCompact":false},{"index":167,"time":"22:47","ratio":0.353423,"inputTokens":70685,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.275,"originalCredits":0.275,"afterCompact":false},{"index":168,"time":"22:47","ratio":0.356717,"inputTokens":71343,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.28,"originalCredits":0.28,"afterCompact":false},{"index":169,"time":"22:47","ratio":0.358037,"inputTokens":71607,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.242,"originalCredits":0.242,"afterCompact":false},{"index":170,"time":"22:47","ratio":0.359465,"inputTokens":71893,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.211,"originalCredits":0.211,"afterCompact":false},{"index":171,"time":"22:47","ratio":0.360561,"inputTokens":72112,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.198,"originalCredits":0.198,"afterCompact":false},{"index":172,"time":"22:48","ratio":0.362869,"inputTokens":72574,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.241,"originalCredits":0.241,"afterCompact":false},{"index":173,"time":"22:48","ratio":0.363731,"inputTokens":72746,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.185,"originalCredits":0.185,"afterCompact":false},{"index":174,"time":"22:48","ratio":0.364355,"inputTokens":72871,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.193,"originalCredits":0.193,"afterCompact":false},{"index":175,"time":"22:48","ratio":0.365243,"inputTokens":73049,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.203,"originalCredits":0.203,"afterCompact":false},{"index":176,"time":"22:48","ratio":0.366137,"inputTokens":73227,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.188,"originalCredits":0.188,"afterCompact":false},{"index":177,"time":"22:48","ratio":0.367107,"inputTokens":73421,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.202,"originalCredits":0.202,"afterCompact":false},{"index":178,"time":"22:48","ratio":0.367998,"inputTokens":73600,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.23,"originalCredits":0.23,"afterCompact":false},{"index":179,"time":"22:48","ratio":0.369056,"inputTokens":73811,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.19,"originalCredits":0.19,"afterCompact":false},{"index":180,"time":"22:48","ratio":0.369812,"inputTokens":73962,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.188,"originalCredits":0.188,"afterCompact":false},{"index":181,"time":"22:49","ratio":0.370672,"inputTokens":74134,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.193,"originalCredits":0.193,"afterCompact":false},{"index":182,"time":"22:49","ratio":0.371431,"inputTokens":74286,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.195,"originalCredits":0.195,"afterCompact":false},{"index":183,"time":"22:50","ratio":0.372202,"inputTokens":74440,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.195,"originalCredits":0.195,"afterCompact":false},{"index":184,"time":"22:50","ratio":0.373025,"inputTokens":74605,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.209,"originalCredits":0.209,"afterCompact":false},{"index":185,"time":"22:50","ratio":0.374057,"inputTokens":74811,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.189,"originalCredits":0.189,"afterCompact":false},{"index":186,"time":"22:50","ratio":0.375254,"inputTokens":75051,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.232,"originalCredits":0.232,"afterCompact":false},{"index":187,"time":"22:50","ratio":0.376229,"inputTokens":75246,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.189,"originalCredits":0.189,"afterCompact":false},{"index":188,"time":"22:50","ratio":0.377818,"inputTokens":75564,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.221,"originalCredits":0.221,"afterCompact":false},{"index":189,"time":"22:51","ratio":0.378549,"inputTokens":75710,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.186,"originalCredits":0.186,"afterCompact":false},{"index":190,"time":"22:51","ratio":0.379289,"inputTokens":75858,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.227,"originalCredits":0.227,"afterCompact":false},{"index":191,"time":"22:51","ratio":0.380495,"inputTokens":76099,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.243,"originalCredits":0.243,"afterCompact":false},{"index":192,"time":"22:51","ratio":0.381873,"inputTokens":76375,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.215,"originalCredits":0.215,"afterCompact":false},{"index":193,"time":"22:51","ratio":0.382714,"inputTokens":76543,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.189,"originalCredits":0.189,"afterCompact":false},{"index":194,"time":"22:51","ratio":0.383911,"inputTokens":76782,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.251,"originalCredits":0.251,"afterCompact":false},{"index":195,"time":"22:51","ratio":0.385261,"inputTokens":77052,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.193,"originalCredits":0.193,"afterCompact":false},{"index":196,"time":"22:51","ratio":0.386456,"inputTokens":77291,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.256,"originalCredits":0.256,"afterCompact":false},{"index":197,"time":"22:51","ratio":0.387666,"inputTokens":77533,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.191,"originalCredits":0.191,"afterCompact":false},{"index":198,"time":"22:51","ratio":0.388862,"inputTokens":77772,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.244,"originalCredits":0.244,"afterCompact":false},{"index":199,"time":"22:52","ratio":0.389924,"inputTokens":77985,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.191,"originalCredits":0.191,"afterCompact":false},{"index":200,"time":"22:52","ratio":0.391119,"inputTokens":78224,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.264,"originalCredits":0.264,"afterCompact":false},{"index":201,"time":"22:52","ratio":0.392363,"inputTokens":78473,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.192,"originalCredits":0.192,"afterCompact":false},{"index":202,"time":"22:52","ratio":0.393123,"inputTokens":78625,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.226,"originalCredits":0.226,"afterCompact":false},{"index":203,"time":"22:52","ratio":0.394038,"inputTokens":78808,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.305,"originalCredits":0.305,"afterCompact":false},{"index":204,"time":"22:52","ratio":0.396196,"inputTokens":79239,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.206,"originalCredits":0.206,"afterCompact":false},{"index":205,"time":"22:52","ratio":0.398127,"inputTokens":79625,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.312,"originalCredits":0.312,"afterCompact":false},{"index":206,"time":"22:52","ratio":0.399766,"inputTokens":79953,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.262,"originalCredits":0.262,"afterCompact":false},{"index":207,"time":"22:53","ratio":0.401144,"inputTokens":80229,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.201,"originalCredits":0.201,"afterCompact":false},{"index":208,"time":"22:53","ratio":0.401805,"inputTokens":80361,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.203,"originalCredits":0.203,"afterCompact":false},{"index":209,"time":"22:53","ratio":0.402445,"inputTokens":80489,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.209,"originalCredits":0.209,"afterCompact":false},{"index":210,"time":"22:53","ratio":0.403138,"inputTokens":80628,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.225,"originalCredits":0.225,"afterCompact":false},{"index":211,"time":"22:53","ratio":0.404026,"inputTokens":80805,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.214,"originalCredits":0.214,"afterCompact":false},{"index":212,"time":"22:53","ratio":0.404819,"inputTokens":80964,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.238,"originalCredits":0.238,"afterCompact":false},{"index":213,"time":"22:53","ratio":0.405844,"inputTokens":81169,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.242,"originalCredits":0.242,"afterCompact":false},{"index":214,"time":"22:53","ratio":0.407097,"inputTokens":81419,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.241,"originalCredits":0.241,"afterCompact":false},{"index":215,"time":"22:53","ratio":0.408109,"inputTokens":81622,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.232,"originalCredits":0.232,"afterCompact":false},{"index":216,"time":"22:53","ratio":0.409085,"inputTokens":81817,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.227,"originalCredits":0.227,"afterCompact":false},{"index":217,"time":"22:54","ratio":0.410003,"inputTokens":82001,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.238,"originalCredits":0.238,"afterCompact":false},{"index":218,"time":"22:54","ratio":0.411013,"inputTokens":82203,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.227,"originalCredits":0.227,"afterCompact":false},{"index":219,"time":"22:54","ratio":0.41189,"inputTokens":82378,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.202,"originalCredits":0.202,"afterCompact":false},{"index":220,"time":"22:54","ratio":0.413087,"inputTokens":82617,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.236,"originalCredits":0.236,"afterCompact":false},{"index":221,"time":"22:54","ratio":0.413936,"inputTokens":82787,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.203,"originalCredits":0.203,"afterCompact":false},{"index":222,"time":"22:54","ratio":0.415132,"inputTokens":83026,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.242,"originalCredits":0.242,"afterCompact":false},{"index":223,"time":"22:54","ratio":0.416033,"inputTokens":83207,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.202,"originalCredits":0.202,"afterCompact":false},{"index":224,"time":"22:54","ratio":0.417414,"inputTokens":83483,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.242,"originalCredits":0.242,"afterCompact":false},{"index":225,"time":"22:54","ratio":0.418227,"inputTokens":83645,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.221,"originalCredits":0.221,"afterCompact":false},{"index":226,"time":"22:55","ratio":0.419505,"inputTokens":83901,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.253,"originalCredits":0.253,"afterCompact":false},{"index":227,"time":"22:55","ratio":0.421102,"inputTokens":84220,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.268,"originalCredits":0.268,"afterCompact":false},{"index":228,"time":"22:55","ratio":0.422271,"inputTokens":84454,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.234,"originalCredits":0.234,"afterCompact":false},{"index":229,"time":"22:55","ratio":0.423592,"inputTokens":84718,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.275,"originalCredits":0.275,"afterCompact":false},{"index":230,"time":"22:55","ratio":0.425789,"inputTokens":85158,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.327,"originalCredits":0.327,"afterCompact":false},{"index":231,"time":"22:55","ratio":0.427723,"inputTokens":85545,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.243,"originalCredits":0.243,"afterCompact":false},{"index":232,"time":"22:55","ratio":0.429153,"inputTokens":85831,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.337,"originalCredits":0.337,"afterCompact":false},{"index":233,"time":"22:56","ratio":0.431365,"inputTokens":86273,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.235,"originalCredits":0.235,"afterCompact":false},{"index":234,"time":"22:56","ratio":0.432105,"inputTokens":86421,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.239,"originalCredits":0.239,"afterCompact":false},{"index":235,"time":"22:56","ratio":0.433073,"inputTokens":86615,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.218,"originalCredits":0.218,"afterCompact":false},{"index":236,"time":"22:56","ratio":0.433828,"inputTokens":86766,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.223,"originalCredits":0.223,"afterCompact":false},{"index":237,"time":"22:56","ratio":0.434521,"inputTokens":86904,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.217,"originalCredits":0.217,"afterCompact":false},{"index":238,"time":"22:56","ratio":0.435518,"inputTokens":87104,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.238,"originalCredits":0.238,"afterCompact":false},{"index":239,"time":"22:56","ratio":0.436409,"inputTokens":87282,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.303,"originalCredits":0.303,"afterCompact":false},{"index":240,"time":"22:56","ratio":0.438376,"inputTokens":87675,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.226,"originalCredits":0.226,"afterCompact":false},{"index":241,"time":"22:56","ratio":0.439892,"inputTokens":87978,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.277,"originalCredits":0.277,"afterCompact":false},{"index":242,"time":"22:57","ratio":0.441083,"inputTokens":88217,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.225,"originalCredits":0.225,"afterCompact":false},{"index":243,"time":"22:57","ratio":0.441854,"inputTokens":88371,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.257,"originalCredits":0.257,"afterCompact":false},{"index":244,"time":"22:57","ratio":0.442925,"inputTokens":88585,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.219,"originalCredits":0.219,"afterCompact":false},{"index":245,"time":"22:57","ratio":0.443754,"inputTokens":88751,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.242,"originalCredits":0.242,"afterCompact":false},{"index":246,"time":"22:57","ratio":0.444852,"inputTokens":88970,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.256,"originalCredits":0.256,"afterCompact":false},{"index":247,"time":"22:57","ratio":0.445844,"inputTokens":89169,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.264,"originalCredits":0.264,"afterCompact":false},{"index":248,"time":"22:57","ratio":0.447154,"inputTokens":89431,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.324,"originalCredits":0.324,"afterCompact":false},{"index":249,"time":"22:57","ratio":0.449115,"inputTokens":89823,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.257,"originalCredits":0.257,"afterCompact":false},{"index":250,"time":"22:57","ratio":0.450403,"inputTokens":90081,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.334,"originalCredits":0.334,"afterCompact":false},{"index":251,"time":"22:58","ratio":0.454614,"inputTokens":90923,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.407,"originalCredits":0.407,"afterCompact":false},{"index":252,"time":"22:58","ratio":0.45696,"inputTokens":91392,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.234,"originalCredits":0.234,"afterCompact":false},{"index":253,"time":"22:58","ratio":0.457713,"inputTokens":91543,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.251,"originalCredits":0.251,"afterCompact":false},{"index":254,"time":"22:58","ratio":0.458524,"inputTokens":91705,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.231,"originalCredits":0.231,"afterCompact":false},{"index":255,"time":"22:58","ratio":0.459482,"inputTokens":91896,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.299,"originalCredits":0.299,"afterCompact":false},{"index":256,"time":"22:58","ratio":0.460883,"inputTokens":92177,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.238,"originalCredits":0.238,"afterCompact":false},{"index":257,"time":"22:58","ratio":0.461742,"inputTokens":92348,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.229,"originalCredits":0.229,"afterCompact":false},{"index":258,"time":"22:58","ratio":0.462653,"inputTokens":92531,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.28,"originalCredits":0.28,"afterCompact":false},{"index":259,"time":"22:58","ratio":0.463839,"inputTokens":92768,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.234,"originalCredits":0.234,"afterCompact":false},{"index":260,"time":"22:59","ratio":0.464822,"inputTokens":92964,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.245,"originalCredits":0.245,"afterCompact":false},{"index":261,"time":"23:00","ratio":0.466031,"inputTokens":93206,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.247,"originalCredits":0.247,"afterCompact":false},{"index":262,"time":"23:00","ratio":0.467203,"inputTokens":93441,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.25,"originalCredits":0.25,"afterCompact":false},{"index":263,"time":"23:01","ratio":0.468007,"inputTokens":93601,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.233,"originalCredits":0.233,"afterCompact":false},{"index":264,"time":"23:01","ratio":0.468712,"inputTokens":93742,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.249,"originalCredits":0.249,"afterCompact":false},{"index":265,"time":"23:01","ratio":0.469549,"inputTokens":93910,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.226,"originalCredits":0.226,"afterCompact":false},{"index":266,"time":"23:01","ratio":0.470747,"inputTokens":94149,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.279,"originalCredits":0.279,"afterCompact":false},{"index":267,"time":"23:01","ratio":0.472049,"inputTokens":94410,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.285,"originalCredits":0.285,"afterCompact":false},{"index":268,"time":"23:01","ratio":0.474819,"inputTokens":94964,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.28,"originalCredits":0.28,"afterCompact":false},{"index":269,"time":"23:01","ratio":0.475993,"inputTokens":95199,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.259,"originalCredits":0.259,"afterCompact":false},{"index":270,"time":"23:02","ratio":0.477703,"inputTokens":95541,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.369,"originalCredits":0.369,"afterCompact":false},{"index":271,"time":"23:02","ratio":0.479613,"inputTokens":95923,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.245,"originalCredits":0.245,"afterCompact":false},{"index":272,"time":"23:02","ratio":0.480398,"inputTokens":96080,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.384,"originalCredits":0.384,"afterCompact":false},{"index":273,"time":"23:02","ratio":0.4827,"inputTokens":96540,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.368,"originalCredits":0.368,"afterCompact":false},{"index":274,"time":"23:02","ratio":0.484814,"inputTokens":96963,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.253,"originalCredits":0.253,"afterCompact":false},{"index":275,"time":"23:02","ratio":0.48561,"inputTokens":97122,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.396,"originalCredits":0.396,"afterCompact":false},{"index":276,"time":"23:03","ratio":0.48828,"inputTokens":97656,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.276,"originalCredits":0.276,"afterCompact":false},{"index":277,"time":"23:04","ratio":0.489344,"inputTokens":97869,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.293,"originalCredits":0.293,"afterCompact":false},{"index":278,"time":"23:04","ratio":0.490561,"inputTokens":98112,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.265,"originalCredits":0.265,"afterCompact":false},{"index":279,"time":"23:04","ratio":0.491594,"inputTokens":98319,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.266,"originalCredits":0.266,"afterCompact":false},{"index":280,"time":"23:05","ratio":0.492487,"inputTokens":98497,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.282,"originalCredits":0.282,"afterCompact":false},{"index":281,"time":"23:05","ratio":0.493616,"inputTokens":98723,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.295,"originalCredits":0.295,"afterCompact":false},{"index":282,"time":"23:05","ratio":0.494904,"inputTokens":98981,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.424,"originalCredits":0.424,"afterCompact":false},{"index":283,"time":"23:05","ratio":0.497574,"inputTokens":99515,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.296,"originalCredits":0.296,"afterCompact":false},{"index":284,"time":"23:05","ratio":0.498339,"inputTokens":99668,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.273,"originalCredits":0.273,"afterCompact":false},{"index":285,"time":"23:05","ratio":0.499027,"inputTokens":99805,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.352,"originalCredits":0.352,"afterCompact":false},{"index":286,"time":"11:55","ratio":0.509626,"inputTokens":101925,"outputTokens":null,"usageSource":"transcript-ratio","credits":22.056,"originalCredits":22.056,"afterCompact":false},{"index":287,"time":"11:55","ratio":0.510652,"inputTokens":102130,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.504,"originalCredits":0.504,"afterCompact":false},{"index":288,"time":"11:56","ratio":0.511252,"inputTokens":102250,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.499,"originalCredits":0.499,"afterCompact":false},{"index":289,"time":"11:56","ratio":0.511834,"inputTokens":102367,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.553,"originalCredits":0.553,"afterCompact":false},{"index":290,"time":"11:57","ratio":0.51264,"inputTokens":102528,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.494,"originalCredits":0.494,"afterCompact":false},{"index":291,"time":"11:57","ratio":0.51284,"inputTokens":102568,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.559,"originalCredits":0.559,"afterCompact":false},{"index":292,"time":"11:58","ratio":0.513611,"inputTokens":102722,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.495,"originalCredits":0.495,"afterCompact":false},{"index":293,"time":"12:00","ratio":0.5142,"inputTokens":102840,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.307,"originalCredits":0.307,"afterCompact":false},{"index":294,"time":"12:00","ratio":0.515436,"inputTokens":103087,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.29,"originalCredits":0.29,"afterCompact":false},{"index":295,"time":"12:00","ratio":0.516103,"inputTokens":103221,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.318,"originalCredits":0.318,"afterCompact":false},{"index":296,"time":"12:00","ratio":0.517084,"inputTokens":103417,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.246,"originalCredits":0.246,"afterCompact":false},{"index":297,"time":"12:00","ratio":0.517625,"inputTokens":103525,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.292,"originalCredits":0.292,"afterCompact":false},{"index":298,"time":"12:00","ratio":0.518255,"inputTokens":103651,"outputTokens":null,"usageSource":"transcript-ratio","credits":0.292,"originalCredits":0.292,"afterCompact":false}],"identity":{"sumAttributed":18580764,"billedInputTokens":18580764,"absDiff":0,"ok":true},"pluginVersion":"2.7.4","selfCmd":"\"C:\\Users\\13972\\.qoder-cn\\plugins\\cache\\qoder-marketplace\\qoder-credits-inspector\\2.7.4\\bin\\credits-inspector.cmd\" cli","linkHealth":{"matched":0,"requests":298,"coverage":0,"usageSource":"transcript-ratio","breakdown":{"proxy":0,"transcriptTokens":0,"transcriptRatio":298},"logRecords":0,"lastRecordAt":null,"recentRequests":0,"proxyErrors":null,"clientAbort":null,"clientAbortMaxMs":null,"upstreamRejected":null,"aborted":null,"truncated":null,"noUsage":null,"slowestMs":null,"supersededFailure":null},"subagents":{"scanned":false,"dir":null,"probedPaths":["C:\\Users\\13972\\.qoder-cn\\projects\\D--workspace-jh-starrs-rust\\e4c305be-88c7-4178-baac-55e83a09ba12\\subagents","C:\\Users\\13972\\.qoder-cn\\projects\\e4c305be-88c7-4178-baac-55e83a09ba12\\subagents"],"reason":"no-dir","count":0,"items":[],"totals":{"roundTrips":0,"billedInputTokens":0,"credits":0,"originalCredits":0},"combined":{"roundTrips":298,"billedInputTokens":18580764,"credits":87.352,"originalCredits":87.352}},"manual":null,"artifacts":{"report":"report.json","canvas":"A goal has been set. The__e4c305be.canvas.tsx"}} as unknown as Report;

function human(n: number): string {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}

function pct(x: number): string {
  return (x * 100).toFixed(1) + "%";
}

// —— 可用性口径：把 report.availability 翻成人话，并决定某个数字该显示值、「≈」还是「—」——
const AVAIL_LABEL: Record<string, string> = {
  measured: "实测",
  derived: "推导",
  fallback: "回退",
  manual: "手工",
  unavailable: "不可用",
};

const SOURCE_LABEL: Record<string, string> = {
  "desktop-rich": "桌面端富转录",
  "ide-lite": "IDE 端精简转录",
  unknown: "来源未知",
};

function availOf(av: Availability | undefined, key: keyof Availability, dflt: Avail = "measured"): Avail {
  return (av?.[key] as Avail | undefined) ?? dflt;
}

/** 段标题旁的性质标注：实测不标（默认就是实测），其余标出来。 */
function availTag(av: Availability | undefined, key: keyof Availability, dflt: Avail = "measured"): string {
  const v = availOf(av, key, dflt);
  return v === "measured" ? "" : `（${AVAIL_LABEL[v]}）`;
}

/** 不可用的量显示「—」而不是 0：IDE 端的 0 是「读不到」，不是「没发生」。 */
function orDash(
  v: number,
  av: Availability | undefined,
  key: keyof Availability,
  fmt: (n: number) => string = String
): string {
  return availOf(av, key) === "unavailable" ? "—" : fmt(v);
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "read":
      return "读取";
    case "write":
      return "写入";
    case "search":
      return "搜索";
    case "shell":
      return "命令";
    default:
      return "其他";
  }
}

function shortTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function SessionTokensReport() {
  if (!REPORT) {
    return (
      <ReportShell width="wide" ariaLabel="会话 token 消耗截析">
        <Stack gap="component">
          <H1>会话 token 消耗截析</H1>
          <Text tone="secondary">报告数据尚未注入。请在会话中触发一次 Stop 钩子，或运行 CLI 生成 report.json。</Text>
        </Stack>
      </ReportShell>
    );
  }

  const r = REPORT;
  const s = r.session;
  const c = r.context;
  const t = r.totals;
  const av = r.availability;
  const manual = r.manual ?? null;
  const sourceLabel = SOURCE_LABEL[r.source ?? "unknown"] ?? "来源未知";
  // 有没有 usage 决定整份报告是「真值/推导」还是「一律 —」。手工回填的 credits 不算有 usage，
  // 否则下面按 ratio 推导的图表会照画一堆 0。
  const hasUsage = availOf(av, "roundTrips") === "measured";
  const manualCredits = manual?.credits ?? null;

  // 报告里出现的命令一律用数据层注入的插件入口（Windows 上是自带启动器的绝对路径，免装 Node）。
  // 旧报告没有这个字段时回退原写法，不比改动前更差。
  const CLI = r.selfCmd || "node scripts/cli.mjs";

  // credits 覆盖范围：credits 与「计费输入总量」并排放在头部，读者一除就得到单价。
  // 混合会话里 credits 只来自转录路径的那几笔（实测某会话 413 笔里只有 1 笔带 credits），
  // 部分覆盖不说出来 = 把局部真值当全量展示。
  const cov = r.creditsCoverage ?? null;
  const covPartial = !!(cov && !cov.full && cov.roundTrips > 0);
  const covNote = covPartial ? ` · 仅覆盖 ${cov!.trips}/${cov!.roundTrips} 笔往返（占计费输入 ${pct(cov!.tokenShare)}）` : "";

  // 缓存命中：代理记录里一直带着 cachedTokens，此前采集了却从不呈现。
  const cachedMeasured = availOf(av, "cachedTokens") === "measured";
  const cachedText = cachedMeasured
    ? `输入 ${human(t.billedInputTokens)}，其中缓存命中 ${human(t.cachedTokens ?? 0)}（${pct(t.cachedShare ?? 0)}，${t.cachedTrips ?? 0} 笔往返带缓存）——供应商对重复叠加的前缀打折，故按 token 数的节省大于按计费的节省。`
    : "";

  // 代理告警只在「失败记录仍然成立」时才报：status.json 只写不清，陈旧失败会把用户推去改
  // 本来正确的 Base URL，越修越坏；而同一份报告里的 lastRecordAt / matched 是它在跑的硬证据。
  const proxyAlarm = r.proxy?.status && !r.proxy.statusSuperseded ? r.proxy.status : null;
  const proxyAlive = !proxyAlarm && (r.proxy?.logRecords ?? 0) > 0;

  // 官方 UI 一场会话扣费 = 主链 + 子代理，故有子代理时 headline 必须给 combined，否则比 UI 少一截
  const creditScope =
    r.subagents && r.subagents.count > 0
      ? {
          credits: r.subagents.combined.credits,
          note: `主链 ${t.credits} + 子代理 ${r.subagents.totals.credits} · 原始 ${r.subagents.combined.originalCredits}`,
        }
      : { credits: t.credits, note: `原始 ${t.originalCredits}（实测）` };

  const headline: MetricItem[] = [
    {
      label: "计费输入总量",
      value: hasUsage ? human(t.billedInputTokens) : "—",
      description: hasUsage
        ? availOf(av, "tokens") === "measured"
          ? `Σ prompt_tokens（实测真值）${covPartial ? ` · 覆盖全部 ${cov!.roundTrips} 笔往返` : ""}`
          : `Σ 上下文 × 往返${availTag(av, "tokens", "derived")}${covPartial ? ` · 覆盖全部 ${cov!.roundTrips} 笔往返` : ""}`
        : "转录无 usage",
    },
    {
      label: "当前上下文",
      value: hasUsage ? human(t.netContextTokens) : "—",
      description: hasUsage
        ? `峰值 ${pct(c.peakContextRatio)}${s.compactions ? "（压缩后起算）" : ""}`
        : "转录无 usage",
    },
    {
      label: "重发放大",
      value: hasUsage ? `${t.amplification}×` : "—",
      description: `往返 ${hasUsage ? `${s.roundTrips} 次` : "—"}`,
    },
    {
      label: "Credits",
      // 代理路径（自定义模型）token 是实测真值但 credits 无来源：hasUsage 为真也要显示「—」，
      // 否则 t.credits=0 会被读成「这次没花钱」。
      value:
        manualCredits != null
          ? `${manualCredits}`
          : hasUsage && availOf(av, "credits") !== "unavailable"
            ? `${creditScope.credits}`
            : "—",
      description:
        manualCredits != null
          ? `官方 UI 手工录入 · 本地 ${creditScope.credits}`
          : hasUsage && availOf(av, "credits") !== "unavailable"
            ? `${creditScope.note}${covNote}`
            : r.usageSource === "proxy" || r.usageSource === "transcript-tokens" || r.usageSource === "mixed"
              ? "自定义模型（BYOK）不经 Qoder 计费网关，无 credits 真值"
              : hasUsage
                ? "转录带 usage 但没有 credits 字段，本地无计费真值"
                : "本地不可用，见下方告警",
    },
  ];

  const pieData = r.byCategory.map((x) => ({ label: x.label, value: x.tokens }));

  // 系统提示词是报告里少数「用户能直接动」的一项：它每轮被完整重发，总量 = 每请求规模 × 往返数，
  // 而它的大小由装了多少插件与技能决定。占比小时不必啰嗦。
  const sysCat = r.byCategory.find((x) => x.key === "system");
  const sysNote =
    hasUsage && sysCat && sysCat.share >= 0.1
      ? ` 系统提示词占 ${pct(sysCat.share)}（${human(c.systemPromptTokens)}/请求 × ${s.roundTrips} 次往返 = ${human(sysCat.tokens)}）：它每轮都被完整重发，大小由你装了多少插件与技能决定，精简技能能直接压低这一项——本插件自己的技能描述也常驻在里面（约 170 token）。`
      : "";

  const tools = r.byTool.slice(0, 8);
  const toolCategories = tools.map((x) => x.tool);
  const toolSeries = [{ name: "重发 tokens", data: tools.map((x) => x.tokens) }];
  // 「单次」= 平均每次调用带来的重发 token。总量榜会埋掉次数少但每次极贵的工具：
  // 实测 Read 只 29 次却吃 335 万，单次是 Edit 的 2.6 倍。
  const toolRows = tools.map((x) => [
    x.tool,
    human(x.tokens),
    pct(x.share),
    String(x.calls),
    x.perCall == null ? "—" : human(x.perCall),
  ]);

  const files = r.byFile.slice(0, 20);
  const fileRows = files.map((f) => [
    f.label,
    kindLabel(f.kind),
    human(f.billed),
    pct(f.share),
    f.perRead == null ? "—" : human(f.perRead),
    String(f.trips),
    String(f.reads),
  ]);

  const byReq = r.byRequest ?? [];
  const reqLabels = byReq.map((x, i) => x.time || `#${x.index ?? i + 1}`);
  const reqInputs = byReq.map((x) => x.inputTokens);
  const reqCredits = byReq.map((x) => x.credits);
  // credits 只在覆盖全部往返时才画曲线：部分覆盖（BYOK 混合会话实测 413 笔里 1 笔有 credits）
  // 画出来是一地零，既读不出形状，还会暗示「其余往返没花钱」。
  const showCreditsChart = hasUsage && !covPartial && availOf(av, "credits") !== "unavailable";

  // 按类别下钻：类别小计行（accent/neutral）+ 其工具/文件明细行（default），用 rowTone 分组着色。
  const catDetail = r.byCategoryDetail ?? [];
  const detailRows: string[][] = [];
  const detailTones: ("accent" | "neutral" | "default")[] = [];
  for (const cc of catDetail) {
    const hasKids = cc.children.length > 0;
    detailRows.push([cc.label, "—", hasKids ? "小计" : "（整体，无工具/文件归属）", human(cc.tokens), pct(cc.share), "100%", "—"]);
    detailTones.push(hasKids ? "accent" : "neutral");
    for (const k of cc.children) {
      detailRows.push(["", k.tool || "—", k.label, human(k.tokens), pct(k.share), pct(k.catShare), String(k.trips)]);
      detailTones.push("default");
    }
  }

  // 子代理账：Agent 派发的子代理消耗不在主链里，单独一段呈现（无子代理则整段不渲染）。
  const sub = r.subagents;
  const subItems = sub?.items ?? [];
  const subRows: string[][] = [];
  const subTones: ("accent" | "default")[] = [];
  for (const a of subItems) {
    subRows.push([
      a.description || a.agentId,
      a.agentType || "—",
      String(a.roundTrips),
      human(a.billedInputTokens),
      pct(a.peakContextRatio),
      String(a.credits),
      String(a.originalCredits),
      a.error || "—",
    ]);
    subTones.push("default");
  }
  if (sub && subItems.length > 0) {
    subRows.push([
      "合计（主链 + 子代理）",
      "—",
      String(sub.combined.roundTrips),
      human(sub.combined.billedInputTokens),
      "—",
      String(sub.combined.credits),
      String(sub.combined.originalCredits),
      `主链 ${t.credits} / 子代理 ${sub.totals.credits}`,
    ]);
    subTones.push("accent");
  }

  // 压缩单笔成本：输入/摘要一律取数据层归一后的生效值（有代理实测就是实测，否则是客户端自估），
  // 并用「口径」列把两者分开——混着显示会让自估值被当成实测。
  const ccost = r.compactionCost;
  const ccItems = ccost?.items ?? [];
  const compactRows: string[][] = ccItems.map((e) => [
    `#${e.index}`,
    shortTime(e.at),
    e.trigger || "—",
    e.effectiveInputTokens == null ? "—" : human(e.effectiveInputTokens),
    e.effectiveOutputTokens == null ? "—" : human(e.effectiveOutputTokens),
    e.nextInputTokens == null ? "—" : human(e.nextInputTokens),
    e.savedTokens == null ? "—" : human(e.savedTokens),
    e.proxy && e.proxy.ms != null ? `${Math.round(e.proxy.ms / 1000)}s` : "—",
    e.proxy ? "实测" : "自估",
  ]);

  // IDE 端仅剩的真值：工具调用次数与文件读取次数（不依赖 usage，两种转录都写 tool_use 块）。
  const residueRows: string[][] = [];
  if (!hasUsage) {
    for (const x of r.byTool.filter((v) => v.calls > 0).sort((a, b) => b.calls - a.calls).slice(0, 15)) {
      residueRows.push([x.tool, "工具", String(x.calls), "—", "—"]);
    }
    for (const f of r.byFile.filter((v) => v.reads > 0).sort((a, b) => b.reads - a.reads).slice(0, 15)) {
      residueRows.push([f.label, kindLabel(f.kind), "—", String(f.reads), String(f.trips)]);
    }
  }

  // A1 三值：一次带 usage 的往返都没有时 0 <= max(2,0) 恒成立，会把「没数据」判成「校验通过」，
  // 故 breakdown.mjs 在 reqCount===0 时给 null；这里必须显示「不适用」而不是绿色通过。
  const identityText =
    r.identity.ok == null
      ? "恒等式 A1 不适用（本转录没有一次带 usage 的往返）。"
      : r.identity.ok
        ? `归因覆盖 ${pct(t.coverage)}${availTag(av, "categoryShare", "derived")}，恒等式 A1 通过（|Δ|=${r.identity.absDiff}）。`
        : `归因覆盖 ${pct(t.coverage)}，恒等式 A1 未通过（|Δ|=${r.identity.absDiff}）。`;
  // 窗口读不到时是静默回退的 200000，而所有 token 数字都乘它 —— 必须显式标 ≈ 与来源。
  const cwIsFallback = availOf(av, "contextWindow") === "fallback";
  const cwText = cwIsFallback ? `≈${human(c.contextWindow)}（回退值）` : human(c.contextWindow);
  // 当前占用头条：以最新上下文（currentContextTokens）为准；段内单调递增 ⇒ 旧版峰值与当前恒等，故合并为一条。
  const curCtx = c.currentContextTokens ?? c.peakContextTokens;
  const netAdv = c.netUserAdvice || c.peakUserAdvice || c.peakAdvice || null;
  const limitSrcLabel =
    c.userContextLimitSource === "manual" ? "手工"
    : c.userContextLimitSource === "config" ? "配置"
    : c.userContextLimitSource === "derived" ? "实测反推"
    : "默认";
  // 阈值来源非 manual/config/derived ⇒ 用的是内置兜底 200K，不是用户在 Qoder 设的真值，需显式提示如何改。
  const limitIsDefault = c.userContextLimitSource !== "manual" && c.userContextLimitSource !== "config" && c.userContextLimitSource !== "derived";
  // 上下文对比表：把旧版挤成一段小字的「界面显示 / 自动压缩实况 / 历史高点」拆成可扫读的行，无数据不占位。
  const ctxRows: string[][] = [];
  if (c.userContextLimit != null && Number.isFinite(c.contextWindow)) {
    ctxRows.push(
      c.contextWindow > c.userContextLimit
        ? ["Qoder 界面进度条", pct(c.netWindowRatio ?? c.peakContextRatio), `按模型物理窗口 ${cwText} 算，比你真实占比低约 ${(c.contextWindow / c.userContextLimit).toFixed(1)} 倍——界面显得偏空、有迷惑性，别信它`]
        : ["Qoder 界面进度条", pct(c.netWindowRatio ?? c.peakContextRatio), `按模型窗口 ${cwText} 算，与你实设上限一致，显示无偏差`],
    );
  }
  if (c.observedAutoCompactions != null && c.observedAutoCompactions > 0 && c.observedAutoTriggerTokens != null) {
    ctxRows.push(["自动压缩实况", `自动 ${c.observedAutoCompactions} 次`, `触发点在 ~${human(c.observedAutoTriggerTokens)}（窗口的 ${pct(c.autoTriggerRatio ?? 0)}）`]);
  } else if (s.compactions > 0) {
    ctxRows.push(["压缩实况", `手动 ${s.compactions} 次`, "本场未见自动压缩，均为你手动触发"]);
  }
  if (c.peakSessionNotable) {
    ctxRows.push(["压缩前历史高点", `${pct(c.peakSessionRatio ?? 0)}（${human(c.peakSessionTokens ?? 0)}）`, "本场曾达到的最高占用"]);
  }

  // 链路健康度：把 --request-log 的逐笔归因压成一行结论（明细属于排障，留在 CLI）。
  // 分两档：本会话确实走在代理链路上（proxy/mixed）才印「最近 N 笔」的失败统计与排障命令；
  // token 全来自转录的会话里，那些统计说的是别的会话，印成 warning + 命令是噪音，只留覆盖率与最近记录时间。
  // 纯官方模型用户从没配过代理，整行不渲染。
  const lhRaw = r.linkHealth ?? null;
  const lh = lhRaw && (r.proxy?.configured || lhRaw.matched > 0) ? lhRaw : null;
  const lhOnPath = !!lh && (lh.matched > 0 || lh.usageSource === "proxy" || lh.usageSource === "mixed");
  const lhErrors = lh ? lh.proxyErrors ?? 0 : 0;
  const lhBad = lhOnPath && lhErrors > 0;
  const lhTone: "info" | "warning" = lhBad ? "warning" : "info";
  // 三档拆分一行说清：代理实测 / 转录 input_tokens / 转录 ratio×window 各多少笔。
  // 旧报告（v3）无 breakdown 字段时退回到只报 matched。
  const lhBd = lh?.breakdown ?? null;
  const lhBdText = lhBd
    ? `拆分：代理 ${lhBd.proxy} 笔 · 转录 input_tokens ${lhBd.transcriptTokens} 笔 · 转录 ratio×窗口 ${lhBd.transcriptRatio} 笔`
    : "";
  const lhSrcNote = !lh
    ? ""
    : lh.usageSource === "proxy"
      ? "：全部为供应商实测"
      : lh.usageSource === "transcript-tokens"
        ? "：本会话 token 全来自转录 input_tokens（BYOK，代理未在链路上）"
        : lh.usageSource === "transcript-ratio"
          ? "：本会话 token 由 ratio×窗口推导（官方模型）"
          : lh.usageSource === "mixed"
            ? "：多源混合，以下拆分列为准"
            : lh.usageSource === "transcript"
              ? "：本会话 token 全部来自转录，代理不在链路上"
              : "";
  const lhText = !lh
    ? ""
    : [
        lh.requests > 0
          ? `代理覆盖 ${lh.matched}/${lh.requests} 笔往返（${pct(lh.coverage)}）${lhSrcNote}`
          : "本会话没有带 usage 的往返，代理无从覆盖",
        lhBdText,
        lh.lastRecordAt ? `代理最近记录 ${shortTime(lh.lastRecordAt)}` : proxyAlive ? "代理有记录但无时间戳" : "代理从未记到流量",
        lhOnPath && lh.recentRequests
          ? `最近 ${lh.recentRequests} 笔：代理失败 ${lh.proxyErrors} · 上游报错 ${lh.upstreamRejected} · 客户端提前断开 ${lh.aborted} · 成功但无 usage ${lh.noUsage}${
              lh.slowestMs != null ? ` · 最慢 ${Math.round(lh.slowestMs / 1000)}s` : ""
            }`
          : lhOnPath
            ? "请求诊断日志为空（运行中的代理是旧版，或还没记到）"
            : "",
        lhBad ? `有「代理失败」= 请求没出得去或代理自己抛了，跑 ${CLI} --request-log 看归因` : "",
        !lhOnPath && lhErrors > 0 ? `代理另有 ${lhErrors} 笔失败，属于走代理的那些会话` : "",
        lh.supersededFailure
          ? `${shortTime(lh.supersededFailure.at ?? null)} 那条「拉起失败（${lh.supersededFailure.error}）」已被之后的流量推翻，无需处理`
          : "",
      ]
        .filter(Boolean)
        .join("。") + "。";

  return (
    <ReportShell width="wide" ariaLabel="会话 token 消耗截析">
      <Stack gap="sectionCompact">
        <header>
          <Stack gap="component">
            <H1>会话 token 消耗截析</H1>
            <Text tone="secondary">
              {s.model || "未知模型"}
              {s.modelSource === "manual" ? "（手工录入）" : ""} · {sourceLabel} · 会话{" "}
              {String(s.id || "").slice(0, 8)}
              {s.title ? `「${s.title}」` : ""} · {shortTime(s.startedAt)} →{" "}
              {shortTime(s.endedAt)} · 压缩{" "}
              {availOf(av, "compactions") === "unavailable" ? "—" : `${s.compactions} 次`}
              {r.usageSource ? ` · usage 来源 ${
                r.usageSource === "proxy"
                  ? "代理实测"
                  : r.usageSource === "transcript-tokens"
                    ? "转录 input_tokens"
                    : r.usageSource === "transcript-ratio"
                      ? "转录 ratio×窗口"
                      : r.usageSource === "mixed"
                        ? "多源混合"
                        : "转录"
              }` : ""}
              {r.pluginVersion ? ` · v${r.pluginVersion}` : ""} · schema v{r.schemaVersion}
            </Text>
            <MetricsGrid variant="header" columns={4} items={headline} />
          </Stack>
        </header>

        {!hasUsage && r.source === "desktop-rich" && (
          <Callout tone="danger" title="本报告数值不可用：自定义模型（BYOK）不经 Qoder 计费网关">
            转录是桌面端富布局，但 assistant entry 里没有 message.usage——自定义模型（如千问
            tokenplan）的响应不经 Qoder 计费网关，credits / context_usage_ratio 无来源，提供商返回的
            usage 客户端也不落盘（已实测扫过 ~/.qoder-cn、~/.qoder、~/.qoder-cli 与 %APPDATA%\QoderCN）。
            本地补救（改一个配置文件即可，免装 Node、之后全自动）：编辑 {"`~/.qoder-credits-proxy/config.json`"}，
            把 {"`upstream`"} 填成你的供应商根地址（= Base URL 去掉结尾 /v1），再把自定义模型 Base URL 的 host:port
            换成 {`127.0.0.1:${r.proxy?.port ?? 49787}`}（路径保留），新开一个会话即自动拉起代理、按 message.id
            精确 join 出实测 token（credits 仍无真值）。装了 Node 也可用 {"`--setup-proxy`"} / {"`--check-proxy`"} 一步到位。
            手工回填通道同样可用：
            {"`.qoder-credits/overrides/<sessionId>.json`"}。
          </Callout>
        )}

        {!hasUsage && r.source !== "desktop-rich" && (
          <Callout tone="danger" title="本报告数值不可用：转录不含 message.usage">
            这是 {sourceLabel}（IDE 端客户端）。它的转录只写 session_meta / user / assistant / progress 四种 entry，
            message.usage 整个字段不存在，也不落到本地任何其它文件（已实测扫过 ~/.qoder-cn、~/.qoder、
            ~/.qoder-cli 与 %APPDATA%\QoderCN）。因此 Credits、token 与各类占比一律显示「—」而不是 0 ——
            0 会被误读成「这次没花钱」。真值只有官方 UI 有：把它填进{" "}
            {"`.qoder-credits/overrides/<sessionId>.json`"} 后重跑，上方会出现「官方 UI 真值」一段并与本地并列对账。
          </Callout>
        )}

        {manual && (
          <Callout tone="success" title="官方 UI 真值（手工录入，未覆盖任何本地数字）">
            Credits {manual.credits ?? "—"} · 原价 {manual.originalCredits ?? "—"}
            {manual.model ? ` · 模型 ${manual.model}` : ""}
            {manual.durationMin != null ? ` · 时长 ${manual.durationMin} min` : ""}
            {manual.startedAt ? ` · ${shortTime(manual.startedAt)}` : ""}
            {manual.localCoverage != null
              ? ` · 本地${manual.localScope === "combined" ? "合计（主链+子代理）" : "主链"} ${manual.localCredits ?? t.credits}，覆盖 ${pct(manual.localCoverage)}`
              : " · 本地无 usage，无法对账"}
            {manual.note ? `。备注：${manual.note}` : ""}
          </Callout>
        )}

        {sub && sub.count === 0 && sub.reason && sub.reason !== "no-dir" && (
          <Callout tone="warning" title={`子代理账未汇总（${sub.reason}）`}>
            探测过的候选目录：{(sub.probedPaths ?? []).join("  |  ") || "（无）"}
          </Callout>
        )}

        {proxyAlarm && (
          <Callout tone="warning" title={`代理自动启动失败（${proxyAlarm.error}）`}>
            {proxyAlarm.error === "EADDRINUSE"
              ? `端口 ${proxyAlarm.port ?? "—"} 被占用，自定义模型将无法对话。请换一个空闲端口重启代理：${CLI} --setup-proxy --port <新端口>，并把模型 Base URL 改成新端口。`
              : `代理未就绪（${proxyAlarm.error}），自定义模型可能无法对话。请运行 ${CLI} --check-proxy 查看链路状态。`}
          </Callout>
        )}

        {r.proxy?.dormant && !proxyAlarm && (
          <Callout tone="info" title="代理长期空闲">
            代理已配置但超过 14 天没有记录到流量（可能你已改回官方模型）。如不再使用自定义模型，可运行{" "}
            {CLI} --stop-proxy 停用代理；保留也不影响官方模型。
          </Callout>
        )}

        {cwIsFallback && (
          <Callout tone="warning" title="上下文窗口为回退值 200K（未从 runtime-config / usage 反推 / ManualTruth 拿到真值）">
            本会话所有以窗口为分母的占比与「峰值建议」都可能偏大，而绝对 token 数（已改以 S 真值为底）不受影响。
            建议在 {"`.qoder-credits/overrides/<sessionId>.json`"} 里手工填 {"`contextWindow`"}（如 qwen3-max=1000000），或等一笔带 input_tokens+ratio 的往返写入转录后自动反推生效。
          </Callout>
        )}

        {hasUsage && netAdv && c.userContextLimit != null && (
          <Stack gap="component">
            <Callout
              tone={netAdv.tone}
              title={`你真实的上下文占用 ${pct(c.netUserRatio ?? c.peakUserRatio ?? 0)}（${human(curCtx)} / 阈值 ${human(c.userContextLimit)}・${limitSrcLabel}）`}
            >
              {netAdv.text}
              {limitIsDefault && (
                <Text tone="secondary">
                  {` ⚙ 这里的 ${human(c.userContextLimit)} 是插件内置默认值，不是你在 Qoder「模型管理」里设的真实上限（插件读不到那个设置）。想按真实阈值算：在 ~/.qoder-credits-proxy/config.json 填 "userContextLimit": <你的上限>（对所有会话生效），或对本会话在 .qoder-credits/overrides/<会话id>.json 填同名字段，重跑报告即生效。`}
                </Text>
              )}
            </Callout>
            {ctxRows.length > 0 && (
              <Table
                headers={["对比口径", "数值", "说明"]}
                rows={ctxRows}
                density="compact"
              />
            )}
          </Stack>
        )}

        {c.thresholdNotEnforced && (
          <Callout tone="warning" title="⚠ 自动压缩不会在你设的阈值触发（本条最重要）">
            你的模型物理窗口是 {cwText}，Qoder 的自动压缩要等上下文涨到窗口 ~85%（≈{human(Math.round(c.contextWindow * 0.85))}）才触发；
            你在模型管理里设的 {human(c.userContextLimit)} 上限远在其下，永远不会触发自动压缩。
            请照上面「你真实的上下文占用」那条，到点自己手动压缩，别等它自动压。
          </Callout>
        )}

        {lh && (
          <Callout tone={lhTone} title="链路健康度">
            {lhText}
          </Callout>
        )}

        <Callout tone="info" title="度量口径">
          计费输入总量逐笔锁定真值（优先级：代理 promptTokens &gt; 转录 usage.input_tokens &gt; ratio{availTag(av, "contextRatio")} × {cwText}
          {cwIsFallback ? "，未拿到真窗口、全部 token 数字随之带 ≈" : ""}）；各类别/文件按块估算规模比例分摊
          {availTag(av, "categoryShare", "derived")}。{identityText}
          {cachedText ? ` ${cachedText}` : ""}
          {covPartial
            ? ` Credits 只来自 ${cov!.trips}/${cov!.roundTrips} 笔往返（占计费输入 ${pct(cov!.tokenShare)}），其余往返走代理实测、不经 Qoder 计费，故不要拿 Credits 去除以计费输入总量算单价。`
            : ""}
        </Callout>

        {byReq.length > 0 && (
          <ReportSection
            title="逐请求明细（每一次往返）"
            description={
              showCreditsChart
                ? "每个 round-trip 的真实输入规模与 credits；曲线骤降处为上下文压缩重置（顶部四项为会话累计，此处为每一次）"
                : `每个 round-trip 的真实输入规模；曲线骤降处为上下文压缩重置。credits 曲线未画：本会话只有 ${cov?.trips ?? 0}/${cov?.roundTrips ?? byReq.length} 笔往返带 credits（其余走代理实测、不经 Qoder 计费），画出来是一地零。`
            }
            meta={`${byReq.length} 次往返 · 压缩 ${orDash(s.compactions, av, "compactions")} 次`}
            divided
          >
            {showCreditsChart ? (
              <ChartComparisonGrid>
                <ChartContainer title="每次输入 tokens" ariaLabel="每次输入 tokens">
                  <LineChart
                    categories={reqLabels}
                    series={[{ name: "输入 tokens", data: reqInputs, tone: "info" }]}
                    height={220}
                    valueFormatter={human}
                    ariaLabel="每次请求输入 tokens"
                  />
                </ChartContainer>
                <ChartContainer title="每次 credits" ariaLabel="每次 credits">
                  <LineChart
                    categories={reqLabels}
                    series={[{ name: "credits", data: reqCredits, tone: "warning" }]}
                    height={220}
                    ariaLabel="每次请求 credits"
                  />
                </ChartContainer>
              </ChartComparisonGrid>
            ) : (
              <ChartContainer title="每次输入 tokens" ariaLabel="每次输入 tokens">
                <LineChart
                  categories={reqLabels}
                  series={[{ name: "输入 tokens", data: reqInputs, tone: "info" }]}
                  height={220}
                  valueFormatter={human}
                  ariaLabel="每次请求输入 tokens"
                />
              </ChartContainer>
            )}
          </ReportSection>
        )}

        {hasUsage && ccItems.length > 0 && (
          <ReportSection
            title="压缩单笔成本（会话里最贵的那几笔调用）"
            description="每次压缩本身就是一笔普通模型调用：整份上下文当 prompt 进去、摘要当 completion 出来。此前报告只显示「压缩 N 次」，把单笔最贵的开销藏成了一个计数。「省下」= 压缩前规模 − 压缩后首轮实测输入（地板）。口径列：实测=能在代理日志里唯一对上的供应商真值；自估=客户端在压缩边界里写的前后规模。"
            meta={`${ccItems.length} 次 · 输入累计 ${human(ccost?.totals.preTokens ?? 0)} · 摘要累计 ${human(ccost?.totals.postTokens ?? 0)} · 累计省下 ${human(ccost?.totals.savedTokens ?? 0)} · 其中 ${ccost?.totals.measured ?? 0} 笔为供应商实测`}
            divided
          >
            <Table
              headers={["第几次", "时刻", "触发", "输入", "摘要输出", "压缩后首轮", "省下", "耗时", "口径"]}
              rows={compactRows}
              density="compact"
              stickyHeader
            />
          </ReportSection>
        )}

        {sub && subItems.length > 0 && (
          <ReportSection
            title="子代理账（Agent 派发）"
            description="子代理的每次往返只写进它自己的独立转录，不计入上方主链任何数字；官方 UI 的一场会话扣费 = 主链 + 各子代理。"
            meta={`${subItems.length} 个子代理 · 主链 ${t.credits} + 子代理 ${sub.totals.credits} = 合计 ${sub.combined.credits} Credits`}
            divided
          >
            <Table
              headers={["子代理", "类型", "往返", "计费输入", "峰值占比", "Credits", "原价", "备注"]}
              rows={subRows}
              rowTone={subTones}
              density="compact"
              stickyHeader
            />
          </ReportSection>
        )}

        {hasUsage && r.byCategory.length > 0 && (
          <ReportSection
            title="按类别占比"
            description={`会话计费输入 token 在各来源间的分布（完整划分，占比之和 = 100%）${sysNote}`}
            meta={human(t.billedInputTokens) + ` tokens${availTag(av, "categoryShare", "derived")}`}
            divided
          >
            <ChartContainer ariaLabel="按类别占比">
              <PieChart donut data={pieData} centerLabel="计费输入" valueFormatter={human} />
            </ChartContainer>
          </ReportSection>
        )}

        {hasUsage && catDetail.length > 0 && (
          <ReportSection
            title="按类别下钻（工具 / 文件路径）"
            description="每个类别的消耗再拆到工具与具体文件/路径：工具返回、工具调用可精确到路径，其余类别为整体（无文件归属）。数值均为重发计费 token。"
            meta={`占总额=占计费输入总量 · 占本类=占该类别 · 程数=存活往返累计${availTag(av, "fileShare", "derived")}`}
            divided
          >
            <Table
              headers={["类别", "工具", "文件 / 路径", "重发 tokens", "占总额", "占本类", "程数"]}
              rows={detailRows}
              rowTone={detailTones}
              density="compact"
              stickyHeader
            />
          </ReportSection>
        )}

        {hasUsage && tools.length > 0 && (
          <ReportSection
            title="按工具占比"
            description="各工具相关内容（调用参数 + 返回）重发累计的计费 token 占比（仅工具相关块，非完整划分，占比之和 < 100%）。「单次」= 平均每次调用带来的重发 token：总量榜会把「次数少但每次极贵」的工具埋掉，这一列专门把它捞出来。"
            meta={`token 占比${availTag(av, "toolShare", "derived")} · 调用次数为实测`}
            divided
          >
            <Stack gap="component">
              <ChartContainer ariaLabel="按工具占比">
                <BarChart horizontal categories={toolCategories} series={toolSeries} valueFormatter={human} ariaLabel="按工具占比" />
              </ChartContainer>
              <Table
                headers={["工具", "重发 tokens", "占比", "调用", "单次"]}
                rows={toolRows}
                density="compact"
                stickyHeader
              />
            </Stack>
          </ReportSection>
        )}

        {hasUsage && fileRows.length > 0 && (
          <ReportSection
            title="按文件占比"
            description="精确到路径/文件名：内容随上下文被重复发送累计的计费 token 占比（Top 20，仅可归因文件的块）。「单次读取」= 这个文件平均每次被读取最终烧掉多少（含此后每一程的重发）——读一次就烧掉十几万的文件，在按总量排序的榜上毫不起眼。"
            meta={`程数=存活往返累计 · 读取=返回次数（实测）${availTag(av, "fileShare", "derived")}`}
            divided
          >
            <Table
              headers={["文件", "种类", "重发 tokens", "占比", "单次读取", "程数", "读取"]}
              rows={fileRows}
              density="compact"
              stickyHeader
            />
          </ReportSection>
        )}

        {!hasUsage && residueRows.length > 0 && (
          <ReportSection
            title="工具调用与文件读取（计数为实测）"
            description="占比与 token 一律不可用，但 tool_use 块两种转录都写，所以「谁被调了几次、谁被读了几次」仍是真值 —— IDE 端不是一无所有。"
            meta={`${t.toolCalls ?? 0} 次工具调用${availTag(av, "toolCalls")} · ${t.fileReads ?? 0} 次文件读取${availTag(av, "fileReads")} · ${s.turns} 轮对话`}
            divided
          >
            <Table
              headers={["工具 / 文件", "种类", "调用", "读取", "程数"]}
              rows={residueRows}
              density="compact"
              stickyHeader
            />
          </ReportSection>
        )}
      </Stack>
    </ReportShell>
  );
}
