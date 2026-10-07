// E03-S005 editable diagrams. Generated through pnpm site:build; no external assets.
const fs = require('node:fs');
const C = {ink:'#202622',paper:'#F4F1EA',muted:'#596057',line:'#C9CDC2',white:'#FFFEF9',soft:'#E7EADF',green:'#28614D',greenBg:'#E0EBDF',red:'#B53830',redBg:'#F2DED7',amber:'#896016',amberBg:'#F0E5C9'};
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const t=(x,y,s,size=34,color=C.ink,weight=400,anchor='start',mono=false)=>`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" ${mono?'class="mono"':''}>${esc(s)}</text>`;
const ls=(x,y,ss,size=34,color=C.ink,weight=400,anchor='start',gap=50,mono=false)=>ss.map((s,i)=>t(x,y+i*gap,s,size,color,weight,anchor,mono)).join('');
const box=(x,y,w,h,fill=C.white,stroke=C.line,r=12,dash='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2" ${dash?`stroke-dasharray="${dash}"`:''}/>`;
const line=(d,color=C.ink,arrow=false,dash='')=>`<path d="${d}" class="edge" stroke="${color}" ${arrow?`marker-end="url(#${Object.keys(C).find(k=>C[k]===color)||'ink'})"`:''} ${dash?`stroke-dasharray="${dash}"`:''}/>`;
const dot=(x,y,r=10,color=C.red)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;
const ring=(x,y,r=34,fill=C.paper,stroke=C.ink)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`;
const chip=(x,y,w,s,tone='green')=>box(x,y,w,50,C[tone+'Bg'],C[tone],25)+t(x+w/2,y+35,s,28,C[tone],650,'middle');
const num=(x,y,n)=>ring(x,y,24,C.ink,C.ink)+t(x,y+10,n,28,C.paper,700,'middle');
const smallTerminal=(x,y,w,h,content,status='')=>box(x,y,w,h,C.ink,C.ink,12)+dot(x+22,y+22,4,C.red)+dot(x+38,y+22,4,C.amber)+dot(x+54,y+22,4,C.green)+ls(x+24,y+68,content,29,C.paper,400,'start',47,true)+(status?t(x+24,y+h-25,status,26,'#BAC8B8'): '');
const doc=(x,y,w=90,h=118,tone='ink')=>`<path d="M${x} ${y}h${w-22}l22 22v${h-22}h-${w}Z M${x+w-22} ${y}v22h22" fill="${C.white}" stroke="${C[tone]}" stroke-width="3"/>`+line(`M${x+18} ${y+h*.40}h${w-36}M${x+18} ${y+h*.58}h${w-36}M${x+18} ${y+h*.76}h${w-48}`,C[tone]);
const svg=(label,body,h=790)=>`<svg class="diagram" viewBox="0 0 952 ${h}" width="952" height="${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><defs>${Object.entries(C).map(([k,v])=>`<marker id="${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="${v}"/></marker>`).join('')}</defs>${body}</svg>`;
const pages=[];
const page=(file,section,title,deck,body,note,sources,extra='')=>pages.push({file,section,title,deck,body,note,sources,extra});

page('01-cover.html','运行日志与问题追查','出了问题，\n找得到发生了什么','E03-S005 · 为运行过程留下可追查的事实',svg('一轮操作分出两个模型请求，第一个产生工具调用，第二个结束回答，所有记录进入本地日志',
smallTerminal(0,10,952,158,['你 › 创建演示文件','Agent › 文件已写入。'])+
t(0,240,'一轮操作',34,C.ink,700)+chip(197,206,280,'operation 7c…')+
line('M335 268V319H201V355',C.green,true)+line('M335 319H701V355',C.green,true)+
box(0,373,421,132,C.greenBg,C.green)+t(24,422,'request A → tool_use',30,C.green,650)+t(24,471,'write_file · completed',29,C.ink,500)+
box(531,373,421,132)+t(555,422,'request B → end_turn',30,C.ink,650)+t(555,471,'用量 · 耗时 · 结束原因',29,C.muted)+
line('M211 519V576H476V619',C.green,true)+line('M742 519V576H476',C.green)+
doc(200,639,83,109,'green')+t(330,681,'本地 JSONL 日志',41,C.green,700)+t(330,733,'按 ID 追查，不重复执行工具。',30,C.muted)),
'教学示意：记录真实执行边界与元信息，屏幕上消失的状态仍可追查。',['S01','S02'],'cover');

page('02-carriers.html','先分清用途','保存会话、显示状态、\n记录日志各解决什么？','同一个 Agent，需要三种不同的数据载体。',svg('会话快照保存对话与摘要，TUI提供当场控制，运行日志留下请求和结果的元信息',
[[88,'会话快照','原始历史 + 已采用摘要','重启后接着聊','ink'],[337,'TUI 屏幕','当前阶段 + 输入 + 审批','当场观察和控制','green'],[585,'运行日志','身份 + 起止 + 耗时 + 用量','结束以后追查问题','red']].map(([y,a,b,c,tone],i)=>
num(30,y+20,i+1)+t(92,y+25,a,43,C[tone],700)+t(92,y+90,b,32,C.ink)+chip(92,y+132,510,c,tone==='ink'?'green':tone)).join('')),
'运行日志不会恢复旧进程，也不会自动加入模型上下文。对话正文仍遵守上一课的快照规则。',['S01','S03']);

page('03-evidence.html','从疑问到证据','“没有回答”背后，\n可能有不同的事实','先找执行边界，才能判断下一步该检查什么。',svg('四种故障表象各有不同证据：未发请求、HTTP失败、工具退出和断点之后未见结束',
[[45,'请求根本没开始','operation start → 还没有 request'],[215,'请求返回失败','request error → auth / HTTP 401'],[385,'命令执行失败','tool completed → exitCode 7'],[555,'记录在中途结束','只有 start → 结果仍然未知']].map(([y,a,b],i)=>
num(29,y+23,i+1)+t(85,y+35,a,38,C.ink,700)+t(85,y+103,b,29,i===3?C.red:C.green,550)+line(`M85 ${y+142}H952`,C.line)).join('')),
'模型说“已完成”只是回答。验收还要检查实际文件效果、工具结果和请求记录。缺少结束行不能证明工具没有执行。',['T01','T02','S01']);

page('04-identity.html','关联身份','同名工具调用，\n怎样找到它的请求？','关联关系要在调用开始时确定。',svg('进程run包含两个操作，同一个session跨进程；每个operation包含自己的request与相同toolCallId，组合身份可以区分',
t(0,45,'session：跨进程的对话身份',33,C.muted)+box(0,95,952,653,C.white,C.ink)+t(27,149,'run UUID · 本次进程的日志文件',35,C.ink,700)+
[[24,'operation A','request A1'],[508,'operation B','request B1']].map(([x,op,req])=>
box(x,204,420,468,C.soft,C.line)+t(x+25,267,op,35,C.ink,700)+line(`M${x+208} 295V342`,C.green,true)+
box(x+25,360,370,78,C.greenBg,C.green)+t(x+45,410,req,31,C.green,650)+line(`M${x+208} 450V497`,C.green,true)+
box(x+25,516,370,103)+t(x+45,558,'toolCallId: tool_1',27,C.ink,600)+t(x+45,597,'toolName: read_file',26,C.muted)).join('')),
'run + operation + request + toolCallId 共同定位调用。只看工具名或模型给出的 toolCallId，可能把不同轮次混在一起。',['S01','T01']);

page('05-clock.html','顺序和耗时','墙上时钟告诉你时间，\n单调时钟计算耗时','系统校时不能让一次请求出现负的耗时。',svg('左侧壁钟会前后调整，右侧单调时钟持续前进；日志seq表示接受顺序，duration表示单调耗时',
t(0,47,'at · 壁钟时间',36,C.ink,700)+t(532,47,'duration · 单调时间',36,C.green,700)+line('M476 81V669',C.line)+
[[137,'12:00:01'],[283,'11:59:59'],[429,'12:00:03']].map(([y,s])=>ring(90,y,40)+t(168,y+12,s,33,C.ink,600,'start',true)).join('')+
line('M90 187V227',C.red,true)+line('M90 333V373',C.red,true)+t(0,577,'时间可被校正',32,C.red,650)+
line('M610 128V473',C.green,true)+[[148,'0 ms'],[292,'150 ms'],[435,'600 ms']].map(([y,s])=>dot(610,y,9,C.green)+t(658,y+11,s,32,C.green,600)).join('')+
t(534,577,'差值用于请求耗时',32,C.green,650)+box(0,704,952,77,C.soft,C.line)+t(30,755,'seq：单文件接受顺序；不代表跨进程全局顺序。',29,C.ink,600)),
'日志还有 operationSeq，表示该操作内部的诊断顺序。后台事件可以晚于 operation end，不能据此判断序号错误。',['S01','S02']);

page('06-request.html','真实请求边界','一次 SDK 调用，\n记录从开始到结束','首段文本、结束原因和 token 用量各有来源。',svg('请求时间线开始于SDK调用，收到首段文本后计算firstTextMs，结束时记录duration用量或错误分类',
line('M40 192H904',C.green,true)+[[65,'start'],[434,'首段文本'],[827,'completed']].map(([x,s])=>dot(x,192,13,C.green)+t(x,126,s,31,C.ink,650,'middle')).join('')+
line('M65 231V279H434V231',C.green)+t(247,326,'firstTextMs',30,C.green,650,'middle',true)+
line('M65 355V403H827V355',C.ink)+t(448,451,'durationMs',31,C.ink,650,'middle',true)+
box(0,505,447,252,C.greenBg,C.green)+t(26,555,'成功',36,C.green,700)+ls(26,612,['stopReason · 结束原因','input / output / cache','SDK 返回的 token 用量'],28,C.ink,400,'start',48)+
box(505,505,447,252,C.redBg,C.red)+t(531,555,'失败 / 取消',36,C.red,700)+ls(531,612,['errorKind · 错误分类','httpStatus · 若可获得','不保存原始异常正文'],28,C.ink,400,'start',48)),
'这里记录逻辑 SDK 调用，SDK 内部的 HTTP 重试没有逐次 trace。只有 SDK 实际提供时才记录 providerRequestId。',['S01','T01']);

page('07-auxiliary.html','辅助请求也要可见','计数、摘要、主请求，\n都属于真实网络工作','purpose 帮你看懂这次请求为什么发生。',svg('三条泳道分别是count、summary、model，后台摘要跨过当前操作的结束边界仍归属于原操作',
[[107,'count','provider 计数','同步等待'],[327,'summary','真实摘要请求','可在后台完成'],[547,'model','主模型响应','文本 / 工具调用']].map(([y,purpose,a,b])=>
t(0,y,purpose,34,C.ink,700,'start',true)+box(237,y-46,purpose==='summary'?715:purpose==='count'?305:335,119,purpose==='summary'?C.amberBg:C.greenBg,purpose==='summary'?C.amber:C.green)+t(265,y,a,29,C.ink,650)+t(265,y+48,b,27,C.muted)).join('')+
line('M602 47V706',C.red,false,'8 10')+box(476,716,476,61,C.paper,C.paper,0)+t(944,756,'原 operation end',29,C.red,650,'end')),
'请求开始时捕获所属操作。摘要晚于下一轮完成，也保留原 operationId 与 sessionId，不读取宿主的“当前操作”。',['S01','T01']);

page('08-tool.html','工具执行的事实','先过权限边界，\n再记录工具结果','允许、拒绝、取消和退出码由各自的接口报告。',svg('从工具调用经过权限分支，允许进入原生执行，拒绝到结果，人工终端只报告原生结果元信息',
chip(234,12,484,'tool start · 名称 + 参数字段数')+
line('M476 75V145',C.ink,true)+box(281,163,390,115,C.soft,C.ink)+t(476,210,'permission',35,C.ink,700,'middle')+t(476,253,'allow / ask / deny',29,C.muted,500,'middle')+
line('M288 222H110V352',C.red,true)+t(23,315,'拒绝',30,C.red,650)+box(0,370,320,120,C.redBg,C.red)+ls(28,414,['工具结果配对','没有启动命令'],28,C.red,600,'start',48)+
line('M664 222H797V352',C.green,true)+t(716,315,'允许执行',30,C.green,650)+box(565,370,387,120,C.greenBg,C.green)+ls(592,414,['原生工具 / 子进程','回调报告执行结果'],28,C.green,600,'start',48)+
line('M758 505V560H476V617',C.green,true)+line('M161 505V560H476',C.red)+
box(0,635,952,135)+t(28,684,'toolCallId · requestId · outcome',32,C.ink,650)+t(28,737,'exitCode / signal / pid · 不从终端文字猜测',29,C.muted)),
'人工终端只报告生命周期和原生退出结果。其输入、输出、命令正文与私密凭据不进入运行日志。',['S01','S03','T02']);

page('09-background.html','后台完成的归属','上一轮命令晚点结束，\n不要记到下一轮头上','事件的发生时间，与事件的所属操作可以不同。',svg('操作A的命令经CtrlS跳过等待，A结束后开始B，后台命令完成仍返回A的request与tool身份',
t(0,43,'时间向下推进',30,C.muted)+line('M47 86V727',C.ink,true)+
[[126,'A / request A1','terminal 开始'],[278,'A / tool_1','Ctrl-S：skipped，pid 仍受管'],[430,'operation A end','B 开始新的请求'],[582,'后台进程 close','background-completed / exit 0']].map(([y,a,b])=>
dot(47,y,9,y===582?C.green:C.ink)+t(99,y+9,a,32,C.ink,650)+t(99,y+64,b,29,C.muted)).join('')+
line('M867 594H933V137H700',C.green,true)+t(891,377,'归属 A',29,C.green,700,'end'),790),
'工具启动时捕获 operationId、requestId、toolCallId。真实 PTY 验收还核对了后台命令生成的文件，避免仅凭显示判定完成。',['S01','S02','T02']);

page('10-privacy.html','默认只收元信息','先列清楚允许记录什么，\n再让数据进入日志','白名单比“记录全部，再删几个字段”更容易审查。',svg('上下两区域分别显示采集的身份耗时用量分类和排除的prompt正文文件命令异常终端字节',
box(0,27,952,327,C.greenBg,C.green)+t(29,92,'允许进入',44,C.green,700)+
ls(29,159,['UUID / 类型 / 起止 / 阶段','耗时 / 字符数 / token 用量','工具名称 / 原生结果 / 错误分类'],33,C.ink,500,'start',73)+
box(0,422,952,327,C.redBg,C.red)+t(29,487,'正文不采集',44,C.red,700)+
ls(29,554,['用户问题 / 模型回复 / 文件内容','工具参数和结果正文 / 命令正文','原始异常 / API key / 人工终端字节'],33,C.ink,500,'start',73)),
'合法标签也做长度和环境密钥过滤。白名单不意味着绝对匿名：身份、模型名、时刻和用量仍属于运行元信息。',['S02','T01','T02']);

page('11-files.html','本地文件组织','一个工作区目录，\n每次运行各写一份','相同工作区可以浏览过去的 run，不共享写入游标。',svg('realpath工作目录经过SHA256得到目录键，目录中两个runUUID文件各自独占创建，权限分别0700与0600',
box(0,13,952,100)+t(30,75,'realpath(cwd) → SHA-256 → workspaceHash',31,C.ink,650)+
line('M476 127V191',C.green,true)+
smallTerminal(0,212,952,270,['~/.zero2agent/logs/','  <workspaceHash>/','    <run-A-UUID>.jsonl','    <run-B-UUID>.jsonl'])+
line('M241 496V555',C.green,true)+line('M711 496V555',C.green,true)+
box(0,573,439,190,C.greenBg,C.green)+t(29,630,'目录 0700',36,C.green,700)+t(29,691,'工作区隔离',30,C.ink)+
box(513,573,439,190)+t(542,630,'文件 0600 · wx',36,C.ink,700)+t(542,691,'独占创建 · 不追写旧文件',29,C.muted)),
'ZERO2AGENT_LOG_DIR 可替换根目录。run UUID 不是 session UUID；同一个会话恢复后，会在新 run 文件继续记录元信息。',['S02','T02']);

page('12-writer.html','日志失败不拖垮任务','写入队列需要上限，\n失败还必须看得见','接受一条记录之后，尽力保留已接受的完整前缀。',svg('元信息经过投影到有界队列，异步顺序写入并flush，预算超限或IO失败转入可见降级状态但任务继续',
[[0,'白名单投影'],[335,'有界队列'],[670,'顺序写入']].map(([x,s])=>box(x,75,282,101,C.greenBg,C.green)+t(x+141,138,s,33,C.green,700,'middle')).join('')+
line('M295 124H320',C.green,true)+line('M630 124H655',C.green,true)+
line('M476 190V313',C.red,true)+t(521,250,'上限 / I/O 失败',30,C.red,600)+
box(0,333,952,162,C.redBg,C.red)+t(29,393,'日志不可用 · 停止接受新记录',38,C.red,700)+t(29,455,'TUI 保持提示；plain 路径写到 stderr。',30,C.ink)+
line('M811 190V566',C.green,true)+box(500,587,452,173,C.greenBg,C.green)+t(527,645,'flush → fsync',34,C.green,700)+t(527,707,'操作收尾 / 正常退出',28,C.ink)+
box(0,587,432,173)+t(28,645,'任务继续',38,C.ink,700)+t(28,707,'诊断错误不替代任务结果',29,C.muted)),
'队列或文件预算拒绝后续记录，已接受队列仍会写完；实际 I/O 失败可能只留下前缀。fsync 不构成工具执行事务。',['S02','T02']);

page('13-crash.html','崩溃后的解释','缺少结束行，\n结果只能标为未知','日志不能和文件副作用一起原子提交。',svg('正常工具执行可能先修改文件然后进程被强杀，日志只留下start，右侧强调不能据此重试或判定文件没改',
smallTerminal(0,22,952,173,['request start','tool start · write_file'])+
line('M476 213V279',C.ink,true)+doc(94,300,136,171,'green')+t(308,358,'文件已经修改',41,C.green,700)+t(308,421,'副作用不跟随日志回滚',31,C.muted)+
line('M0 533H952',C.red,false,'10 10')+box(301,503,350,64,C.paper,C.paper,0)+t(476,546,'SIGKILL / 异常退出',32,C.red,700,'middle')+
box(0,614,952,151,C.redBg,C.red)+t(29,670,'未闭环：请求 / 工具 / 操作',36,C.red,700)+t(29,730,'先核对实际效果，再决定如何继续。',31,C.ink)),
'读者看到的是已写入的完整行。当前操作、请求、工具或后台进程缺少终态，会显示警告；不能自动重放工具。',['S02','T02','D01']);

page('14-reader.html','只读验证器','损坏的记录，\n不能悄悄当作正常数据','边界校验决定哪些内容可以用于追查。',svg('左侧完整JSONL行和残缺尾部可保留前缀，右侧中部损坏未知版本未知字段或软链接被拒绝',
t(0,54,'可以展示完整前缀',36,C.green,700)+t(523,54,'明确拒绝',36,C.red,700)+line('M476 87V679',C.line)+
[[135,'{ seq: 1, … }'],[228,'{ seq: 2, … }'],[321,'{ seq: 3, … }']].map(([y,s])=>box(0,y,432,62,C.greenBg,C.green,0)+t(24,y+42,s,29,C.green,600,'start',true)).join('')+
box(0,414,432,62,C.amberBg,C.amber,0)+t(24,456,'{ seq: 4, …',29,C.amber,600,'start',true)+t(0,554,'最后半行 → 警告',31,C.amber,650)+
ls(523,178,['中部不是合法 JSON','未知 version / 字段','seq 顺序不成立','非 UUID 文件入口','软链接 / 非普通文件'],30,C.red,600,'start',97)+
box(0,711,952,69,C.soft,C.line)+t(29,756,'按打开时的文件大小读取，只显示有限条匹配记录。',29,C.ink,600)),
'只读校验用于发现结构损坏，没有签名和防篡改保证。列表最多 500 项，查看保留最近 200 条匹配记录，并显示省略数量。',['S02','T02']);

page('15-tui.html','交互式追查','选择一份运行日志，\n在独立视图里浏览','焦点独占，日志文本不会成为下一轮输入。',svg('上方TUI日志列表可选择run，下方只读日志视图有键盘滚动和返回，输入草稿保留',
smallTerminal(0,7,952,242,['zero2agent · 选择运行日志','› run 7c… · 12:00:01','  run 2a… · 11:35:29'],'↑ / ↓ 选择 · Enter 查看 · Esc 返回')+
line('M476 266V318',C.green,true)+
smallTerminal(0,340,952,308,['zero2agent · 查看运行日志','request completed · 642 ms','tool write_file · completed','request completed · end_turn'],'↑↓ / Page / Home / End · 只读快照')+
chip(0,706,431,'Esc 返回列表 / 对话')+chip(505,706,447,'保留草稿 · 阻止粘贴')),
'图为教学示意；实际 PTY 证据另存于验收目录。审批、终端交接、日志选择与查看，同一时刻只有一个接收键盘的焦点。',['S03','T02']);

page('16-cli.html','所有入口保持兼容','TUI、plain、单次调用，\n使用同一份运行事实','不调用模型，也能在终端追查旧记录。',svg('四行命令分别列表查看操作过滤和独立关闭日志与会话保存，并标明keyless只读',
[[46,'--logs','列出当前工作区的 run'],[215,'--log <run UUID>','显示元信息与完整性警告'],[384,'--log-operation <UUID>','与 --log 配合，只看某次操作'],[553,'--no-save --no-log','分别关闭新会话保存与新日志']].map(([y,a,b])=>
t(0,y,a,32,C.ink,700,'start',true)+t(0,y+61,b,31,C.muted)+line(`M0 ${y+113}H952`,C.line)).join('')),
'列表与查看无需 API key，不创建新 run、不恢复会话、不执行工具。--plain、管道、单次调用和人工终端继续支持；默认各自写日志。',['S03','T02']);

page('17-triage.html','读日志做判断','先看失败发生在哪一层，\n再选择检查对象','分类帮助定位，具体效果仍要另外核对。',svg('五种记录映射五种检查方向，依次请求授权限流工具退出拒绝和未闭环',
[[90,'auth · HTTP 401','当前 API 配置 / 服务身份'],[225,'rate-limit · HTTP 429','服务限额 / 重试策略'],[360,'terminal · exitCode 7','命令实际效果与退出原因'],[495,'permission · deny','当前策略与授权对象'],[630,'start 没有对应 end','实际文件 / 进程 / 请求状态']].map(([y,a,b],i)=>
t(0,y,a,30,C.ink,650)+line(`M401 ${y-10}H448`,i===4?C.red:C.green,true)+t(480,y,b,29,i===4?C.red:C.green,600)+line(`M0 ${y+55}H952`,C.line)).join('')),
'错误分类不包含异常正文，因此不会给出完整业务原因。运行元信息是定位入口；不自动修改权限、重试命令或回退文件。',['S01','S02','T02']);

page('18-practice.html','离线跟练','真的执行一次，\n再追查它的记录','本地 HTTP 夹具 + 生产 CLI / SDK / 文件工具。',
'<div class="terminal" data-block><p class="mini">构建后运行 · 无真实模型费用</p><pre>node scripts/e03-s005-logging-demo.mjs\nnode scripts/e03-s005-logging-demo.mjs --tui</pre></div>'+svg('练习依次实际写入文件核对请求关联无密钥只读查看并主动制造401错误',
[[85,'A 核对实际文件效果','write_file 创建 trace-demo.txt。'],[246,'B 只读追查，不新增请求','按 run / operation 找到请求与工具。'],[407,'C 观察可解释的失败','夹具返回 HTTP 401，记录 auth 分类。']].map(([y,a,b],i)=>num(30,y,i+1)+t(86,y+12,a,36,C.ink,700)+t(86,y+72,b,31,C.muted)).join('')+t(30,548,'加入 --tui：选择 → 浏览 → 返回。',32,C.green,650),581),
'夹具不等于真实模型；两种证据分别记录。演示自动清理临时目录，先理解边界，再查看完整跟练与实测附件。',['D02','T01','T02'],'practice');

page('19-limits.html','存储和验证边界','有界记录仍有成本，\n长期治理留给后续','本课限额是保护边界，不是吞吐量测试结论。',svg('大小和数量上限分别是单行8KiB队列1MiB文件64MiB查看200列表500，右侧列出未覆盖的长期能力',
t(0,57,'当前上限',37,C.ink,700)+t(533,57,'后续需要',37,C.muted,700)+line('M476 90V685',C.line)+
ls(0,165,['单行 8 KiB','队列 1 MiB','文件 64 MiB','查看 200 条','列表 500 项'],35,C.green,650,'start',106)+
ls(533,165,['总目录保留策略','自动清理与归档','远端 trace 导出','网络卷 / Windows','断电故障验证'],32,C.muted,500,'start',106)+
box(0,715,952,64,C.amberBg,C.amber)+t(29,758,'本课实测：macOS；其他平台不写“已验证”。',29,C.amber,650)),
'尚未提供自动删除日志。日志结构还有限制：只报告逻辑 SDK 调用，不收正文；诊断 observer 失败不会替代 Agent 执行结果。',['S02','T01','T02']);

page('20-next.html','本课与下一课','能够追查运行事实，\n再讨论如何回退文件','定位问题与撤销效果，需要不同的承诺。',svg('本课请求工具元信息关联形成只读日志，下一课文件checkpoint涉及保存前像和恢复文件，外部副作用不在范围',
[[24,'请求身份'],[345,'工具执行'],[666,'原生结果']].map(([x,s])=>box(x,50,262,93,C.greenBg,C.green)+t(x+131,108,s,34,C.green,700,'middle')).join('')+
line('M155 163V219H476V280',C.green,true)+line('M797 163V219H476',C.green)+line('M476 163V219',C.green)+
box(0,300,952,119,C.soft,C.ink)+t(476,374,'本课：可定位、可解释、只读追查',38,C.ink,700,'middle')+
box(0,507,952,265,C.ink,C.ink)+t(29,566,'下一课 · E03-S006',31,C.paper,650)+t(29,640,'文件 Checkpoint 与回退',43,C.paper,700)+ls(29,700,['保存文件前像，明确恢复范围。','外部 API、付款、消息不随文件一起撤销。'],29,C.paper,400,'start',48)),
'S006 尚未实现。日志没有工具重放能力，也不承担撤销事务；两篇延伸文继续讨论副作用与 trace 的边界。',['S01','D01','D03']);

for(const [i,p] of pages.entries()){
 const number=String(i+1).padStart(2,'0');
 const header=`<header class="page-header"><span>Zero2Agent · ${p.section}</span><span class="page-number">${number}</span></header>`;
 const heading=`<div class="heading" data-block><h1>${esc(p.title).replaceAll('\n','<br>')}</h1><p class="deck" data-prose>${esc(p.deck)}</p></div>`;
 const content=`<div class="content">${p.body}${p.note?`<p class="explain" data-block data-prose>${esc(p.note)}</p>`:''}</div>`;
 const inner=i===0?`<div class="cover-frame"><header class="page-header"><span>Zero2Agent · 从循环到产品</span><span class="page-number">E03-S005</span></header><div class="series-masthead" data-block><h1 class="series-title">从零到一做 <span>Agent</span></h1><p class="series-description" data-prose>亲手实现 Coding Agent · 开源实战课程</p><h2 class="lesson-title">${esc(p.section)}</h2><p class="lesson-promise" data-prose>出了问题，找得到发生了什么</p></div><div class="series-body">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div><div class="cover-tags"><span>工程实战</span><span>交互设计</span><span>开源课程</span></div></div>`:header+heading+content;
 fs.writeFileSync(p.file,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080"><title>${esc(p.title.replaceAll('\n',''))}</title><link rel="stylesheet" href="course.css"></head><body><main class="sheet ${p.extra}${i===0?' series-cover':''}" data-page="${number}">${inner}</main></body></html>\n`);
}
fs.writeFileSync('pages.json',JSON.stringify({title:'Zero2Agent · E03-S005 运行日志与问题追查',date:'2026-10-07',draft:false,publicationStatus:'unpublished',width:1080,height:1440,maxImages:20,edition:'v1-runtime-logging',pages:pages.map((p,i)=>({file:p.file,title:p.title.replaceAll('\n',''),number:i+1,sources:p.sources}))},null,2)+'\n');
