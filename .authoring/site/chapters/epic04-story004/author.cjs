// Editable E04-S004 diagrams. Facts are traceable through sources.md.
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
const svg = (label,body,h=680) => `<svg class="diagram" viewBox="0 0 952 ${h}" width="952" height="${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><defs>${['ink','green','red','amber'].map(k=>`<marker id="${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="${C[k]}"/></marker>`).join('')}</defs>${body}</svg>`;
const pages=[];
const page=(slug,section,title,deck,body,note,sources,layout='')=>pages.push({file:`${String(pages.length+1).padStart(2,'0')}-${slug}.html`,section,title,deck,body,note,sources,layout});

page('cover','中断后的安全续跑','程序中断后，安全接着做','E04-S004 · 恢复执行记录，核对效果，再继续任务。',svg('先写入第一个文件，崩溃后恢复回执，再完成第二个文件的教学示意',
file(0,20,410,244,'first.json',['已经写入','回执已保存'],'green')+file(542,20,410,244,'second.json',['尚未执行','等待继续'],'amber')+
path('M440 145H510','red',true)+t(476,326,'进程被终止',43,C.red,700,'middle')+path('M476 361V432','green',true)+
rect(0,465,952,173,C.greenBg)+t(25,525,'恢复真实回执，保留未执行状态',37,C.green,700)+t(25,589,'明确继续后，只完成剩余工作',33)),
'教学示意。恢复不重放旧工具；未知效果需要先核对。正常的新调用仍由当前权限决定。',['S01','T01']);
page('incident','01 · 一次真实的中断','文件已经改了，\n对话却停在上一轮','工具产生效果与整轮会话保存之间，存在崩溃窗口。',svg('磁盘上的新文件与上一轮会话对照',
file(0,30,420,280,'磁盘文件',['version = 2','修改已经发生'],'green')+file(532,30,420,280,'旧会话快照',['version = 1','还没有工具回执'],'red')+
path('M476 45V330','line')+rule(393)+t(0,468,'此时直接“再做一次”可能重复写入。',37,C.red,700)+t(0,550,'缺少回执，不能证明工具没执行。',34)+t(0,621,'先查记录和文件，再决定下一步。',31,C.muted)),
'旧会话恢复只知道整轮未结算。本课把保存边界推进到工具前后，让可恢复的进度更细。',['S01','S02']);
page('boundaries','02 · 接在已有能力上','续聊、重试、回退，\n分别解决了哪一部分','这节课连接已有机制，补上跨进程的执行事实。',svg('四种已有能力与本课新增范围表',
[['会话保存','恢复上次结算的对话'],['请求重试','同一进程内有限恢复传输'],['文件回退','核对并恢复受保护文件'],['本课：执行恢复','恢复已结算工具，列出未知效果']].map(([a,b],i)=>rect(0,i*139,952,115,i===3?C.greenBg:C.white)+t(23,49+i*139,a,32,i===3?C.green:C.ink,700)+t(23,94+i*139,b,29,C.muted)).join('')+t(0,642,'新的继续动作仍使用当前权限与运行预算。',31,C.green,650)),
'S004 收束 E04：失败如何停、长结果如何读、事实如何留，以及崩溃以后怎样安全继续。',['S02','D01']);
page('timeline','03 · 找到崩溃窗口','崩溃发生在哪一步，\n决定我们能说什么','每个磁盘标记只证明已经发布的事实。',svg('执行记录、写文件、保存回执、保存整轮的纵向时间线',
path('M40 45V605','ink',true)+[['保存完整响应','工具列表存在，尚未进入执行'],['保存执行标记','接下来可能产生效果'],['实际写文件','文件可能已经改变'],['保存真实回执','工具结算结果可以恢复'],['保存整轮会话','清除运行中的 pending']].map(([a,b],i)=>dot(40,71+i*118,10,i===2?'red':'green')+t(92,68+i*118,a,33,C.ink,700)+t(92,110+i*118,b,29,i===2?C.red:C.muted)).join('')),
'执行标记写入之后、工具真正调用之前也存在窗口。此时只看到标记，没有结果，仍要保守报告未知。',['S01','S02','T01']);
page('states','04 · 三种恢复状态','未执行、已结算、未知，\n不要混成一个“失败”','恢复判断来自持久记录，不能来自模型的完成声明。',svg('三个恢复状态及依据',
[['未执行','没有进入执行边界','可证明本次调用未启动','green'],['已结算','真实回执已完整发布','保留成功或错误结果','ink'],['效果未知','进入执行边界，缺回执','核对文件、进程和外部效果','red']].map(([a,b,c,k],i)=>rect(0,i*204,952,177,C[k+'Bg']||C.white)+t(24,52+i*204,a,38,C[k],700)+t(300,52+i*204,b,31)+t(300,113+i*204,c,29,C.muted)).join('')),
'已结算包括工具返回错误。效果未知时不能伪造成功，也不能按“没执行”重跑。',['S01','T01']);
page('before','05 · 先保存，再执行','保存失败时，\n新的副作用必须停下来','持久化是等待完成的控制接口。',svg('权限授权、发布执行快照、文件保护、工具调用的流程',
[['当前权限批准','不沿用昨天的许可'],['执行快照发布','等待写入、fsync、独占发布'],['文件 Checkpoint','捕获受保护路径的原状态'],['工具执行','只有前面的步骤完成才开始']].map(([a,b],i)=>rect(i%2*496,Math.floor(i/2)*296,456,196,C.white,C.line)+t(i%2*496+22,Math.floor(i/2)*296+65,a,34,C.ink,700)+t(i%2*496+22,Math.floor(i/2)*296+128,b,25,C.muted)).join('')+
path('M470 100H482','green',true)+path('M724 212V260H228V283','green',true)+path('M470 396H482','green',true)+t(0,620,'任一前置保存失败 → 停止后续工具和请求',32,C.red,700)),
'展示通知可能丢失或失败，因此不能承担保存前置条件。保存失败也不会撤销此前已经完成的效果。',['S01','S03','T01']);
page('receipt','06 · 结束后留下真实回执','工具执行一次，\n回执随后进入恢复快照','下一条工具和下一次请求，都要等这份进度保存。',svg('工具真实效果与回执发布连接',
file(0,0,390,250,'first.json',['{"stage":"first"}','实际文件内容'],'green')+path('M421 125H519','green',true)+consoleBox(550,0,402,250,'真实工具回执',['Created first.json','… bytes written'],26)+
path('M751 278V352H479','green',true)+rect(0,386,952,188,C.greenBg)+t(25,448,'调用 + 结果 + 来源 + 控制状态',35,C.green,700)+t(25,512,'在同一份完整 generation 中发布',31)+t(0,640,'保存后即使进程退出，回执也能被找回。',30)),
'回执保存前崩溃仍属未知。回执保存后崩溃，恢复只装载数据，不调用旧工具。',['S01','S02','T01']);
page('generation','07 · 复用完整快照','同一份版本，\n一起保存事实与控制状态','减少多份存储之间“这一份新、那一份旧”的组合。',svg('同一快照包含原史、摘要边界、引用来源和恢复控制；发布顺序',
rect(0,0,952,72,C.ink)+t(24,48,'session / revision N',33,C.paper,700)+[['原始消息','调用与结果配对'],['摘要与边界','只保留已采用版本'],['结果及来源目录','本机正文引用与读取权限'],['恢复控制状态','工具状态、未解决检查、预算证据']].map(([a,b],i)=>t(24,145+i*98,a,32,C.ink,700)+t(365,145+i*98,b,28)+rule(181+i*98)).join('')+
t(0,583,'写临时文件 → fsync → 独占发布新版本',31,C.green,700)+t(0,640,'两个写入者争同一版本，只能有一个成功。',29,C.muted)),
'含恢复状态的会话升级为 version=2，旧程序明确拒绝读取。完整快照容易校验，但增加写入和占用；首版限定容量，不自动清理。',['S02','D01']);
page('batch','08 · 批次只做完一半','第一项完成，\n不代表整批都可以重放','一个模型响应中，每个工具分别记录状态。',svg('三个工具的部分结算进度',
rect(0,0,952,70,C.ink)+t(22,47,'同一个完整模型响应',34,C.paper,700)+[['工具 A','已结算','保留真实回执','green'],['工具 B','效果未知','核对实际效果','red'],['工具 C','未执行','保留未执行记录','amber']].map(([a,b,c,k],i)=>t(23,159+i*157,a,35,C.ink,700)+tag(265,118+i*157,225,b,k)+t(548,158+i*157,c,30)+rule(203+i*157)).join('')+
t(0,635,'恢复历史必须配对，但中断占位不冒充工具回执。',28,C.red,650)),
'宿主错误占位明确写明未执行或未知，供消息协议配对。真正的成功或错误结果只来自已保存回执。',['S01','T01']);
page('files','09 · 核对已有文件保护','看到文件存在，\n仍要判断它是谁改的','使用关联的 Checkpoint 查看差异与中断写入。',svg('写入前、记录的写入后、当前人工编辑版本并列',
file(0,20,294,300,'写入前',['旧内容','before'],'ink')+file(329,20,294,300,'写入后',['工具留下的版本','after'],'green')+file(658,20,294,300,'现在',['人工又改过','current'],'red')+
rule(397)+consoleBox(0,431,952,181,'已有检查入口',['/diff <checkpoint-id>','/recover <checkpoint-id>'],29)+t(0,665,'继续前重新读取；不覆盖较新的人工修改。',30,C.red,700)),
'文件相同只说明当前内容一致，不能证明旧工具一定成功。Checkpoint 不覆盖任意 shell 和外部系统。',['S03','T01']);
page('shell','10 · 明确可恢复的范围','未知命令的效果，\n需要人在现场核对','首版完成单机、单会话、受控文件工具的恢复。',svg('受控文件与任意shell效果边界',
t(0,50,'受控文件工具',38,C.green,700)+t(516,50,'普通 shell / 外部系统',33,C.red,700)+path('M476 12V472','line')+
ls(0,148,['明确的写入路径','已有文件 Checkpoint','可比较实际文件状态'],31,C.ink,91)+ls(516,148,['可能启动后台进程','可能发出外部请求','没有通用回滚或去重保证'],29,C.ink,91)+
rect(0,509,952,133,C.redBg)+t(25,560,'不会复活旧进程，也不自动重放命令。',34,C.red,700)+t(25,609,'未知效果保留，核对后明确选择继续。',29)),
'本课没有通用进程监督、多主机协调或外部系统恰好一次执行。安全恢复必须说明证据能覆盖到哪里。',['D01','S03']);
page('permissions','11 · 恢复记录不恢复许可','昨天同意的写入，\n今天仍按当前策略判断','历史工具只是历史，新调用再次经过权限与文件保护。',svg('昨天批准、保存事实、今天重新权限判定',
rect(0,5,952,146,C.soft)+t(25,62,'昨天：允许本次写 first.json',35,C.ink,700)+t(25,117,'保存的是调用、结果和来源',29,C.muted)+path('M476 178V260','ink',true)+
rect(0,293,952,165,C.white,C.line)+t(25,356,'今天：模型提出新的 write_file',35,C.ink,700)+t(25,412,'当前 default 策略 → 需要新的批准',29,C.red)+
rule(514)+t(0,581,'恢复不继承旧审批、配置凭据或进程对象。',32,C.green,700)+t(0,641,'拒绝新调用时，已经完成的历史仍保留。',29,C.muted)),
'回读历史和保存结果也沿用来源权限。权限测试用新进程改变策略，检查实际文件未被写入。',['S01','S02','T01']);
page('guards','12 · 接住前面三课','一次重启，\n不能把“未完成”变成完成','恢复保留控制状态；明确续跑才开启新一轮预算。',svg('预算、读取和产物三条控制状态',
[['运行预算','保存旧轮计数和停止原因','新一轮由用户明确开启'],['未解决读取','原引用仍在，已用纠错机会不增加','模型说完成不能清除 pending'],['显式产物契约','继续校验原先要求的实际文件','已经用过的修复机会不会重置']].map(([a,b,c],i)=>t(0,58+i*212,a,36,C.red,700)+t(0,121+i*212,b,31)+t(0,174+i*212,c,29,C.muted)+rule(200+i*212)).join('')),
'计数只覆盖最近持久化边界，崩溃间隙可能还有请求消耗。没有把缺失用量当作零，也没有宣称接续旧预算。',['S01','S04','T01']);
page('interface','13 · 恢复后的入口','先看清楚，\n再明确开始下一轮','复用会话恢复入口，增加待恢复状态与继续动作。',svg('恢复命令和工具状态的教学示意',
consoleBox(0,0,952,366,'CLI / TUI · 命令与状态示意',['/resume <session-id>','/recovery','first  write_file  已结算','second write_file  未执行'],28)+
path('M476 396V449','green',true)+consoleBox(0,479,952,164,'核对后明确继续',['/recovery continue 完成剩余文件'],30)),
'单次调用用 --resume UUID --resume-task "指令"。普通提问在待恢复状态下被阻止；/recover UUID 仍用于已有的文件恢复，不混用命令。',['S05','T01']);
page('experiment','14 · 亲手终止进程','让进程真的退出，\n再让新进程读磁盘','只抛一个异常，无法检验进程消失后的恢复。',svg('进程A写入被SIGKILL，进程B读取磁盘继续的实验图',
rect(0,0,420,212,C.white,C.line)+t(25,65,'进程 A',42,C.ink,700)+ls(25,128,['写 first.json','保存第一条回执'],29,C.ink,45)+
rect(532,0,420,212,C.redBg)+t(557,65,'SIGKILL',42,C.red,700)+ls(557,128,['没有 finally 收尾','内存直接消失'],29,C.red,45)+path('M225 245V335H720V385','green',true)+
rect(0,417,952,207,C.greenBg)+t(25,479,'进程 B：装载执行记录，明确续跑',34,C.green,700)+t(25,542,'检查 first 没有重复写，second 完成一次。',29)+t(25,595,'断电与网络文件系统仍需另做验证。',28,C.muted)),
'故障注入覆盖完整响应、执行标记、实际写入之后，以及回执保存之后。检查实际文件与效果次数。',['T01','T02']);
page('storage','15 · 保存失败也是任务状态','容量满或数据损坏，\n必须明确停下来','不能为了继续工作，悄悄丢掉尚未核对的记录。',svg('容量和错误处理表',
[['单份快照','32 MiB 上限'],['单会话已发布版本','512 MiB / 2048 份上限'],['最高版本损坏','报错，不偷偷退回较旧版本'],['并发保存冲突','保留内存，不覆盖另一写入者'],['旧进程仍在运行','拒绝抢占，先处理原运行']].map(([a,b],i)=>t(0,64+i*111,a,31,C.ink,700)+t(459,64+i*111,b,28,i>1?C.red:C.green)+rule(104+i*111)).join('')+t(0,653,'私有目录权限只提供本地保护，不等于加密。',29,C.muted)),
'首版不自动删除恢复记录。结果正文仍有独立生命周期，过期或丢失会明确失败；恢复保证不等于永久保存正文。',['S02','S04','T01']);
page('practice','16 · 离线跟练','一次命令，\n看见中断前后的两个进程','默认只访问本机确定性服务，不需要 API key。',svg('离线跟练命令与预期结果',
consoleBox(0,0,952,219,'仓库根目录',['pnpm install && pnpm build','node researches/safe-resume/demo.mjs'],26)+
[['进程 A','SIGKILL 后留下已结算记录'],['进程 B','按原契约补齐剩余文件'],['实际文件','first.json / second.json 各写一次']].map(([a,b],i)=>t(0,311+i*121,a,34,C.red,700)+t(209,311+i*121,b,30)+rule(348+i*121)).join('')),
'输出位于 tmp/e04-s004/，含快照、效果记录及诊断。--live 明确调用已配置的真实服务；真实结果与离线结果分别报告。',['T02']);
page('finish','17 · E04 收束','能解释停在哪里，\n才能安全地继续','把四课串成一个可观察、可验证的执行过程。',svg('E04四课串联以及验收标准',
[['S001','失败恢复与预算'],['S002','大结果按需读取'],['S003','摘要质量与事实保留'],['S004','中断后的安全续跑']].map(([a,b],i)=>rect(0,i*117,952,94,i===3?C.greenBg:C.white)+t(24,60+i*117,a,34,C.red,700)+t(205,60+i*117,b,35,C.ink,650)).join('')+
rule(520)+t(0,578,'验收看文件、调用次数、历史配对与控制状态。',30,C.green,700)+t(0,640,'下一阶段 E05：AGENTS、Skills、MCP、Hooks。',29,C.muted)),
'工程回归、真实子进程、PTY 与真实服务分层留证；结果见验收清单。课程待 PR 审阅，站点未部署。',['D01','T01','T02']);
if(pages.length!==18) throw new Error('E04-S004 must contain exactly 18 pages including its cover');
for(const [i,p] of pages.entries()) {
 const number=String(i+1).padStart(2,'0');
 const header=`<header class="page-header"><span>Zero2Agent · ${esc(p.section)}</span><span class="page-number">${number}</span></header>`;
 const heading=`<div class="heading" data-block><h1>${esc(p.title).replaceAll('\n','<br>')}</h1><p class="deck" data-prose>${esc(p.deck)}</p></div>`;
 const content=`<div class="content">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div>`;
 const cover=`<div class="cover-frame"><header class="page-header"><span>Zero2Agent · 健壮性与上下文</span><span class="page-number">E04-S004</span></header><div class="series-masthead" data-block><h1 class="series-title">从零到一做 <span>Agent</span></h1><p class="series-description" data-prose>亲手实现 Coding Agent · 开源实战课程</p><h2 class="lesson-title">中断后的安全续跑</h2><p class="lesson-promise" data-prose>恢复执行记录，核对效果，再继续任务。</p></div><div class="series-body">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div><div class="cover-tags"><span>执行进度</span><span>安全续跑</span><span>开源课程</span></div></div>`;
 fs.writeFileSync(p.file,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080"><title>${esc(p.title.replaceAll('\n',''))}</title><link rel="stylesheet" href="course.css"></head><body><main class="sheet ${i===0?'cover series-cover':''}" data-page="${number}">${i===0?cover:header+heading+content}</main></body></html>\n`);
}
fs.writeFileSync('pages.json',JSON.stringify({title:'Zero2Agent · E04-S004 中断后的安全续跑',date:'2026-10-16',draft:true,publicationStatus:'unpublished',width:1080,height:1440,maxImages:18,edition:'safe-resume-review',pages:pages.map((p,i)=>({file:p.file,title:p.title.replaceAll('\n',''),number:i+1,sources:p.sources}))},null,2)+'\n');
