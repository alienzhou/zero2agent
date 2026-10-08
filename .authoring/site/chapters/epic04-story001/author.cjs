// Editable E04-S001 diagrams. Facts are traceable through sources.md.
// Every page chooses a visual form for its teaching task; no generic card stack.
const fs = require('node:fs');
const C = {ink:'#202622',paper:'#F4F1EA',muted:'#596057',line:'#C9CDC2',white:'#FFFEF9',soft:'#E7EADF',green:'#28614D',greenBg:'#E0EBDF',red:'#B53830',redBg:'#F2DED7',amber:'#896016',amberBg:'#F0E5C9'};
const esc = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const t = (x,y,s,size=32,color=C.ink,weight=400,anchor='start',mono=false) => `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" ${mono?'class="mono"':''}>${esc(s)}</text>`;
const ls = (x,y,ss,size=30,color=C.ink,gap=48) => ss.map((s,i)=>t(x,y+i*gap,s,size,color)).join('');
const rect = (x,y,w,h,fill=C.white,stroke='none',radius=0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
const path = (d,tone='ink',arrow=false,dash=false) => `<path d="${d}" fill="none" stroke="${C[tone]}" stroke-width="3" stroke-linecap="round" ${arrow?`marker-end="url(#${tone})"`:''} ${dash?'stroke-dasharray="9 8"':''}/>`;
const dot = (x,y,r=7,tone='ink') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${C[tone]}"/>`;
const rule = (y,x=0,w=952) => path(`M${x} ${y}h${w}`,'line');
const tag = (x,y,w,s,tone='ink') => rect(x,y,w,48,C[tone+'Bg']||C.soft)+t(x+15,y+33,s,26,C[tone],650);
const consoleBox = (x,y,w,h,title,rows,size=29) => rect(x,y,w,h,C.ink,'none',10)+t(x+24,y+43,title,25,'#AEBFAF',500)+path(`M${x+24} ${y+62}h${w-48}`,'muted')+rows.map((s,i)=>t(x+24,y+108+i*49,s,size,C.paper,400,'start',true)).join('');
const file = (x,y,w,h,title,rows,tone='green') => `<path d="M${x} ${y}h${w-44}l44 44v${h-44}h-${w}Z" fill="${C.white}" stroke="${C[tone]}" stroke-width="3"/><path d="M${x+w-44} ${y}v44h44" fill="none" stroke="${C[tone]}" stroke-width="2"/>`+t(x+22,y+87,title,30,C[tone],700)+ls(x+22,y+149,rows,29,C.ink,45);
const svg = (label,body,h=780) => `<svg class="diagram" viewBox="0 0 952 ${h}" width="952" height="${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><defs>${['ink','green','red','amber'].map(k=>`<marker id="${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="${C[k]}"/></marker>`).join('')}</defs>${body}</svg>`;
const pages=[];
const page=(slug,section,title,deck,body,note,sources,layout='')=>pages.push({file:`${String(pages.length+1).padStart(2,'0')}-${slug}.html`,section,title,deck,body,note,sources,layout});

page('cover','失败恢复与运行预算','失败后，怎样继续？','E04-S001 · 文件已经改了，Agent 还能安全继续吗？',svg('失败恢复教学示意：文件写入已完成，下一模型请求失败；只恢复传输，保留已有文件效果',
consoleBox(0,8,952,185,'一次任务，在第二次模型请求处中断',['✓ write_file(effect.txt)','✗ 下一请求：HTTP 500'])+
path('M180 220V282H390','green',true)+path('M756 220V285','red',true)+
file(0,315,445,235,'effect.txt',['WRITTEN-ONCE','已完成效果留住'])+
t(555,342,'500 → 等待 → 再请求',33,C.red,700)+t(555,405,'恢复这一段传输',31,C.ink)+t(555,460,'不要从头重做任务',31,C.ink)+
rule(592)+t(0,643,'学会三件事',27,C.muted,650)+t(0,705,'分清失败位置 · 限制运行成本 · 验证真实效果',32,C.ink,650),740),
'图为教学示意。完整跟练使用本地故障服务、生产 CLI 和真实文件，不需要模型密钥。',['S01','S02','S03','D01']);

page('written-before-failure','01 · 故障现场','文件写好了，\n500 出现在下一步','先沿时间线定位失败，再决定从哪里继续。',svg('离线夹具的四次HTTP与一次文件Checkpoint时间线，写入发生在第一模型回复之后，500发生在后续请求',
t(0,45,'实际请求与本地效果，是两条不同的线',32,C.ink,700)+
t(0,130,'模型请求',27,C.muted,650)+path('M150 166H918','ink',true)+
[[190,'#1','tool_use','green'],[420,'#2','500','red'],[650,'#3','500','red'],[880,'#4','完成','green']].map(([x,a,b,c])=>dot(x,166,10,c)+t(x,123,a,30,C[c],700,'middle')+t(x,231,b,29,C[c],650,'middle')).join('')+
tag(344,279,390,'恢复的是 #2 开始的模型传输','red')+
path('M190 183V387','green',true)+t(0,382,'文件效果',27,C.muted,650)+
file(140,418,345,235,'effect.txt',['WRITTEN-ONCE','Checkpoint × 1'])+
path('M502 520H906','green',true)+t(534,475,'效果一直保留',31,C.green,700)+ls(534,583,['后续发送视图继续携带','这条工具调用与结果。'],30)+
rule(704)+t(0,753,'实测：4 次 HTTP / 1 次文件写入 / 1 条 Checkpoint',31,C.ink,650)),
'这些数量来自离线故障演示。核对文件字节、Checkpoint 和发送历史，不能用模型的一句“写好了”代替验收。',['T01','D01']);

page('three-failures','02 · 恢复边界','选错恢复位置，\n就可能重复副作用','同样是“失败”，继续的动作却不一样。',svg('分叉比较传输恢复保留既有工具结果，与从头重做可能重复副作用；下方区分三种失败位置',
t(0,45,'已经完成写入 → 后续模型请求失败',36,C.ink,700)+path('M476 82V128H227V165','red',true)+path('M476 128H725V165','green',true)+
rect(0,185,454,232,C.redBg)+t(26,239,'从头重做整段任务',34,C.red,700)+ls(26,303,['再次执行写入、发信或提交…','已发生的效果可能又发生一次。'],29)+
rect(498,185,454,232,C.greenBg)+t(524,239,'重发当前模型请求',34,C.green,700)+ls(524,303,['沿用已有工具调用与结果。','本地执行器不重放旧工具。'],29)+
rule(474)+
[[535,'请求失败','执行器有限重发','green'],[619,'工具失败','错误回给模型，修正后新调用','amber'],[703,'整轮耗尽','停止启动新工作，等待结算','red']].map(([y,a,b,c])=>dot(10,y-10,6,c)+t(35,y,a,31,C[c],700)+t(255,y,b,30)).join(''),760),
'左侧是错误恢复策略的风险示例，并非旧版本实测。重发请求可能让远端重新计算；本地不重放工具，不代表只计费一次。',['S01','S02','S03']);

page('error-matrix','03 · 错误分类','看到失败，\n先看状态与异常类型','连接失败可以恢复；错误的密钥不会被重试修好。',svg('三列错误决策表：观察到的失败、动作和理由；鉴权上下文和取消分别处理',
rect(0,0,952,65,C.ink)+t(24,44,'观察到什么',29,C.paper,650)+t(350,44,'动作',29,C.paper,650)+t(587,44,'为什么',29,C.paper,650)+
[[136,['408 / 429 / 5xx','连接失败 / 超时'],'有限重试',['可能是暂时故障'],'green'],[296,['可识别的 SSE 中断','服务端流式错误'],'有限重试',['还没有完整模型回复'],'green'],[456,['401 / 403','参数、协议等拒绝'],'交还调用者',['重发不解决配置问题'],'red'],[616,['确认是上下文超限'],'E03 缩减',['缩减仍消耗请求额度'],'amber']].map(([y,a,b,d,c])=>ls(24,y,a,28,C.ink,44)+tag(332,y-32,210,b,c)+ls(583,y,d,28,C.ink,44)+rule(y+89)).join('')+
t(0,760,'服务明确禁止重试、用户取消、预算耗尽 → 停止',30,C.red,650)),
'本课保守停止 409。完整状态表、SDK 类型和服务等待头放在跟练；鉴权报文即使写着“prompt too long”，也不能误判为上下文超限。',['R01','S02','T01']);

page('one-retry-owner','04 · 实现一处重试','外层重试 × SDK 重试，\n次数会相乘','让 Harness 拥有策略，SDK 每次只负责一次传输。',svg('假设两层各允许两次重试，三乘三等于最多九次；改为SDK关闭重试后由Harness控制三个attempt',
t(0,42,'假设：两层各允许重试 2 次',29,C.muted)+
[[170,'外层 1'],[300,'外层 2'],[430,'外层 3']].map(([y,s])=>t(0,y,s,31,C.red,700)+[290,430,570].map(x=>dot(x,y-10,18,'red')).join('')+t(653,y,'SDK × 3',30,C.muted)).join('')+
t(812,327,'9',90,C.red,700)+t(889,327,'次',30,C.red,650)+
rule(485)+consoleBox(0,520,952,119,'SDK 选项 · 生产实现',['maxRetries: 0'],31)+
path('M95 711H850','green',true)+[130,455,780].map((x,i)=>dot(x,711,12,'green')+t(x,770,`attempt ${i+1}`,29,C.green,650,'middle')).join(''),800),
'9 次是说明乘法的假设，不是旧版 HTTP 实测。模型、摘要、provider 计数共用执行器；实际每次传输都计数和记录。',['R01','S02','S04']);

page('attempt-identity','05 · 从日志找回过程','逻辑请求没变，\n每次传输各有身份','把一次恢复串起来，再检查有没有缺失的终态。',svg('逻辑请求L下有三次attempt，分别是请求A B C，日志记录错误等待和完成；区别尝试数和用量',
rect(0,0,952,110,C.soft)+t(24,44,'logicalRequestId = L',34,C.ink,700)+t(24,87,'model · 相同发送视图 · 一个逻辑请求',28,C.muted)+
path('M30 149V558H76','ink')+t(76,169,'attempt',26,C.muted,650)+t(290,169,'requestId',26,C.muted,650)+t(530,169,'终态',26,C.muted,650)+t(763,169,'等待',26,C.muted,650)+
[[262,'1','A','error · 500','1ms','red'],[380,'2','B','error · 500','1ms','red'],[498,'3','C','completed','—','green']].map(([y,a,b,d,e,c])=>t(110,y,a,46,C[c],700)+t(321,y,b,35,C.ink,650)+t(522,y,d,30,C[c],650)+t(767,y,e,30,C.muted)+rule(y+36,76,876)).join('')+
rect(0,619,8,123,C.red)+t(31,658,'请求次数 ≠ 已知 token 用量',34,C.ink,700)+ls(31,710,['失败尝试没有 usage 时，不能把成本填成 0。'],29,C.muted),770),
'UUID 用 L/A/B/C 缩写，等待取自离线演示设置，属于日志教学重排。诊断只保留身份、状态、用量等元信息，不存 prompt 或工具正文。',['S05','D01','T02']);

page('backoff','06 · 等待策略','等多久，\n也要有明确上限','退避能缓解瞬时故障，但不能让一次任务无限等下去。',svg('默认抖动退避两次等待与服务RetryAfter超过剩余整轮预算时停止的时间比较',
t(0,45,'默认：最多再试 2 次',32,C.ink,700)+
[100,420,880].map((x,i)=>dot(x,161,12,i<2?'red':'green')+t(x,108,`请求 ${i+1}`,29,C.ink,650,'middle')).join('')+path('M122 161H395','amber',true)+path('M443 161H855','amber',true)+
t(249,227,'375–500ms',29,C.amber,650,'middle')+t(652,227,'750–1000ms',29,C.amber,650,'middle')+
t(0,319,'示意时序，不按毫秒比例绘制',26,C.muted)+rule(356)+
t(0,417,'如果服务要求 Retry-After: 30s',34,C.ink,700)+
t(0,496,'服务等待',28,C.muted)+rect(180,462,710,47,C.amberBg)+t(862,495,'30s',28,C.amber,650,'end')+
t(0,577,'整轮剩余',28,C.muted)+rect(180,542,237,47,C.redBg)+t(394,575,'10s',28,C.red,650,'end')+
path('M417 600V641','red',true)+t(180,690,'停止恢复，不在 10s 后提前请求',34,C.red,700)+t(180,751,'允许等待也受 maxRetryDelayMs 约束。',29,C.muted)),
'默认抖动系数为 0.75–1。支持秒、HTTP 日期与 retry-after-ms；等待期间可取消。服务指定时长超过允许上限或剩余整轮时间时停止。',['S02','T01']);

page('timeouts','07 · 两层时钟','建立连接，\n不代表请求已经结束','时限必须覆盖整段 SSE；整轮还包含工具与审批。',svg('嵌套时限刻度：Turn默认十分钟包含模型请求工具审批，单次请求默认两分钟覆盖连接响应和流式正文，摘要计数目的限制30秒',
t(0,60,'Turn · 默认 10 分钟',40,C.ink,700)+
rect(0,87,952,452,C.soft)+t(25,137,'从用户提交开始计时',28,C.muted)+
rect(25,180,576,292,C.greenBg)+t(49,232,'请求 · 默认 2 分钟',34,C.green,700)+
path('M65 319H550','green',true)+[[80,'连接'],[244,'响应头'],[478,'SSE 正文']].map(([x,s])=>dot(x,319,8,'green')+t(x,377,s,27,C.green,650,'middle')).join('')+
t(49,436,'超时 → signal 关闭真实传输',28,C.ink)+
t(648,255,'审批等待',31,C.ink,650)+t(648,322,'工具执行',31,C.ink,650)+t(648,409,'也占整轮时间',29,C.muted)+
rule(593)+t(0,654,'实际允许时间 = 更短的时限',35,C.ink,700)+ls(0,714,['剩余整轮时间 / 请求时限 / 目的时限','计数与摘要保留 E03 的 30 秒逻辑限制。'],29,C.muted,46)),
'大小只表达包含关系，不按真实耗时比例绘制。总时间使用单调时钟；请求的可取消传输与任意 JS 工具的结算方式不同。',['S01','S02','S04']);

page('cancel-wait','08 · 在 TUI 中接管','等待恢复时，\n你仍然可以取消','取消要关闭等待与传输，清理完成后恢复输入。',
'<figure class="runtime-shot" data-block><pre>'+esc(fs.readFileSync(__dirname+'/../../../../researches/failure-recovery/acceptance/screens/02b-backoff-course.txt','utf8').split('\n').map(line=>line.trimEnd()).join('\n').trimEnd())+'</pre></figure>'+svg('实际画面下方的取消操作路径：CtrlC取消当前轮，等待清理完成，再发送新的用户请求',
path('M115 55H827','ink',true)+[115,470,827].map((x,i)=>dot(x,55,10,['amber','red','green'][i])).join('')+
t(115,126,'Ctrl-C',31,C.red,700,'middle')+t(470,126,'本轮已取消',31,C.ink,650,'middle')+t(827,126,'新 Turn',31,C.green,650,'middle'),165),
'上方是去除行末空白的真实 PTY 屏幕文字，54列×14行；截图与无损原始字节见跟练。故障由本地服务注入。测试同时核对：取消不再请求，清理后新一轮成功。',['T02','T03','S06']);

page('stream-end','09 · 流结束的提交边界','参数看起来完整，\n工具也不能马上执行','显示草稿、提交会话、执行工具，是三个不同动作。',svg('SSE文本参数片段暂存为草稿，完整message_stop后检查stop_reason才可授权执行，缺少终态断流则标记草稿不执行',
consoleBox(0,0,952,255,'SSE · 可以故意制造的半截流',['text_delta: "准备写文件…"','input_json_delta: {"path":"effect.txt"}','连接断开；没有 message_stop'],29)+
path('M240 286V336','green',true)+path('M715 286V336','red',true)+
t(18,397,'完整回复的路径',34,C.green,700)+t(516,397,'缺少结束的路径',34,C.red,700)+
rect(0,432,454,183,C.greenBg)+ls(24,482,['message_stop 已观察到','stop_reason == tool_use','再次授权 → 执行 → 配对结果'],28,C.ink,48)+
rect(498,432,454,183,C.redBg)+ls(522,482,['标记：未完成草稿','不提交正式 assistant 历史','工具执行次数 = 0'],28,C.ink,48)+
rule(669)+t(0,725,'if (!stopped) throw new IncompleteStreamError()',28,C.ink,600,'start',true),770),
'顶部是教学流片段；完整路径是另一个可能结果。测试故意发送表面完整的参数后断流，确认文件未写、历史不收半截。',['S03','T01']);

page('tool-correction','10 · 工具错误回给模型','失败参数不重放，\n修正参数才是新调用','传输执行器不替模型猜怎样修工具输入。',svg('模型与自定义工具交替对话：bad参数错误与原ID配对，fixed参数重新授权后成功；新输入是新调用',
tag(0,0,200,'模型的新调用','ink')+tag(699,0,253,'工具的真实回执','ink')+
rect(0,91,619,104,C.soft)+t(23,154,'probe({ value: "bad" })',31,C.ink,600,'start',true)+path('M651 143H903V224','red',true)+
rect(286,244,666,137,C.redBg)+t(310,293,'tool_use_id: 原调用 ID',27,C.red,650)+t(310,348,'Error: invalid value',31,C.ink,500,'start',true)+path('M264 313H45V420','amber',true)+
rect(0,437,619,104,C.greenBg)+t(23,500,'probe({ value: "fixed" })',31,C.green,600,'start',true)+path('M651 489H903V583','green',true)+
t(321,637,'重新授权 → 执行成功',34,C.green,700)+
rule(701)+t(0,758,'变化的是输入；保留的是第一次失败事实。',31,C.ink,650)),
'probe 是故障测试中的自定义工具。受保护的写入操作仍通过 Checkpoint；同工具同输入持续失败到阈值时停止，不无限问模型。',['S03','T01']);

page('approval','11 · 拒绝也有终点','拒绝一次，\n不该反复弹窗求批准','同一 Turn 记住拒绝，替代方案仍重新判断权限。',svg('一次操作拒绝后，同工具同参数再次提出会停止repeated-denial不再次审批，不同输入的替代操作重新走权限流程',
`<polygon points="86,30 217,30 280,93 280,224 217,287 86,287 23,224 23,93" fill="${C.red}"/>`+t(151,143,'拒绝',55,C.paper,700,'middle')+t(151,204,'一次',32,C.paper,650,'middle')+
t(334,99,'不执行 write_file',38,C.ink,700)+ls(334,168,['错误结果与原调用配对。','拒绝不会变成授权，也不捕获文件。'],29,C.muted,53)+
rule(339)+
t(0,418,'又提出同工具 + 同参数',33,C.red,700)+path('M470 405H655','red',true)+t(682,418,'停止本轮',33,C.red,700)+t(0,474,'repeated-denial · 不再打开相同审批',29,C.muted)+
rule(530)+t(0,603,'提出不同的替代操作',33,C.green,700)+path('M440 590H627','green',true)+t(651,603,'重新授权',33,C.green,700)+
t(0,658,'不同参数不代表默认允许，更不能绕过硬边界。',30,C.muted)+
t(0,759,'下一条明确用户请求，建立新的 Turn 预算。',30,C.ink,650)),
'失败签名只在本轮内存保留哈希，不是跨会话永久授权或禁用。一般审批与人工终端接管继续使用各自的控制接口。',['S01','S03','T01']);

page('budgets','12 · 为本轮设置边界','四种消耗，\n分别计数','实际请求次数、工具次数和推理迭代不能混为一谈。',svg('默认预算仪表：20推理迭代100实际请求64工具调用600000毫秒；每项启动前扣额度，相同失败三次停',
[[0,0,'20','推理迭代','模型与工具的循环','重试不另算迭代','ink'],[502,0,'100','实际请求','model + summary + count','每个 attempt 都扣额度','green'],[0,341,'64','工具调用','被拒和未知调用也计入','开始前判断能否执行','amber'],[502,341,'600000','整轮毫秒','从本轮开始计时','等待与审批也在其中','red']].map(([x,y,n,a,b,d,c])=>t(x,y+132,n,n.length>4?64:100,C[c],700)+t(x,y+215,a,33,C.ink,700)+path(`M${x} ${y+242}h450`,c)+ls(x,y+285,[b,d],28,C.muted,43)).join('')+
rule(684)+t(0,734,'相同失败默认 3 次后停；新 Turn 重新建预算。',30,C.ink,650)),
'上面是默认上限，不是某次运行的用量。启动操作前消耗额度，失败后的恢复也受剩余时间和次数限制；允许配置有界整数。',['S01','S02','S05']);

page('batch-pairing','13 · 批次结算','只剩一个工具额度，\n三个调用怎样收尾？','执行不了，也要明确回执，不能留下悬空调用。',svg('工具额度为1的一组三调用回执单，A执行并保留文件效果，B C明确未执行但三条结果与三调用配对',
tag(0,0,316,'maxToolCalls = 1','ink')+
rect(0,97,952,65,C.ink)+t(24,141,'tool_use',29,C.paper,650)+t(254,141,'是否执行',29,C.paper,650)+t(487,141,'配对 tool_result',29,C.paper,650)+
[[252,'A','✓ 执行','写入完成 · 保留效果','green'],[396,'B','— 未执行','工具额度耗尽','red'],[540,'C','— 未执行','停止后续工作','red']].map(([y,a,b,d,c])=>t(26,y,a,52,C.ink,700)+t(254,y,b,32,C[c],650)+path(`M419 ${y-10}h45`,c,true)+t(487,y,d,30,C[c],600)+rule(y+50)).join('')+
t(0,676,'3 条调用 → 3 条结果',43,C.ink,700)+t(0,746,'配对完成后，才向上报告 RunBudgetError。',31,C.muted)),
'测试用真实文件核对 A 已发生的效果，同时检查 B/C 的“未执行”回执。不能因为整轮失败，就把整个批次都解释成没有发生。',['S03','T01']);

page('native-outcomes','14 · 不从展示文字猜成功','命令没写 Error:，\n退出 7 仍然是失败','原生接口给出事实，stdout 只负责展示。',svg('真实终端命令退出7，metadata terminalOutcome completed但exitCode7为工具失败，相同命令两次后停止，calls.txt两行',
consoleBox(0,0,952,211,'生产 terminal · 真实进程',['printf "run\\n" >> calls.txt; exit 7','stdout: 空；进程确实写入了一行'],28)+
path('M150 241V280H445','ink',true)+t(485,292,'原生元信息',31,C.ink,700)+
t(0,361,'terminalOutcome',28,C.muted,500,'start',true)+t(391,361,'completed',30,C.ink,600,'start',true)+t(684,361,'进程已结算',27,C.muted)+
t(0,433,'exitCode',28,C.muted,500,'start',true)+t(391,433,'7',44,C.red,700)+t(684,433,'工具结果为错误',27,C.red,650)+
rule(486)+t(0,550,'把相同失败阈值设成 2',33,C.ink,700)+
file(0,589,340,180,'calls.txt',['run · run'])+
t(397,625,'两次真实执行，各写入一行。',30,C.ink)+t(397,687,'第二次失败后停，不执行第三次。',30,C.red,650)+t(397,749,'不能把错误结果当成效果回滚。',29,C.muted),810),
'次数与文件来自真实 CLI/进程测试。失败判定使用 onResultMetadata 的退出码与终态，诊断不采集命令正文或 stdout。',['S03','T02','S05']);

page('settlement','15 · 停止与结算','时间到达，\n也不能假装工具没写入','取消是请求；不配合 signal 的工具可能稍后才结束。',svg('工具开始到预算到达再到实际写入结束的横向时序，下方宿主一直持有输入至结算，之后新Turn可开始',
t(0,44,'一个故意忽略 signal 的测试工具',31,C.ink,700)+
path('M92 174H901','ink',true)+[[105,'开始','ink'],[416,'预算到达','red'],[823,'工具结束','green']].map(([x,s,c])=>dot(x,174,12,c)+t(x,128,s,29,C[c],650,'middle')).join('')+
path('M416 200V253','red',true)+t(214,308,'发送取消；停止启动后续工作',32,C.red,700)+
path('M823 200V348','green',true)+file(561,374,363,231,'late.txt',['真实写入发生了','结果保留，不假装回滚'])+
rect(0,424,476,130,C.amberBg)+t(24,470,'输入仍被当前 run 占用',32,C.amber,700)+t(24,521,'新 run 此时仍会被拒绝。',29,C.ink)+
rule(650)+path('M35 712H906','ink',true)+rect(37,685,712,53,C.soft)+t(63,722,'等待真正结算',30,C.ink,650)+t(790,776,'新 Turn',29,C.green,650),810),
'这是顺序示意，不按测试毫秒比例绘制。测试核对真实晚到文件、未结算时拒绝新 run、结算后新 Turn 成功；任意 JS 不能保证硬终止。',['S01','S03','T01']);

page('configuration','16 · 配置与追查','把运行限制写清，\n再用日志核对','flag 覆盖环境默认值；四种 CLI 入口共享策略。',svg('CLI三项限制配置与日志attempt解析，坏参数发请求前拒绝，日志只读查看不重放',
consoleBox(0,0,952,257,'一次命令 · 也适用于 --plain / 管道 / TUI',['--max-retries 2','--max-tool-calls 8','--request-timeout-ms 30000'],31)+
t(0,322,'配置的检查发生在执行前',33,C.ink,700)+t(0,377,'非法值 → 拒绝启动 → HTTP 请求数为 0',30,C.red,650)+
rule(424)+consoleBox(0,467,952,186,'/logs → Enter → /log · 只读查看',['logical=L · req=C · attempt=3','wait=1ms · errorKind=http'],29)+
path('M118 668V699','ink',true)+path('M619 668V699','green',true)+t(0,752,'找同一逻辑请求',30,C.ink,650)+t(506,752,'核对实际尝试与等待',30,C.green,650)),
'这里是当前字段的教学重排，UUID 已缩写。完整九项 flag 与环境变量见跟练；读取日志不触发任何模型请求或工具重放。',['S05','S06','T02']);

page('practice','17 · 亲手制造故障','先预测结果，\n再运行一次故障实验','生产 CLI + 本地故障服务，不需要模型密钥。',svg('练习单：运行离线脚本，预测写入后500会有几次HTTP和文件效果；预测鉴权失败请求次数；带TUI取消并核对新Turn',
consoleBox(0,0,952,184,'在工程根目录',['pnpm build','node scripts/e04-s001-recovery-demo.mjs'],27)+
[[250,'01','写入后，下一请求连续两次 500','预测：HTTP 几次？文件写几次？'],[407,'02','把故障换成 401 鉴权失败','预测：同一逻辑请求会重发吗？'],[564,'03','加 --tui，在 20s 等待中 Ctrl-C','核对：没有后续请求，新 Turn 能完成。']].map(([y,n,a,b])=>t(0,y,n,49,C.red,700)+t(95,y,a,31,C.ink,650)+t(95,y+61,b,29,C.muted)+rule(y+100)).join('')+
t(0,755,'对照：01 为 4 次 HTTP / 1 次写入；02 为 1 次请求。',29,C.green,650)),
'脚本退出自动清理临时目录。下一课 E04-S002 解决大工具结果按需读取：本课限制恢复与运行消耗，下一课减少每次请求带入的正文。',['D01','T01','T02']);

if(pages.length!==18) throw new Error('E04-S001 must contain exactly 18 pages including its cover');
for (const [i,p] of pages.entries()) {
 const number=String(i+1).padStart(2,'0');
 const header=`<header class="page-header"><span>Zero2Agent · ${esc(p.section)}</span><span class="page-number">${number}</span></header>`;
 const heading=`<div class="heading" data-block><h1>${esc(p.title).replaceAll('\n','<br>')}</h1><p class="deck" data-prose>${esc(p.deck)}</p></div>`;
 const content=`<div class="content">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div>`;
 const cover=`<div class="cover-frame"><header class="page-header"><span>Zero2Agent · 健壮性与上下文</span><span class="page-number">E04-S001</span></header><div class="series-masthead" data-block><h1 class="series-title">从零到一做 <span>Agent</span></h1><p class="series-description" data-prose>亲手实现 Coding Agent · 开源实战课程</p><h2 class="lesson-title">失败恢复与运行预算</h2><p class="lesson-promise" data-prose>文件已经改了，Agent 还能安全继续吗？</p></div><div class="series-body">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div><div class="cover-tags"><span>故障实验</span><span>实现拆解</span><span>开源课程</span></div></div>`;
 fs.writeFileSync(p.file,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080"><title>${esc(p.title.replaceAll('\n',''))}</title><link rel="stylesheet" href="course.css"></head><body><main class="sheet ${i===0?'cover series-cover':''} ${p.layout}" data-page="${number}">${i===0?cover:header+heading+content}</main></body></html>\n`);
}
fs.writeFileSync('pages.json',JSON.stringify({title:'Zero2Agent · E04-S001 失败恢复与运行预算',date:'2026-10-08',draft:false,publicationStatus:'unpublished',width:1080,height:1440,maxImages:18,edition:'v2-case-and-lab',pages:pages.map((p,i)=>({file:p.file,title:p.title.replaceAll('\n',''),number:i+1,sources:p.sources}))},null,2)+'\n');
