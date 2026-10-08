// E04-S001 editable teaching diagrams. Run through pnpm site:build.
const fs = require('node:fs');
const C={ink:'#202622',paper:'#F4F1EA',muted:'#596057',line:'#C9CDC2',white:'#FFFEF9',soft:'#E7EADF',green:'#28614D',greenBg:'#E0EBDF',red:'#B53830',redBg:'#F2DED7',amber:'#896016',amberBg:'#F0E5C9'};
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const t=(x,y,s,size=34,color=C.ink,weight=400,anchor='start',mono=false)=>`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" ${mono?'class="mono"':''}>${esc(s)}</text>`;
const ls=(x,y,ss,size=32,color=C.ink,gap=50)=>ss.map((s,i)=>t(x,y+i*gap,s,size,color)).join('');
const box=(x,y,w,h,tone='ink')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${C[tone+'Bg']??C.white}" stroke="${C[tone]}" stroke-width="2"/>`;
const line=(d,tone='ink',arrow=true)=>`<path d="${d}" fill="none" stroke="${C[tone]}" stroke-width="3.5" stroke-linecap="round" ${arrow?`marker-end="url(#${tone})"`:''}/>`;
const card=(x,y,w,h,title,rows,tone='ink',size=31)=>box(x,y,w,h,tone)+t(x+24,y+51,title,36,C[tone],700)+ls(x+24,y+108,rows,size,C.ink,50);
const terminal=(x,y,w,h,rows)=>box(x,y,w,h,'ink')+`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${C.ink}"/>`+rows.map((s,i)=>t(x+24,y+55+i*49,s,29,C.paper,400,'start',true)).join('');
const svg=(label,body,h=760)=>`<svg class="diagram" viewBox="0 0 952 ${h}" width="952" height="${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><defs>${Object.entries(C).map(([k,v])=>`<marker id="${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="${v}"/></marker>`).join('')}</defs>${body}</svg>`;
const pages=[];
const page=(slug,section,title,deck,body,note,sources)=>pages.push({file:`${String(pages.length+1).padStart(2,'0')}-${slug}.html`,section,title,deck,body,note,sources});

page('cover','失败恢复与运行预算','失败后，怎样继续？','E04-S001 · 让重试、修正与停止都有边界',svg('请求有限重试，工具修正重新授权，预算耗尽停止新工作；已完成文件效果仍保留',
terminal(0,15,952,150,['Agent › 文件已写入；下一请求失败','你 › 继续，但别重复写文件'])+
[[0,'请求失败',['有限重试','可取消等待'],'green'],[327,'工具失败',['配对错误','新调用授权'],'amber'],[654,'预算耗尽',['停止新工作','等待工具结算'],'red']].map(([x,a,b,c])=>card(x,258,298,226,a,b,c)).join('')+
line('M150 490V545H476V590','green')+line('M476 490V590','amber')+line('M803 490V545H476','red')+
box(48,610,856,120,'green')+t(476,658,'留住已完成结果，核对真实文件效果',36,C.green,700,'middle')+t(476,707,'传输重试不会重放本地工具',31,C.ink,400,'middle'),760),
'图为机制示意。重试可能让远端模型重新计算，不能承诺只计费一次。',['S01','S02','S03']);

page('written-before-failure','从真实问题开始','文件已经改了，\n请求却失败了','继续发送模型请求，不等于把整段任务重做。',svg('第一步写入已结算，第二步请求失败，第三步重发已有发送视图保留工具结果，文件不重写',
card(0,20,952,170,'① 工具已经结算',['effect.txt = WRITTEN-ONCE'],'green')+line('M476 205V255')+
card(0,275,952,170,'② 下一次模型请求返回 500',['工具结果留在历史里，请求没有完整回复。'],'red')+line('M476 460V510','green')+
card(0,530,952,190,'③ 重发同一发送视图',['携带原来的工具结果；文件工具不重放。','离线演示：4 次 HTTP，1 条写入 Checkpoint。'],'green')),
'验收读取真实文件和 Checkpoint 数量，再核对请求里的工具结果；不能只相信模型说“写好了”。',['T01','D01']);

page('three-failures','把失败位置分清','失败发生在哪一层，\n决定由谁继续','模型传输、工具执行与整轮预算各有处理方式。',svg('三条泳道分别表示请求重试、工具配对错误后修正和运行预算停止',
[[25,'模型请求','传输错误 → 有限等待 → 重发请求','green'],[270,'工具执行','错误回执 → 模型修正 → 新调用授权','amber'],[515,'整个 Turn','额度到达 → 停止新工作 → 工具结算','red']].map(([y,a,b,c])=>card(0,y,952,205,a,[b],c)).join('')),
'一次 Turn 是一条用户请求及其模型/工具循环。请求重试不新增推理迭代，但计入实际请求次数。',['S01','S02','S03']);

page('error-matrix','哪些错误可以重试','先分类，\n再决定是否重发','服务错误、鉴权错误和上下文拒绝不能混在一起。',svg('重试、停止和上下文缩减三类错误表',
card(0,15,952,235,'有限传输重试',['408 / 429 / 5xx、连接失败、请求超时','可识别的流式中断；服务禁止重试时停止。'],'green')+
card(0,280,952,230,'交还调用者',['400 / 401 / 403 / 404 / 409 / 413 / 422','协议错误、用户取消、预算耗尽。'],'red')+
card(0,545,952,190,'上下文拒绝另行处理',['沿用 E03 的有限缩减，同样消耗请求额度。'],'amber')),
'分类依据固定 SDK 异常类型、状态和有限 cause 链。本课保守停止 409，不照搬 SDK 的所有重试分支。',['R01','S02','T01']);

page('one-retry-owner','让次数可解释','SDK 也在重试，\n外层再试会发生什么？','由一层拥有传输策略，另一层只执行一次。',svg('内外各重试两次可能得到九次传输，本课关闭SDK重试由Harness控制最多三次',
card(0,20,952,245,'假设两层都重试 2 次',['外层最多 3 次 × SDK 每次最多 3 次','理论最多 9 次传输，不是本项目旧版实测。'],'red')+
line('M476 285V345','green')+card(0,365,952,260,'本课的策略',['SDK maxRetries = 0','Harness：尝试 1 → 尝试 2 → 尝试 3','每次尝试都有独立证据和预算。'],'green')+
t(0,710,'模型、摘要、provider 计数共用执行器。',32,C.muted)),
'固定 npm SDK 0.52.0 默认重试两次；本课显式关闭它。不要由调用函数次数推断原有 SDK 的实际 HTTP 次数。',['R01','S02','S04']);

page('attempt-identity','把重试串起来','同一个逻辑请求，\n每次尝试各有身份','重试后的 requestId 会变，logicalRequestId 保持关联。',svg('逻辑请求L包含三个attempt各有requestId，错误失败和成功独立记录',
card(0,10,952,150,'logicalRequestId = L',['一次有相同发送视图的请求'],'ink')+
[[230,'attempt 1 · req A','500 → error','red'],[390,'attempt 2 · req B','429 → error','amber'],[550,'attempt 3 · req C','完整响应 → completed','green']].map(([y,a,b,c])=>box(35,y,882,128,c)+t(65,y+47,a,34,C[c],700)+t(65,y+101,b,31)).join('')+
line('M476 170V215')+t(0,742,'日志只记录元信息，不存 prompt 或工具正文。',30,C.muted)),
'请求用途 purpose 区分 model、summary、count。错误尝试可能没有用量；缺证据不能填成零成本。',['S05','T02']);

page('backoff','等待不能无界','退避逐步变长，\n仍要服从剩余预算','支持服务等待头；不能把较长等待偷偷缩短。',svg('默认两次等待375到500毫秒和750到1000毫秒，服务RetryAfter超过剩余时间停止',
card(0,20,952,230,'默认指数退避 + 抖动',['第 1 次等待约 375–500ms','第 2 次等待约 750–1000ms'],'green')+
card(0,285,952,190,'服务指定 Retry-After',['支持秒、HTTP 日期与 retry-after-ms。'],'amber')+
card(0,510,952,220,'服务要求 30s，但只剩 10s',['停止这次恢复；不能等 10s 就提前重发。','单次允许等待默认最多 30000ms。'],'red')),
'时间线为默认公式示意。实际等待、尝试数与服务头在真实 HTTP 测试中核对，等待期间可取消。',['S02','T01']);

page('timeouts','区分两种时限','请求时限管响应，\n整轮时限管新工作','建立连接之后，流式正文仍然可能一直不结束。',svg('Turn十分钟预算包含请求两分钟和工具结算，摘要计数仍有30秒逻辑限制',
box(0,20,952,675,'ink')+t(35,83,'Turn 默认 600000ms',39,C.ink,700)+
card(35,130,882,205,'一次请求默认 120000ms',['覆盖连接、等待响应和整段 SSE。','signal 关闭真实传输，不只停止 spinner。'],'green')+
card(35,380,882,180,'工具已开始执行',['时间到达：不启动下一项，等待真实结算。'],'amber')+
t(35,627,'计数/摘要仍保留 E03 默认 30s 逻辑等待。',30,C.muted)+
t(0,747,'更短的目的时限与剩余整轮时间优先。',31,C.muted)),
'总时间使用单调时钟。任意自定义 JS 若不配合 signal，不能保证在指定毫秒内硬终止。',['S01','S02','S04']);

page('cancel-wait','在等待时接管','不想再等，\n就取消这一轮','取消结束请求和等待；清理完成后才恢复输入。',svg('TUI先显示限流等待20秒，CtrlC取消，随后接受新一轮请求',
terminal(0,15,952,185,['模型请求失败 (rate-limit)','20000ms 后进行第 2 次尝试','Ctrl-C 可取消等待。'])+
line('M476 220V290','red')+card(0,310,952,155,'Ctrl-C',['等待被取消，没有发出第二次 HTTP。'],'red')+
line('M476 485V550','green')+terminal(0,570,952,150,['已取消 · 你: continue','新的 Turn 正常完成。'])) ,
'界面为教学重排。真实 PTY 测试核对取消后的请求数、新一轮成功，以及 raw mode/光标/屏幕恢复。',['T02','S06']);

page('stream-end','别把草稿当结果','看到参数，\n还不能执行工具','完整流结束是提交历史和执行工具的前置证据。',svg('文本和参数片段进入草稿，message_stop后检查stop_reason，只有完整tool_use可执行',
card(0,10,952,170,'text / input_json_delta',['先进入显示草稿，不提交正式历史。'],'amber')+
line('M225 195V270','green')+line('M728 195V270','red')+
card(0,290,448,185,'message_stop',['得到完整回复','核对 stop_reason'],'green')+
card(504,290,448,185,'中断 / 缺少结束',['参数看起来完整','仍不能执行'],'red')+
line('M225 490V530','green')+line('M728 490V530','red')+
card(0,550,448,185,'完整 tool_use',['重新授权','执行 + 配对结果'],'green')+
card(504,550,448,185,'有限重发 / 停止',['草稿标记未完成','历史不收半截'],'red')),
'本地 SSE 可发送看起来完整的参数后直接断流；测试证明工具不执行，失败片段不进入正式会话。',['S03','T01']);

page('tool-correction','工具失败怎样继续','错误先交回模型，\n修正是一次新调用','工具执行器不会自动改参数，也不会自动重放。',svg('读取missing失败配对结果返回模型，模型提出新参数fixed重新授权后成功',
card(0,10,952,165,'① probe(value=bad)',['返回 Error: invalid value，与调用 ID 配对。'],'red')+
line('M476 190V240')+card(0,260,952,160,'② 模型收到真实错误结果',['由模型提出 probe(value=fixed)。'],'amber')+
line('M476 435V485','green')+card(0,505,952,215,'③ 新调用重新过执行边界',['再次授权；写入工具再次捕获 Checkpoint。','实测修正参数后成功，原失败记录保留。'],'green')),
'probe 是故障测试的自定义工具，不是新增生产工具。修正改变输入；持续相同失败则会被运行预算停止。',['S03','T01']);

page('approval','拒绝不是网络故障','一次拒绝，\n不能反复弹窗求批准','新的操作继续遵守当前权限，拒绝记录不会升级为授权。',svg('权限拒绝回执保留，再次同工具同参数会停止，不同允许操作仍需重新授权',
card(0,10,952,205,'write_file 的请求被拒绝',['配对为 is_error；不执行，不捕获文件。'],'red')+
line('M250 230V280','red')+line('M710 230V280','green')+
card(0,300,450,275,'同一 Turn 又试原调用',['同工具 + 同参数','停止 repeated-denial','不重新打开审批。'],'red',29)+
card(502,300,450,275,'选择允许的替代操作',['作为新的工具调用','重新判断权限','不能绕过拒绝规则。'],'green',29)+
t(0,695,'下一条明确用户请求开始新的 Turn 和预算。',31,C.muted)),
'失败签名只在本轮内存中保留哈希，不进入日志或会话；它不是跨会话的永久授权或永久禁用规则。',['S01','S03','T01']);

page('budgets','给运行设置边界','一次 Turn，\n分别数四种消耗','不要只用“聊了多少轮”解释成本。',svg('四项默认预算为20迭代100实际请求64工具调用600秒整轮，重试和工具批次分别计数',
[[0,20,'20 次迭代',['模型与工具的循环','传输重试不另算迭代'],'ink'],[502,20,'100 次实际请求',['模型 + 摘要 + 计数','每次尝试都占额度'],'green'],[0,325,'64 次工具调用',['包含被拒和未知工具','副作用不是请求计数'],'amber'],[502,325,'600000ms',['从本轮开始计时','等待与审批也消耗时间'],'red']].map(([x,y,a,b,c])=>card(x,y,450,270,a,b,c,29)).join('')+
t(0,685,'相同工具与参数默认失败 3 次后停止。',32,C.muted)+t(0,742,'每个新 Turn 重新建立预算。',32,C.muted)),
'限制可配置但必须是有界整数。预算正确不等于任务一定成功；实际 token 用量以 SDK 证据为准。',['S01','S05']);

page('batch-pairing','批次也要完整结算','额度在中途耗尽，\n其余调用怎么处理？','未执行也要给结果，不能留下悬空 tool_use。',svg('三个工具调用在额度一时仅执行A，B和C明确未执行，但三个结果仍与调用配对',
t(0,45,'示例：maxToolCalls = 1',34,C.ink,700)+
[[130,'call A','完成写入','green'],[320,'call B','未执行：工具额度耗尽','red'],[510,'call C','未执行：停止后续工作','red']].map(([y,a,b,c])=>box(0,y,300,120,'ink')+t(150,y+71,a,36,C.ink,650,'middle')+line(`M318 ${y+60}H465`,c)+box(487,y,465,120,c)+t(510,y+71,b,31,C[c],650)).join('')+
t(0,728,'三份调用，三份结果；A 的文件效果仍保留。',32,C.muted)),
'配对之后才向上报告预算错误，Session 保留失败事实。未来续跑也不能把 B/C 的未执行推断为 A 没有发生。',['S03','T01']);

page('native-outcomes','发现持续相同失败','命令退出 7，\n即使没有 Error: 也失败','退出结果来自原生接口，展示文字只负责可读。',svg('相同命令退出7两次后在阈值二停止，实际文件只有两行run，失败判定由原生元信息给出',
terminal(0,10,952,175,['printf "run\\n" >> calls.txt; exit 7','terminalOutcome: completed','exitCode: 7 → 工具错误'])+
card(0,225,952,230,'maxRepeatedFailures = 2',['第一次：失败结果保留，模型可修正。','第二次相同失败：停止，不再执行第三次。'],'red')+
card(0,505,952,210,'核对实际效果',['calls.txt 只有两行 run。','command / stdout 不进入诊断日志。'],'green')),
'这是生产 terminal 的真实进程验证。判定使用 onResultMetadata；普通 JS 错误与返回的 Error: 继续以配对结果处理。',['S03','T02','S05']);

page('settlement','停止前要等结算','时间到了，\n为什么还不能立刻再问？','工具可能忽略取消，并在稍后完成写入。',svg('工具开始后到时间预算，保持输入忙直到工具真实结算并记录效果，之后开放新Turn',
[[15,'工具开始执行','signal 交给工具；宿主持有输入。','ink'],[200,'时间预算到达','不启动新工作，发送取消信号。','red'],[385,'工具真实结束','读取并保存实际结果，不假装回滚。','amber'],[570,'开放下一轮输入','新 Turn 有新的预算，已有效果仍在。','green']].map(([y,a,b,c],i)=>card(0,y,952,150,a,[b],c)+(i<3?line(`M476 ${y+160}V${y+175}`,c):'')).join('')),
'时序为机制示意。测试用不配合 signal 的工具证明：前一轮未结算时，新 run 仍拒绝；结算后的真实写入结果保留。',['S01','S03','T01']);

page('configuration','配置与追查','限制改了多少，\n日志里就该看见多少','单次、管道、plain 与 TUI 使用相同策略。',svg('CLI设置重试额度和时限，环境可作为默认，日志显示逻辑请求attempt和等待但无正文',
terminal(0,10,952,230,['--max-retries 2','--max-tool-calls 8','--max-duration-ms 120000','--request-timeout-ms 30000'])+
card(0,285,952,170,'参数覆盖环境变量',['非法值在执行前拒绝；不会先发请求再纠正。'],'green')+
terminal(0,505,952,190,['/logs → Enter → /log','logical=L · req=C · attempt=3','wait=1ms · errorKind=http'])+
t(0,745,'日志查看只读，不触发模型或工具重放。',31,C.muted)),
'命令与日志为当前生产字段的教学重排，UUID 缩写只用于图示。完整参数、环境变量与实际终端操作在跟练中提供。',['S05','S06','T02']);

page('practice','从效果完成跟练','真的制造一次失败，\n再核对怎样继续','无需密钥，跑本地确定性服务和生产 CLI。',
'<div class="terminal" data-block><p class="mini">在工程根目录 · 离线夹具</p><pre>pnpm build\nnode scripts/e04-s001-recovery-demo.mjs</pre></div>'+svg('练习核对实际请求次数文件效果草稿和取消，下一课改进大工具结果按需读取',
[[60,'A 核对请求','3 次恢复；鉴权失败只请求 1 次。'],[210,'B 核对效果','4 次 HTTP，但只有 1 条写入 Checkpoint。'],[360,'C 观察交互','加 --tui：取消等待，区分草稿与结果。']].map(([y,a,b])=>t(0,y,a,35,C.ink,700)+t(0,y+66,b,30,C.muted)).join('')+
t(0,530,'下一课：E04-S002 大工具结果按需读取',31,C.green,650),580),
'脚本退出自动清理临时目录。确定性故障与真实服务分别验收；本课控制失败与运行成本，下一课控制每次请求拿到多少工具正文。',['D01','T01','T02']);

if(pages.length!==18)throw new Error('E04-S001 must contain exactly 18 pages including its cover');
for(const [i,p] of pages.entries()){
 const number=String(i+1).padStart(2,'0');
 const header=`<header class="page-header"><span>Zero2Agent · ${esc(p.section)}</span><span class="page-number">${number}</span></header>`;
 const heading=`<div class="heading" data-block><h1>${esc(p.title).replaceAll('\n','<br>')}</h1><p class="deck" data-prose>${esc(p.deck)}</p></div>`;
 const content=`<div class="content">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div>`;
 const cover=`<div class="cover-frame"><header class="page-header"><span>Zero2Agent · 健壮性与上下文</span><span class="page-number">E04-S001</span></header><div class="series-masthead" data-block><h1 class="series-title">从零到一做 <span>Agent</span></h1><p class="series-description" data-prose>亲手实现 Coding Agent · 开源实战课程</p><h2 class="lesson-title">失败恢复与运行预算</h2><p class="lesson-promise" data-prose>失败能继续，成本有边界</p></div><div class="series-body">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div><div class="cover-tags"><span>有限重试</span><span>真实验收</span><span>开源课程</span></div></div>`;
 fs.writeFileSync(p.file,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080"><title>${esc(p.title.replaceAll('\n',''))}</title><link rel="stylesheet" href="course.css"></head><body><main class="sheet ${i===0?'cover series-cover':''}" data-page="${number}">${i===0?cover:header+heading+content}</main></body></html>\n`);
}
fs.writeFileSync('pages.json',JSON.stringify({title:'Zero2Agent · E04-S001 失败恢复与运行预算',date:'2026-10-08',draft:true,publicationStatus:'unpublished',width:1080,height:1440,maxImages:18,edition:'v1',pages:pages.map((p,i)=>({file:p.file,title:p.title.replaceAll('\n',''),number:i+1,sources:p.sources}))},null,2)+'\n');
