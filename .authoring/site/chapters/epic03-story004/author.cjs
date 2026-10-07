// E03-S004 editable diagrams. Generated through pnpm site:build; no external assets.
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

page('01-cover.html','会话落盘与恢复','关掉程序，\n下次还能接着聊','E03-S004 · 把对话带过进程的终点',svg('上方终端保存识别码，中间磁盘文件跨过进程关闭的断点，下方新终端恢复同一会话并继续回答',
smallTerminal(0,15,952,208,['你 › 记住 ALPHA-42','Agent › 已记住。'],'会话 7b2a… · 已保存 r2')+
line('M211 225V301H360',C.green,true)+doc(405,272,121,147,'green')+t(603,325,'会话文件',37,C.green,700)+t(603,378,'历史 + 已采用摘要',28,C.muted)+
line('M0 449H952',C.red,false,'10 10')+box(290,420,370,57,C.paper,C.paper,0)+t(475,460,'进程结束 / 重新启动',31,C.red,650,'middle')+
line('M466 425V514',C.green,true)+
smallTerminal(0,527,952,214,['你 › 刚才的识别码是什么？','Agent › ALPHA-42。'],'新进程 · 恢复同一个会话 UUID')),
'图中对话是离线跟练的教学重排。保存让历史跨进程存在；恢复后仍要用当前配置重新运行。',['D01','S04'],'cover');

page('02-lifetimes.html','问题从哪里来','文件还在，\n为什么 Agent 却忘了？','文件系统与进程内存，有不同的寿命。',svg('两条时间线：文件跨越退出边界继续存在，messages数组随旧进程结束，新进程得到空数组',
t(0,55,'昨天',35,C.ink,700)+t(788,55,'今天',35,C.ink,700)+
line('M475 90V735',C.red,false,'8 10')+t(475,780,'退出 → 重启',32,C.red,650,'middle')+
t(0,180,'文件',37,C.green,650)+doc(54,222,94,124,'green')+line('M180 284H752',C.green,true)+doc(803,222,94,124,'green')+t(176,258,'修改结果留在磁盘',32,C.green,600)+
t(0,450,'会话',37,C.ink,650)+box(0,493,369,167,C.white,C.ink)+ls(28,546,['messages = […]','问题、回答、工具结果'],29,C.ink,400,'start',55,true)+
line('M384 573H446',C.red)+t(475,590,'×',58,C.red,700,'middle')+
box(584,493,368,167,C.redBg,C.red)+ls(612,546,['messages = []','模型缺少昨天的观察'],29,C.ink,400,'start',55,true)),
'重新读取文件只能看到当前结果，不能自动还原讨论理由、拒绝过的操作或已验证的证据。',['S01']);

page('03-three-views.html','先分清三种东西','历史、上下文、运行状态，\n不能装进同一个文件','保存一段对话，不等于保存整个程序。',svg('原始历史像账本，工作上下文由摘要与近期消息组成，运行状态包含终端审批与在途任务，三者寿命和用途不同',
doc(17,43,130,167,'ink')+t(198,83,'原始历史',43,C.ink,700)+t(198,138,'当时问了什么，工具实际返回什么',31,C.muted)+line('M0 244H952',C.line)+
box(18,299,141,66,C.greenBg,C.green)+t(89,343,'摘要',31,C.green,650,'middle')+box(18,386,141,66)+t(89,430,'近期',31,C.ink,650,'middle')+
t(198,330,'工作上下文',43,C.green,700)+ls(198,390,['这一次发给模型的消息','摘要 + 保留的问题 + 未覆盖历史'],31,C.muted,400,'start',48)+line('M0 513H952',C.line)+
ring(88,640,64,C.redBg,C.red)+line('M89 590V640L123 658',C.red)+t(198,609,'运行对象',43,C.red,700)+ls(198,669,['HTTP、AbortController、PTY、审批','重启后重新建立'],31,C.muted,400,'start',48)),
'本课保存 raw messages 与已采用的 summary/through；不保存屏幕、输入草稿、未完成 Promise 或正在运行的进程。',['S01','S02','S04']);

page('04-research.html','源码启发','记录方式可以不同，\n恢复边界必须清楚','2026-10-07 · 两个固定源码版本的对照。',svg('左侧Codex为连续JSONL记录加flush边界，右侧Gemini为自动记录到会话浏览器，下方说明本课选择全量快照',
t(0,55,'Codex',42,C.ink,700)+t(520,55,'Gemini CLI',42,C.ink,700)+line('M476 25V610',C.line)+
[129,195,261,327].map((y,i)=>box(0,y,430,49,i===3?C.greenBg:C.white,C.line,0)+t(21,y+33,`{ rollout item ${i+1} }`,27,C.ink,500,'start',true)).join('')+
line('M15 418H416',C.green)+t(215,472,'flush / persist',31,C.green,650,'middle',true)+t(215,538,'追加记录与恢复列表',29,C.muted,500,'middle')+
smallTerminal(521,129,431,251,['/resume','› 昨天的对话','  今天的检查'],'会话浏览器入口')+
t(736,473,'JSONL + 原子重写',30,C.green,650,'middle')+t(736,538,'不可读旧文件保留取证',29,C.muted,500,'middle')+
box(0,660,952,111,C.soft,C.ink)+t(30,708,'本课：用完整 JSON 快照讲清恢复',34,C.ink,650)+t(30,749,'更容易核对一致性；接受重复存储的成本。',29,C.muted)),
'证据来自固定源码阅读，未实测这两个构建的模型任务。生产产品包含更多日志、索引和迁移能力。',['R01','R02']);

page('05-boundary.html','数据边界','打开行李箱：\n哪些东西需要带到下次？','显式选择字段，让每个恢复承诺都可检查。',svg('中央快照文件接收消息、摘要、身份和未结算标记；右侧运行资源被阻止序列化',
[[95,'完整消息与工具回执'],[260,'已采用摘要 + through'],[425,'UUID / cwd / 时间'],[590,'revision / pending']].map(([y,s])=>t(0,y,s,32,C.ink,600)+line(`M346 ${y-10}H411`,C.green,true)).join('')+
box(434,42,221,632,C.greenBg,C.green)+doc(484,109,120,151,'green')+t(546,342,'snapshot',32,C.green,700,'middle',true)+t(546,415,'version: 1',28,C.ink,500,'middle',true)+t(546,514,'只装数据',33,C.green,650,'middle')+
ls(740,130,['客户端','审批决定','旧进程','配置密钥','后台作业'],32,C.red,600,'start',99)+line('M693 55V676',C.red)+t(681,744,'运行资源重新建立',32,C.red,650,'middle')),
'对话里用户或工具主动提供的正文仍会保存。宿主不额外序列化 API key；人工终端的私密输入、输出也不采集。',['S01','S03','S04']);

page('06-directory.html','磁盘结构','一个工作目录，\n一组自己的会话','用 realpath 统一路径，再用 SHA-256 分组。',svg('目录树展示用户会话根目录下工作区哈希，再按UUID分目录，每个数字JSON是完整发布快照，点开头临时文件忽略',
box(0,12,952,674,C.ink,C.ink,12)+ls(30,69,['~/.zero2agent/sessions/','└─ <工作区哈希>/','   ├─ <会话 UUID A>/','   │  ├─ 1.json  ← pending','   │  ├─ 2.json  ← 已结算','   │  └─ .pending-…  ← 忽略','   └─ <会话 UUID B>/','      └─ 1.json'],30,C.paper,400,'start',75,true)+
chip(0,718,296,'目录 0700')+chip(327,718,296,'文件 0600')+chip(656,718,296,'单份 ≤ 32 MiB','amber')),
'ZERO2AGENT_SESSION_DIR 可改根目录。会话仍按当前真实 cwd 隔离；本课不做跨工作区导入，也不把文件权限当成加密。',['S03']);

page('07-save-twice.html','保存时机','一轮对话，\n为什么要保存两次？','先留下“正在做”，再记录“做完了什么”。',svg('时间轴上先发布r3 pending，随后模型工具运行，最后发布r4完整结果并开放下一轮；正常失败取消均经过结算保存',
line('M75 84V726',C.ink,true)+
[[113,'发布 r3','旧历史 + pending','还没有调用模型',C.green],[309,'执行当前轮','模型 / 审批 / 工具','可能产生文件或进程效果',C.ink],[505,'发布 r4','配对后的新历史','清除 pending，显示已保存',C.green],[657,'下一轮','重新开放发送','草稿在等待期间保留',C.ink]].map(([y,a,b,c,color],i)=>num(75,y,i+1)+t(131,y+12,a,38,color,700)+t(382,y+4,b,34,C.ink,600)+t(382,y+55,c,29,C.muted)).join('')+
line('M289 366H330V503',C.red,true)+t(21,768,'正常完成 / 取消 / 失败：都要记录已结算结果。',31,C.red,600)),
'开始前保存失败，本轮不调用模型。结算后保存失败，工具效果不会回滚；界面保留内存并提示尚未保存。',['S04','T01']);

page('08-publish.html','完整发布','先写完字节，\n再让读取者看见文件','写到一半的 JSON，不应该成为可恢复版本。',svg('临时文件经过写入和fsync才独占链接为下一个revision，读取者只扫描数字JSON，临时文件不会被选中',
smallTerminal(0,12,952,146,['当前最新版本：4.json'],'读取者只看已发布的数字文件')+
[80,380,680].map((x,i)=>doc(x,244,137,175,i===2?'green':'ink')).join('')+
ls(148,470,['写临时文件','完整 JSON'],30,C.ink,600,'middle',47)+ls(448,470,['fsync','同步文件数据'],30,C.ink,600,'middle',47)+ls(748,470,['独占发布','link → 5.json'],30,C.green,650,'middle',47)+
line('M235 329H357',C.ink,true)+line('M535 329H657',C.green,true)+
line('M748 545V622H126',C.green,true)+t(178,676,'只在发布成功后更新内存 revision',33,C.green,650)+t(178,740,'临时文件清理失败，不重报“提交失败”。',29,C.muted)),
'同文件系统 hard link 保证目标已存在时不覆盖。目录 fsync 尽力执行；不能把本机验证扩大为所有文件系统的断电保证。',['S03']);

page('09-concurrency.html','两个写入者','都从 r4 出发，\n谁能发布 r5？','把冲突拦在模型和工具执行之前。',svg('两个进程都读取r4后争抢同一个r5路径，A独占发布成功后运行，B收到EEXIST保留内存且不请求模型',
t(36,62,'进程 A',38,C.green,700)+t(710,62,'进程 B',38,C.red,700)+
line('M140 92V742',C.green)+line('M812 92V742',C.red)+
chip(25,116,231,'读取 r4')+chip(697,116,231,'读取 r4','amber')+
box(327,265,300,98,C.ink,C.ink)+t(477,327,'发布 5.json',35,C.paper,650,'middle',true)+
line('M140 290H314',C.green,true)+t(220,250,'先到',29,C.green,600,'middle')+line('M812 336H642',C.red,true)+t(731,309,'后到',29,C.red,600,'middle')+
chip(25,456,231,'成功：继续')+chip(697,456,231,'冲突：停止','red')+
ls(141,602,['可以请求模型','开始新工具'],31,C.green,650,'middle',53)+ls(811,602,['保留内存','不覆盖磁盘'],31,C.red,650,'middle',53)+t(476,770,'恢复空闲历史可以并行；下一版本只有一个发布者。',29,C.muted,500,'middle')),
'如果磁盘仍是 pending，而且旧 PID 存活，本课直接拒绝恢复。不会抢占、杀死或重新建立旧进程。',['S03','S04','T01']);

page('10-crash.html','崩溃现场','消息没保存完，\n文件却可能已经改了','“没有结算记录”不能推导出“没有副作用”。',svg('时间带显示r3 pending、工具写文件、进程被杀死，r4未发布；文件效果仍在，恢复只读取上次结算历史并提醒',
box(0,25,952,89,C.ink,C.ink)+t(30,83,'r3 pending → write_file → SIGKILL',34,C.paper,650,'start',true)+
line('M237 134V230',C.green,true)+line('M747 134V230',C.red,true)+
doc(170,252,137,178,'green')+t(238,492,'effect.txt',34,C.green,650,'middle',true)+t(238,550,'磁盘修改已经发生',31,C.ink,600,'middle')+
box(575,252,338,178,C.redBg,C.red,8,'10 8')+t(744,327,'r4 未发布',38,C.red,700,'middle')+t(744,387,'这一轮结果未知',29,C.ink,500,'middle')+
line('M477 610V663',C.red,true)+box(0,679,952,91,C.amberBg,C.amber)+t(476,735,'恢复旧历史 + 中断提醒，继续前检查工作区。',32,C.amber,650,'middle')),
'真实 PTY 验收在工具写完后 SIGKILL。恢复请求保留前一轮内容与 Harness 提醒，未重放中断轮的旧调用。',['S04','T02']);

page('11-pairs.html','消息一致性','工具调用与结果，\n恢复时必须成对出现','否则模型看到的历史，会停在一次没有回答的调用上。',svg('assistant tool_use A与user tool_result A形成完整配对；摘要边界只能在整对之后，不能切在中间；错ID被拒绝',
box(0,38,952,154,C.white,C.ink)+t(28,91,'assistant',30,C.muted,500,'start',true)+t(28,151,'tool_use · id: A',38,C.ink,650,'start',true)+
line('M100 205V362',C.green,true)+t(157,272,'同一个 tool_use_id',34,C.green,650,'start',true)+
line('M500 309H935',C.red,false,'8 9')+t(571,276,'× 不能在这里切摘要',30,C.red,650)+
box(0,380,952,154,C.greenBg,C.green)+t(28,433,'user',30,C.green,500,'start',true)+t(28,493,'tool_result · tool_use_id: A',35,C.ink,650,'start',true)+
line('M0 598H951',C.green,false,'9 9')+t(476,655,'✓ 完整一对之后，才是可恢复边界',35,C.green,650,'middle')+t(476,748,'缺结果、错 ID、重复结果 → 校验失败，当前会话保留。',30,C.muted,500,'middle')),
'校验先完成，再一次性替换 Session。历史中的工具名称和参数只作为数据，恢复函数不会执行它们。',['S01','T01']);

page('12-context.html','压缩后重启','完整历史留在磁盘，\n请求仍使用压缩后的上下文','保存摘要时，也要保存它覆盖到哪里。',svg('上方原始消息0到5中前三条被摘要覆盖，through=3；下方恢复的工作上下文由摘要、最新真实问题和剩余消息组成，临时正文引用重新计算',
t(0,49,'原始历史 · 完整保留',35,C.ink,700)+
[0,1,2,3,4,5].map((n)=>box(n*160,92,143,140,n<3?C.greenBg:C.white,n<3?C.green:C.line)+t(n*160+71,174,`m${n}`,38,n<3?C.green:C.ink,650,'middle',true)).join('')+
line('M0 262H461',C.green)+t(230,310,'summary 覆盖的前缀',32,C.green,650,'middle')+t(718,310,'through = 3',32,C.ink,650,'middle',true)+
line('M229 336V414',C.green,true)+line('M716 336V414',C.ink,true)+
box(0,433,952,157,C.ink,C.ink)+t(26,488,'恢复后的工作上下文',34,C.paper,650)+t(26,548,'摘要 + 保留的用户问题 + m3 / m4 / m5',32,C.paper,500)+
t(0,678,'丢弃临时替换和未采用作业',35,C.red,650)+t(0,739,'按当前模型预算，重新计数、裁剪或压缩。',31,C.muted)),
'图为边界示意。最新真实用户问题若位于摘要覆盖区，仍会保留。磁盘恢复不依赖上个进程生成的临时正文文件。',['S01','S02','T02']);

page('13-validate.html','恢复事务','先确认整份快照可用，\n再替换眼前的对话','坏文件不应该让正在进行的会话一起丢失。',svg('候选快照经过版本身份工作区和消息配对四步验证，全部通过才替换当前会话，任一失败沿红线返回当前会话保持原样',
doc(12,39,106,139,'ink')+t(166,91,'候选文件',37,C.ink,700)+t(166,151,'读最新已发布 revision',30,C.muted)+
[[270,'01','版本 / 身份','是否支持，UUID 是否匹配'],[407,'02','工作目录','是否属于当前 realpath'],[544,'03','消息 / 摘要','结构、配对、through 是否完整']].map(([y,n,a,b])=>num(65,y,n)+t(124,y+10,a,35,C.ink,650)+t(465,y+10,b,30,C.muted)+line(`M64 ${y+34}V${y+97}`,C.green,true)).join('')+
box(16,690,555,85,C.greenBg,C.green)+t(293,745,'全部通过 → 替换 Session',33,C.green,650,'middle')+
line('M925 232V623H780V662',C.red,true)+box(609,678,343,97,C.redBg,C.red)+t(780,739,'失败：保留当前对话',29,C.red,650,'middle')),
'最高 revision 损坏时直接报错，不静默回退旧版本。否则使用者可能丢失对较新副作用的认识。',['S01','S03','S04']);

page('14-picker.html','交互入口','从“知道 UUID”，\n到“能找到昨天的会话”','/sessions 打开列表；恢复动作始终由你选择。',svg('会话选择器示意有标题UUID更新时间和未结算标签，下方说明列表独占键盘焦点且Esc返回草稿',
smallTerminal(0,10,952,426,['● zero2agent · 选择会话','','› 修复空文件的读取逻辑','  7b2a… · 2026-10-07 14:20','  检查终端退出 [未结算]','  a904… · 2026-10-06 18:05'],'↑↓ 选择  ·  Enter 恢复  ·  Esc 返回')+
line('M242 447V528',C.green,true)+line('M712 447V528',C.amber,true)+
t(242,578,'Enter：切换历史',35,C.green,650,'middle')+t(712,578,'Esc：回到草稿',35,C.amber,650,'middle')+
box(0,640,952,127,C.white,C.line)+t(31,691,'列表占用焦点时，输入不会变成聊天消息。',33,C.ink,650)+t(31,740,'原草稿保留，恢复后的旧工具可展开查看。',30,C.muted)),
'教学重排，UUID 在实际列表中完整显示。运行中的对话不会被选择器打断；审批与人工终端继续使用自己的输入所有权。',['S05','T02']);

page('15-commands.html','命令入口','TUI、plain、单次调用，\n接到同一份会话逻辑','自动保存行为一致，呈现方式适应各自的终端。',
`<div class="terminal" data-block><p class="mini">生产 CLI · 需要当前模型配置才能续聊</p><pre>zero2agent --list-sessions\nzero2agent --resume &lt;UUID&gt;\nzero2agent --continue "接着讨论"\nzero2agent --no-save</pre></div>`+
svg('命令映射中sessions负责列表resume负责恢复new新建save重试session查看状态；底部强调不恢复时默认新会话',
[[42,'/sessions','浏览当前工作区会话'],[135,'/resume UUID','恢复指定会话'],[228,'/new','新对话；旧记录仍在'],[321,'/session /save','查看身份 / 重试保存']].map(([y,a,b])=>t(0,y,a,32,C.red,650,'start',true)+t(385,y,b,32,C.ink,500)+line(`M0 ${y+34}H952`,C.line)).join('')+t(0,435,'默认启动新会话；明确选择后才恢复。',35,C.green,650),470),
'列表无需 API key。--no-save 为临时会话，不能同时恢复或列出；--plain、管道和 --terminal 入口继续保留。',['S05','T02'],'practice');

page('16-failure.html','保存失败','一份内存，两种状态：\n已保存，或仍待处理','不要把输出回答，误当成磁盘已经写入。',svg('内存完整历史保存到磁盘时分成功失败两路，成功开放新轮，失败保留内存提示未保存并允许save重试；切换前也需要flush',
box(157,9,638,112,C.ink,C.ink)+t(476,79,'内存中：这一轮已结算',40,C.paper,650,'middle')+
line('M476 125V204',C.ink,true)+ring(476,280,73,C.white,C.ink)+t(476,291,'保存',35,C.ink,650,'middle')+
line('M392 281H188V408',C.green,true)+line('M560 281H765V408',C.red,true)+t(223,250,'成功',31,C.green,650)+t(650,250,'失败',31,C.red,650)+
box(0,427,381,167,C.greenBg,C.green)+ls(190,487,['已保存 r4','可以发送下一轮'],34,C.green,650,'middle',62)+
box(572,427,380,167,C.redBg,C.red)+ls(762,487,['尚未保存','内存仍然保留'],34,C.red,650,'middle',62)+
line('M765 600V682H483V374',C.amber,true)+t(739,735,'排除原因后 /save 重试',30,C.amber,650,'middle')+t(0,743,'切换前也要保存。',30,C.muted)),
'磁盘满、权限错误、版本冲突分别处理。冲突不能靠盲目重试解决；正常退出保存失败会保留界面，崩溃与外部信号不能保证如此。',['S04','T01']);

page('17-compatibility.html','交互兼容','恢复会话之后，\n以前的操作仍然可用','新增一个入口，也要检查所有既有输入路径。',svg('四条交互轨道把已有功能和本课约束逐一对应，编辑草稿、审批、人工终端和普通CLI都接入同一个控制器',
[[88,'编辑与草稿','多行粘贴 / 历史 / Unicode','列表关闭后归还草稿','green'],[267,'权限与取消','本次审批 / Ctrl-C 取消','当前策略生效；先收尾再发送','amber'],[446,'终端与交接','前台转后台 / 人工 PTY','私密字节不入历史与磁盘','red'],[625,'CLI 兼容','--plain / 单次消息 / 管道','同一控制器负责自动保存','green']].map(([y,a,b,c,tone],i)=>num(26,y,i+1)+t(81,y+10,a,36,C[tone],700)+t(81,y+64,b,29,C.muted)+line(`M451 ${y+22}H498`,C[tone],true)+t(528,y+31,c,29,C.ink,600)+line(`M0 ${y+112}H952`,C.line)).join('')),
'上一课完整交互回归继续执行；恢复后的新写入仍由当前权限决定。看到历史“已允许”，不等于得到新的执行许可。',['S05','T02']);

page('18-practice.html','动手跟练','让两个进程，\n共享同一个对话事实','本地演示不需要 API key；读写路径使用生产代码。',
`<div class="terminal" data-block><pre>pnpm install --frozen-lockfile\npnpm build\nnode scripts/e03-s004-session-demo.mjs</pre></div>`+
svg('三个编号步骤展示A保存识别码退出，B列出会话，新进程恢复并询问没有复述识别码的问题；最后核对请求正文',
[[55,'A 保存并退出','“请记住 ALPHA-42。”'],[218,'B 找到会话 UUID','列表能看到标题与更新时间。'],[381,'恢复后再询问','“刚才的识别码是什么？”']].map(([y,a,b],i)=>num(35,y,i+1)+t(91,y+12,a,36,C.ink,700)+t(91,y+72,b,32,C.muted)).join('')+t(35,527,'核对请求正文，再看实际回答。',35,C.green,650),562),
'加 --tui 可体验会话选择器；演示结束后删除临时目录。真实服务补验另有记录，离线夹具通过不等于真实模型通过。',['D01','T02','T03'],'practice');

page('19-costs.html','本课取舍','完整快照很直观，\n长期存储需要后续治理','保留旧版本，换来可检查性，也带来磁盘成本。',svg('不同轮次的完整快照包含越来越长历史，所有revision保留所以总占用增长；右侧列出32MiB限制本地硬链接及未覆盖能力',
t(0,43,'每份都是完整历史',35,C.ink,700)+
[[123,168,'第 1 轮'],[251,292,'第 2 轮'],[379,416,'第 3 轮']].map(([y,w,label])=>t(0,y,label,30,C.muted)+box(0,y+25,w,51,C.greenBg,C.green,0)).join('')+
t(0,552,'示意：轮数增加，',31,C.muted)+t(0,604,'新快照通常更大。',31,C.muted)+
line('M482 80V644',C.line)+ls(530,141,['每轮通常新增 2 份','单份上限 32 MiB','旧 revision 不自动删除','仅本地 hard link 协议','未承诺跨主机恢复'],31,C.ink,550,'start',99)+
box(0,694,952,85,C.amberBg,C.amber)+t(476,749,'后续：保留策略、追加日志、逐工具恢复。',33,C.amber,650,'middle')),
'图是定性说明，不是性能测试数据。当前实测平台为 macOS；Windows、网络文件系统与断电故障没有实机验证。',['S03','S04']);

page('20-next.html','本课完成什么','今天的对话，\n成为下次运行的起点','会话保存了可继续的上下文，也明确了不能恢复的部分。',svg('保存到恢复再续聊三步闭环，下方区分下一课日志追查与后续文件回退',
[[142,'保存','完整发布'],[477,'恢复','先校验'],[811,'续聊','当前策略']].map(([x,a,b])=>ring(x,185,96,C.greenBg,C.green)+t(x,191,a,46,C.green,700,'middle')+t(x,345,b,33,C.ink,650,'middle')).join('')+
line('M249 184H370',C.green,true)+line('M584 184H704',C.green,true)+
line('M811 392V467H142V392',C.green,true)+t(476,451,'每一轮再次结算、保存',32,C.green,650,'middle')+
box(0,548,952,231,C.ink,C.ink)+t(29,607,'下一课 · E03-S005',31,C.paper,650)+t(29,673,'运行日志与问题追查',45,C.paper,700)+t(29,735,'解释出了什么问题，再为文件回退建立依据。',30,C.paper)),
'恢复对话、追查日志、回退文件是不同能力。它们共享运行事实，但不能互相替代。',['S04']);
for(const [i,p] of pages.entries()){
 const number=String(i+1).padStart(2,'0');
 const header=`<header class="page-header"><span>Zero2Agent · ${p.section}</span><span class="page-number">${number}</span></header>`;
 const heading=`<div class="heading" data-block><h1>${esc(p.title).replaceAll('\n','<br>')}</h1><p class="deck" data-prose>${esc(p.deck)}</p></div>`;
 const content=`<div class="content">${p.body}${p.note?`<p class="explain" data-block data-prose>${esc(p.note)}</p>`:''}</div>`;
 const inner=i===0?`<div class="cover-frame">${header}${heading}${content}<div class="cover-tags"><span>工程实战</span><span>交互设计</span><span>开源课程</span></div></div>`:header+heading+content;
 fs.writeFileSync(p.file,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080"><title>${esc(p.title.replaceAll('\n',''))}</title><link rel="stylesheet" href="course.css"></head><body><main class="sheet ${p.extra}" data-page="${number}">${inner}</main></body></html>\n`);
}
fs.writeFileSync('pages.json',JSON.stringify({title:'Zero2Agent · E03-S004 会话落盘与恢复',date:'2026-10-07',draft:false,publicationStatus:'unpublished',width:1080,height:1440,maxImages:20,edition:'v1-session-persistence',pages:pages.map((p,i)=>({file:p.file,title:p.title.replaceAll('\n',''),number:i+1,sources:p.sources}))},null,2)+'\n');
