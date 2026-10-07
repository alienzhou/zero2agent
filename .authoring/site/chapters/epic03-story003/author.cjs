// E03-S003 editable diagrams. Generated through pnpm site:build; no external assets.
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

page('01-cover.html','运行状态与 TUI','Agent 正在运行\n你能看见，也能控制','E03-S003 · 从打印日志到连续可用的终端界面',svg('终端上方显示当前状态，中部记录两个同名工具的不同结果，下方保留用户草稿',
box(46,28,860,595,C.ink,C.ink,14)+dot(79,59,7,C.red)+dot(102,59,7,C.amber)+dot(125,59,7,C.green)+
t(80,123,'◓ 等待模型 · 3.2s',35,C.paper,650)+line('M80 155H872','#C9CDC2')+
t(80,215,'Agent › 已检查文件，准备验证。',31,C.paper)+
box(78,256,795,83,'#452F2B','#9B635C')+t(104,308,'◇ write_file  · first  · 已拒绝',31,'#F2C7BD',500)+
box(78,356,795,83,'#314035','#6B806C')+t(104,408,'✓ write_file  · second · 已完成',31,C.paper,600)+
line('M80 481H872','#C9CDC2')+t(80,530,'草稿 › 下一步请检查测试结果',32,C.paper)+t(80,581,'Ctrl-C 取消   ·   Ctrl-O 工具详情',27,'#C8D4C5')+
line('M166 624V683',C.green,true)+line('M476 624V683',C.amber,true)+line('M786 624V683',C.red,true)+
t(166,740,'看状态',37,C.green,650,'middle')+t(476,740,'审操作',37,C.amber,650,'middle')+t(786,740,'控运行',37,C.red,650,'middle')),'',['C01','C04'],'cover');

page('02-silence.html','使用场景','屏幕安静了十秒，\nAgent 到底在等什么？','同样没有新文字，背后可能是三种不同状态。',svg('相同的十秒沉默分成模型等待、工具执行和审批等待，用户需要的操作分别不同',
smallTerminal(0,10,952,151,['你 › 修复文件，然后运行验证。'],'10 秒过去，没有新文字……')+
line('M476 162V216',C.ink,true)+t(476,256,'把原因明确显示出来',35,C.ink,650,'middle')+
[[40,325,'模型请求','等待首个响应','可继续等，也可取消','green'],[40,478,'工具执行','命令尚未退出','看工具进展与耗时','green'],[40,631,'等待审批','工具还没有执行','查看参数，给出回答','amber']].map(([x,y,a,b,c,tone],i)=>num(x+22,y+42,i+1)+t(x+70,y+37,a,37,C[tone],650)+t(x+70,y+90,b,31,C.muted)+line(`M365 ${y+47}H491`,C[tone],true)+t(526,y+60,c,33,C.ink,550)).join('')),
'“正在忙”只解释了一半。界面还要告诉你：它在做什么，现在需要你做什么。',['C01','C04']);

page('03-layout.html','界面组成','一块终端，\n同时回答四个问题','TUI = Terminal User Interface，终端中的交互界面。',svg('终端分为状态、对话和工具、当前输入区，四个标注解释它在做什么、发生过什么、哪次调用和用户能做什么',
box(0,16,627,732,C.ink,C.ink,12)+t(28,74,'◓ 执行工具 · 4.2s',33,C.paper,650)+t(28,122,'工作目录: /lesson',28,'#BAC8B8',400,'start',true)+
line('M28 148H600','#6B806C')+ls(28,205,['你 › 修复后运行测试','Agent › 先检查源文件。'],30,C.paper,400,'start',50)+
box(24,310,580,186,'#314035','#6B806C')+t(47,359,'terminal · call-2 · 运行中',29,C.paper,650)+t(47,411,'npm test',32,C.paper,500,'start',true)+t(47,464,'测试输出……',29,'#BAC8B8')+
line('M28 578H600','#6B806C')+t(28,625,'运行中 · 可编辑草稿',29,'#BAC8B8')+t(28,677,'草稿 › 请再检查边界情况',30,C.paper)+
[[74,'当前阶段',['正在请求、执行','还是等你批准？']],[232,'对话内容',['模型正文与宿主','提示分别呈现。']],[400,'工具记录',['同名调用也按 ID','保留独立结果。']],[642,'输入与控制',['草稿始终可找回，','操作随焦点变化。']]].map(([y,a,b],i)=>line(`M631 ${y}H673`,C.red)+num(702,y,i+1)+t(746,y+10,a,31,C.ink,650)+ls(681,y+62,b,29,C.muted,400,'start',41)).join('')),
'这里是教学重排示意。界面内容由真实运行事件更新；有输入框、有状态栏，还需要一致的控制行为。',['C01','C04']);

page('04-products.html','竞品启发','借鉴交互原则，\n不照搬一套快捷键','2026-10-07：四款产品的官方文档与固定源码对照。',svg('四个不同的小图分别表达Codex事件关联、Gemini工具到整轮聚合、OpenCode焦点切换和Claude Code输入排队',
box(0,8,452,363)+t(28,57,'Codex',37,C.ink,700)+chip(29,95,114,'开始')+line('M151 119H183',C.green,true)+chip(196,95,113,'增量')+line('M316 119H337',C.green,true)+chip(344,95,82,'结束')+
line('M60 178H395',C.red)+t(224,218,'用同一个 call_id 串起来',29,C.red,650,'middle')+ls(28,282,['事件告诉界面发生了什么，','工具完成不等于整轮结束。'],29,C.muted,400,'start',43)+
box(500,8,452,363)+t(528,57,'Gemini CLI',37,C.ink,700)+t(536,123,'模型响应',29)+t(773,123,'工具状态',29)+line('M601 145V176H834V145',C.green)+line('M727 176V197',C.green,true)+chip(634,199,186,'整轮状态')+ls(528,282,['工具结果尚未交回模型，','界面仍属于 responding。'],29,C.muted,400,'start',43)+
box(0,414,452,363)+t(28,463,'OpenCode',37,C.ink,700)+t(36,533,'输入区',31,C.muted)+line('M168 523H269',C.amber,true)+box(290,490,131,68,C.amberBg,C.amber)+t(355,534,'弹层',31,C.amber,650,'middle')+line('M355 560V598H119V560',C.green,true)+ls(28,687,['打开弹层先移交焦点，','关闭后归还草稿。'],29,C.muted,400,'start',43)+
box(500,414,452,363)+t(528,463,'Claude Code',37,C.ink,700)+box(528,495,396,62,C.ink,C.ink)+t(551,537,'任务正在运行……',30,C.paper)+doc(552,594,61,90)+doc(636,594,61,90)+line('M723 638H880',C.green,true)+ls(528,730,['运行中提交的消息可排队。'],29,C.muted)),
'实机仅检查 Codex 0.160.1 与 OpenCode 1.18.35 的编辑、菜单和缩放；未运行竞品模型任务。其他行为来自文档或源码。',['R01','R02','R03','R04','R05']);

page('05-channels.html','事件与控制','屏幕收到的是事实，\n用户发出的是决定','观察接口与控制接口，各自负责一个方向。',svg('Core向TUI发送RuntimeEvent，TUI的取消和审批回答沿独立通道返回宿主控制器',
box(0,55,301,580,C.soft,C.ink)+t(151,111,'Core / Loop',36,C.ink,700,'middle')+ls(150,205,['模型请求','工具执行','权限判断','实际结果'],34,C.ink,500,'middle',105)+
box(651,55,301,580,C.ink,C.ink)+t(802,111,'TUI / 输入',36,C.paper,700,'middle')+ls(802,205,['更新状态','显示文字','等待回答','呈现结果'],34,C.paper,500,'middle',105)+
line('M314 211H636',C.green,true)+t(476,172,'通知 →',32,C.green,700,'middle')+ls(476,270,['RuntimeEvent','身份 / 状态 / 文本'],27,C.muted,400,'middle',43,true)+
line('M638 443H316',C.red,true)+t(476,403,'← 控制',32,C.red,700,'middle')+ls(476,499,['cancelTurn()','requestId + 决策'],27,C.muted,400,'middle',43,true)+
box(0,678,952,91,C.white,C.line)+t(476,733,'渲染失败，也不能变成“批准工具执行”。',33,C.ink,600,'middle')),
'onEvent 是观察通知：抛错或修改事件副本不改变执行。批准与取消必须走宿主提供的控制接口。',['C02','C03']);

page('06-identity.html','事件身份','别用工具名称，\n去更新一张工具卡','一个 Turn 里，同名工具可以执行很多次。',svg('相同write_file名称对应first和second两个工具调用，不同turn允许复用调用ID，seq只决定同轮事件顺序',
box(0,12,952,100,C.ink,C.ink)+t(30,74,'事件身份 = turnId + toolCallId',39,C.paper,650,'start',true)+
t(22,174,'Turn A',35,C.ink,700)+line('M173 161H930',C.line)+
box(28,210,355,120,C.redBg,C.red)+t(57,257,'write_file',34,C.red,650,'start',true)+t(57,306,'toolCallId: first',29,C.red,400,'start',true)+
box(28,368,355,120,C.greenBg,C.green)+t(57,415,'write_file',34,C.green,650,'start',true)+t(57,464,'toolCallId: second',28,C.green,400,'start',true)+
line('M397 267H524',C.red,true)+line('M397 425H524',C.green,true)+chip(546,235,360,'first → 已拒绝','red')+chip(546,392,360,'second → 已完成')+
t(534,342,'名称相同，结果各自归属',30,C.muted)+
box(0,531,952,125,C.soft,C.line)+t(28,579,'Turn B · first',33,C.ink,650,'start',true)+t(28,625,'即使调用 ID 再出现，也属于新的运行。',31,C.muted)+
line('M68 722H881',C.ink,true)+[1,2,3,4].map((n,i)=>ring(125+i*220,722,23,C.paper,C.ink)+t(125+i*220,731,n,26,C.ink,650,'middle')).join('')+t(476,773,'seq：同一轮内递增，过滤重复或迟到事件',29,C.muted,400,'middle')),
'turnId 确定运行，toolCallId 确定工具，seq 确定已处理顺序。三者解决的问题不同。',['C02','C04']);

page('07-turn-state.html','整轮状态','一次运行，\n会多次回到模型请求','状态栏跟随实际阶段，最终由 turn-end 收束。',svg('准备后请求模型，模型可输出文字并提出工具，工具完成后回到模型请求，只有turn-end才进入终态',
chip(350,3,253,'turn-start')+line('M476 54V105',C.green,true)+
box(277,116,398,83,C.soft,C.ink)+t(476,169,'准备请求 · preparing',32,C.ink,650,'middle')+line('M476 201V258',C.green,true)+
box(277,270,398,91,C.ink,C.ink)+t(476,328,'等待模型 · requesting',32,C.paper,650,'middle')+
line('M476 364V421',C.green,true)+box(277,433,398,87,C.white,C.green)+t(476,488,'文本输出 · streaming',32,C.green,650,'middle')+
line('M936 566H947V314H686',C.green,true)+t(822,405,'工具完成后',29,C.green,650,'middle')+
box(744,518,192,93,C.greenBg,C.green)+t(840,559,'执行工具',30,C.green,650,'middle')+t(840,600,'tools',28,C.green,400,'middle',true)+line('M676 484H840V507',C.green,true)+
line('M278 474H146V622H474',C.ink,true)+t(80,544,'无需工具',28,C.muted,400,'middle')+
box(277,635,398,78,C.ink,C.ink)+t(476,685,'turn-end',35,C.paper,650,'middle',true)+
[[135,'completed','green'],[476,'failed','red'],[817,'cancelled','amber']].map(([x,s,tone])=>line(`M476 715V731H${x}V744`,C[tone],false)+t(x,784,s,30,C[tone],650,'middle',true)).join('')),
'工具结束后还可能继续请求模型。失败或取消可从在途阶段进入终态；最终以 turn-end 为准。',['C02','C03']);

page('08-tool-state.html','工具状态','审批等待期间，\n工具还没有运行','先识别调用，再等权限，通过后才进入 running。',svg('工具主路径pending到approval到running到completed，审批拒绝进入denied，执行失败进入error，未开始且取消进入cancelled',
[[103,115,'pending','已收到调用','soft','ink'],[387,115,'approval','等待用户回答','amberBg','amber'],[672,115,'running','实际开始执行','greenBg','green']].map(([x,y,a,b,bg,tone])=>box(x-86,y,251,124,C[bg],C[tone])+t(x+40,y+53,a,32,C[tone],650,'middle',true)+t(x+40,y+100,b,29,C.muted,400,'middle')).join('')+
line('M270 177H295',C.amber,true)+line('M554 177H579',C.green,true)+t(566,112,'批准',27,C.green,600,'middle')+
line('M427 241V364',C.red,true)+t(463,310,'拒绝',29,C.red,600)+chip(282,380,290,'denied · 已拒绝','red')+
line('M712 241V460',C.green,false)+line('M712 460H290V518',C.green,true)+line('M712 460V518',C.red,true)+
chip(77,533,365,'completed · 已完成')+chip(514,533,365,'error · 执行出错','red')+
box(0,639,952,126,C.soft,C.line)+t(30,687,'cancelled · 本轮取消而未执行',33,C.amber,650)+t(30,738,'未开始的调用停止调度，并留下对应回执。',32,C.muted)),
'自动允许的调用可跳过 approval。已执行工具保留真实结果；取消不会把成功结果改写成“从未发生”。',['C02','C03']);

page('09-approval.html','审批交互','确认的是这次调用，\n不是同名工具的所有操作','完整参数可滚动查看；默认回答仍是拒绝。',svg('审批面板展示当前调用ID、工作目录、原因和完整JSON，底部回答仅对应当前requestId',
box(0,6,952,632,C.ink,C.ink,12)+chip(28,33,221,'等待审批','amber')+t(278,71,'write_file · first',34,C.paper,650,'start',true)+
ls(30,143,['调用：first','目录：/lesson','原因：写文件需要批准'],30,C.paper,400,'start',48)+line('M28 274H923','#6B806C')+
t(30,322,'参数（完整 JSON）',29,'#BAC8B8')+
ls(40,377,['{','  "path": "first.txt",','  "content": "Hello from lesson.\\n"','}'],30,C.paper,400,'start',49,true)+
t(30,601,'↑↓ / PgUp PgDn 查看全部参数',28,'#BAC8B8')+
line('M266 643V685',C.green,true)+line('M686 643V685',C.red,true)+chip(30,695,431,'y：仅批准本次')+chip(490,695,432,'n / Enter：拒绝本次','red')+
t(476,773,'请求失效后，晚到的回答不能放行下一次。',31,C.muted,500,'middle')),
'教学重排示意，字段来自本课实现。requestId 关联这一次决定；超时、取消和 EOF 都必须结束等待。',['C03','C04','C07']);

page('10-focus.html','输入所有权','同一个 stdin，\n同一时刻只给一个接收者','你输入的 y，究竟是草稿、批准，还是终端内容？',svg('输入所有权从普通草稿切换为审批再切换为人工PTY，每阶段仅一个消费者活动，结束后恢复原草稿',
box(0,18,952,82,C.ink,C.ink)+t(476,73,'键盘输入  →  当前所有者',37,C.paper,650,'middle')+
[[160,'日常 / 运行中','对话输入','编辑下一条草稿','green'],[350,'等待批准','当前审批','回答当前 requestId','amber'],[540,'人工接管','Human PTY','输入只到交互终端','red']].map(([y,a,b,c,tone],i)=>num(30,y+37,i+1)+t(76,y+48,a,33,C.muted,500)+line(`M312 ${y+36}H384`,C[tone],true)+box(399,y,517,127,C[tone+'Bg'],C[tone])+t(426,y+46,b,35,C[tone],650)+t(426,y+97,c,30,C.ink)).join('')+
line('M915 667H940V753H302V234H385',C.green,true,'8 7')+t(518,742,'结束 → 恢复界面与原草稿',31,C.green,650,'middle')),
'切换焦点时停掉旧输入消费者。审批与人工终端输入不进入聊天历史；绘制也要配合交接暂停。',['C04','C05','R02','R04']);

page('11-cancel.html','取消协议','按下取消，\n先收尾，再开放下一轮','“正在取消”是一段真实过程，不是立即完成的动画。',svg('用户按取消后，模型请求、审批和工具各自收尾，在turn-end cancelled后Session才允许下一轮',
t(20,48,'时间 →',30,C.muted)+line('M176 36H935',C.ink,true)+
box(208,80,495,560,C.amberBg,C.amber,8)+t(455,128,'cancelling · 正在取消',34,C.amber,650,'middle')+
[[213,'模型请求','中断 HTTP / SSE',C.green],[366,'权限等待','失效并清理监听',C.amber],[519,'已启动工具','响应 signal 或等到实际结束',C.red]].map(([y,a,b,color])=>t(20,y,a,32,C.ink,650)+line(`M175 ${y-10}H622`,color,true)+t(244,y+40,b,30,color,550)).join('')+
line('M232 81V8',C.red,false)+t(222,753,'Ctrl-C',31,C.red,650,'middle',true)+line('M232 718V647',C.red,true)+
box(739,285,212,207,C.ink,C.ink)+ls(845,338,['turn-end','cancelled'],31,C.paper,650,'middle',49,true)+t(845,456,'释放 Session',28,C.paper,500,'middle')+
line('M707 394H730',C.green,true)+line('M845 498V651',C.green,true)+t(845,701,'可发送下一轮',28,C.green,650,'middle')),
'若工具忽略 signal，它仍可能修改文件。此时保持取消中，等待真实结算；提前显示空闲会造成两轮同时执行。',['C02','C03','C06']);

page('12-evidence.html','取消后的证据','停止后续操作，\n不抹掉已经发生的结果','取消不会撤销文件，也不能留下未配对的工具调用。',svg('已完成调用A保留成功结果和磁盘文件，取消后未开始的调用B返回取消错误且不执行，两者都配对',
t(10,47,'模型提出的调用',33,C.ink,650)+t(605,47,'送回模型的结果',33,C.ink,650)+
box(0,83,352,176,C.greenBg,C.green)+t(25,131,'A · write_file',31,C.green,650,'start',true)+ls(25,185,['已完成写入','saved.txt'],31,C.ink,400,'start',48)+
line('M366 171H565',C.green,true)+t(472,135,'同一 ID',29,C.green,600,'middle')+box(586,83,365,176,C.greenBg,C.green)+t(613,143,'A · 成功回执',33,C.green,650)+t(613,217,'保留真实执行结果',29,C.ink)+
line('M0 322H951',C.red,false,'10 8')+box(285,291,380,61,C.paper,C.paper,0)+t(475,332,'用户取消当前轮',35,C.red,700,'middle')+
box(0,402,352,176,C.amberBg,C.amber)+t(25,450,'B · terminal',31,C.amber,650,'start',true)+ls(25,503,['尚未开始','停止后续调度'],31,C.ink,400,'start',48)+
line('M366 489H565',C.amber,true)+t(472,453,'同一 ID',29,C.amber,600,'middle')+box(586,402,365,176,C.amberBg,C.amber)+t(613,462,'B · 取消回执',33,C.amber,650)+t(613,536,'未执行也有配对结果',29,C.ink)+
doc(92,636,73,111,'green')+t(209,683,'saved.txt 仍在磁盘上',36,C.green,650)+t(209,738,'要恢复文件，需要另一个明确的操作。',29,C.muted)),
'保留已完成的证据，也说明哪些动作未执行。下一轮才能从真实中断点继续，而不是误以为全部回滚。',['C02','C03','C06']);

page('13-draft.html','运行中的输入','Agent 工作时，\n你可以继续写下一条','草稿不被状态重绘、详情查看或取消过程吞掉。',svg('运行中编辑的草稿在取消后仍保留，等本轮结束再按Enter发送；上下历史也保存当前草稿',
smallTerminal(0,8,952,239,['◓ 等待模型 · 3.2s','','草稿 › 请检查空文件的情况'], 'Ctrl-C 取消本轮  ·  草稿可以继续编辑')+
line('M476 249V312',C.red,true)+chip(332,324,288,'Ctrl-C → 收尾','red')+line('M476 377V443',C.green,true)+
smallTerminal(0,457,952,246,['■ 已取消','','你 › 请检查空文件的情况'],'Enter 发送  ·  ↑↓ 输入历史')+
line('M477 706V735',C.green,true)+t(477,779,'本轮真正结束后，手动 Enter 发送草稿。',33,C.green,650,'middle')),
'本课忙时允许编辑，不自动排队执行。浏览输入历史前保存草稿；回到最新位置后还能继续写。',['C04','C07','R05']);

page('14-input.html','输入编辑','粘贴三行，\n不应该发送三次','把文本编辑与提交动作分开，才能安心输入代码。',svg('三行粘贴作为一个输入片段进入草稿，只有用户按Enter才发送；slash与Tab补全提供命令入口',
box(0,15,385,237,C.white,C.ink)+t(24,63,'剪贴板',33,C.ink,650)+ls(24,126,['if (value) {','  return result','}'],30,C.muted,400,'start',47,true)+
line('M403 139H545',C.green,true)+t(473,90,'整块粘贴',29,C.green,600,'middle')+
box(566,15,386,237,C.greenBg,C.green)+t(590,63,'输入缓冲区',33,C.green,650)+ls(590,126,['保留换行','仍可移动、删除','等待你明确提交'],30,C.ink,400,'start',45)+
line('M758 254V315H473',C.green,true)+chip(223,292,256,'Enter：发送')+
line('M0 399H951',C.line)+
t(0,459,'常用输入操作',36,C.ink,650)+
[[35,512,'Ctrl-J','插入换行'],[502,512,'↑ ↓','多行移动 / 输入历史'],[35,635,'/ + Tab','发现与补全命令'],[502,635,'Home / End','当前行首尾']].map(([x,y,a,b])=>box(x,y,414,96,C.white,C.line)+t(x+21,y+39,a,30,C.red,650,'start',true)+t(x+21,y+79,b,28,C.ink)).join('')),
'bracketed paste 把粘贴识别为完整片段。按键含义还受焦点影响；审批与人工终端使用自己的输入规则。',['C04','R05']);

page('15-details.html','详情与尺寸','默认看摘要，\n需要时再展开证据','有限的屏幕里，让关键状态与当前输入始终可达。',svg('工具摘要展开保留的参数和结果，超长内容会截短；终端缩窄时重排并保留中文与emoji草稿',
box(0,7,952,100,C.ink,C.ink)+t(26,68,'✓ read_file · call-3 · 已完成 · 12ms',33,C.paper,650)+
line('M476 110V163',C.green,true)+chip(324,173,303,'Ctrl-O 展开详情')+
box(0,253,952,235,C.white,C.green)+t(28,306,'保留的参数 / 执行结果',32,C.green,650)+ls(28,365,['path: src/main.ts','读取结果…… [超长内容已截短]','模型会话由 Core 管理'],29,C.ink,400,'start',45,true)+
line('M0 536H951',C.line)+
box(0,578,490,157,C.ink,C.ink)+ls(25,629,['100 列 · 运行中','草稿 › 检查中文与 🙂'],29,C.paper,400,'start',55)+
line('M505 651H590',C.green,true)+
box(609,578,342,157,C.ink,C.ink)+ls(633,621,['44 列 · 运行中','草稿 › 检查中文','与 🙂'],27,C.paper,400,'start',42)),
'详情按 PgUp / PgDn 滚动。窗口变化后按显示宽度重排；中文和 emoji 不按字符串长度裁剪，外部控制码转为可见文字。',['C04','C08','R05']);

page('16-handoff.html','人工终端','交给人操作时，\nTUI 先让出键盘和屏幕','模型发起时先做权限判断，再请求人工交接。',svg('模型发起先做权限判断，权限允许后人工确认交接；普通TUI暂停绘制和输入交给人工PTY，结束后恢复',
box(0,19,952,91,C.soft,C.ink)+t(476,76,'模型发起：权限判断 → 人工交接确认',36,C.ink,650,'middle')+
line('M476 113V170',C.amber,true)+
box(0,183,367,317,C.white,C.line)+t(183,242,'Agent TUI',37,C.ink,700,'middle')+ls(183,321,['暂停输入监听','暂停界面重绘','保存草稿'],33,C.muted,400,'middle',65)+
line('M382 337H571',C.amber,true)+t(476,283,'独占交接',30,C.amber,650,'middle')+
box(586,183,366,317,C.ink,C.ink)+t(769,242,'Human PTY',37,C.paper,700,'middle')+ls(769,321,['人直接输入','人查看终端正文','结束后退出'],33,C.paper,400,'middle',65)+
line('M769 503V575H183V509',C.green,true)+t(476,559,'恢复终端模式、重绘、归还草稿',30,C.green,650,'middle')+
box(0,646,952,126,C.redBg,C.red)+t(31,694,'模型只收到终端状态摘要',36,C.red,650)+t(31,743,'人工输入、密码和完整终端正文不进入模型对话。',30,C.ink)),
'权限可自动允许，不保证出现两次弹窗。直接输入 /terminal 只做人机交接确认。交接期间 Ctrl-C 等字节属于人工终端规则。',['C05','C07']);

page('17-practice.html','动手跟练','拒绝一次，批准一次，\n再取消一次等待','用本地固定模型响应，稳定复现完整交互。',
`<div class="terminal" data-block><p class="mini">仓库根目录 · 不需要 API key</p><pre>pnpm install --frozen-lockfile\npnpm build\nnode scripts/e03-s003-runtime-demo.mjs --tui</pre></div>`+
svg('输入重复会出现两个write_file审批，先拒绝first后批准second；输入慢速可编辑草稿并取消；输入终端练习交接',
[[60,30,'重复',['第一份按 n，第二份按 y。','first.txt 不生成；second.txt 写入。'],'amber'],[60,218,'慢速',['等待模型时编辑下一条草稿。','Ctrl-C 取消，结束后再发送。'],'red'],[60,405,'终端',['权限允许后，确认人工接管。','输入虚构文本，退出后继续聊天。'],'green']].map(([x,y,a,b,tone],i)=>num(x,y+28,i+1)+t(x+57,y+40,a,38,C[tone],700)+ls(x+57,y+96,b,31,C.ink,400,'start',48)).join(''),574),
'演示经过生产 CLI、SDK 和工具，模型内容来自本地夹具。退出后临时目录删除；更多步骤见源码入口里的 follow-along.md。',['C07'],'practice');

page('18-next.html','本课完成什么','把执行过程，\n变成可以持续使用的产品','E03-S003 · 运行状态与 TUI',svg('本课把运行事件、状态界面和用户控制连成闭环，下一课在此基础上保存会话并恢复',
[[130,132,'运行事实','事件与身份'],[804,132,'可见界面','状态与工具'],[475,393,'用户控制','审批与取消']].map(([x,y,a,b])=>ring(x,y,85,'#314035','#81917E')+t(x,y+6,a,34,C.paper,700,'middle')+t(x,y+145,b,30,'#C4CDBF',400,'middle')).join('')+
line('M226 134H706','#C9CDC2',true)+line('M771 232L563 363','#C9CDC2',true)+line('M390 363L165 232','#C9CDC2',true)+
box(0,592,952,190,C.paper,C.paper)+t(28,643,'下一课 · E03-S004',31,C.green,650)+t(28,705,'会话落盘与恢复',47,C.ink,700)+t(28,756,'让今天的对话，在下次启动后还能继续。',32,C.ink)),
'本课事件与会话仍在当前进程中。可见状态不等于永久日志，取消也不等于回滚；持久化将在下一课实现。',['C01','C06'],'dark');

for(const [i,p] of pages.entries()){
 const number=String(i+1).padStart(2,'0');
 const header=`<header class="page-header"><span>Zero2Agent · ${p.section}</span><span class="page-number">${number}</span></header>`;
 const heading=`<div class="heading" data-block><h1>${esc(p.title).replaceAll('\n','<br>')}</h1><p class="deck" data-prose>${esc(p.deck)}</p></div>`;
 const content=`<div class="content">${p.body}${p.note?`<p class="explain" data-block data-prose>${esc(p.note)}</p>`:''}</div>`;
 const inner=i===0?`<div class="cover-frame">${header}${heading}${content}<div class="cover-tags"><span>工程实战</span><span>交互设计</span><span>开源课程</span></div></div>`:header+heading+content;
 fs.writeFileSync(p.file,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080"><title>${esc(p.title.replaceAll('\n',''))}</title><link rel="stylesheet" href="course.css"></head><body><main class="sheet ${p.extra}" data-page="${number}">${inner}</main></body></html>\n`);
}
fs.writeFileSync('pages.json',JSON.stringify({title:'Zero2Agent · E03-S003 运行状态与 TUI',date:'2026-10-07',draft:false,publicationStatus:'unpublished',width:1080,height:1440,maxImages:18,edition:'v1-runtime-tui',pages:pages.map((p,i)=>({file:p.file,title:p.title.replaceAll('\n',''),number:i+1,sources:p.sources}))},null,2)+'\n');
