// Editable E04-S002 diagrams. Facts are traceable through sources.md.
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

page('cover','大工具结果按需读取','保存大结果，按需取证','E04-S002 · 几十万字日志，只取需要的那一段。',svg('教学示意：大日志存一份，模型只收引用，按范围取回末尾证据',
file(0,15,380,320,'完整日志',['synthetic-log-entry …','… 约 300 KB …','EVIDENCE=RESULT-…'])+
path('M405 174H583','red',true)+t(618,134,'引用',46,C.red,700)+t(618,194,'大小 · 来源 · 校验',27,C.muted)+
path('M722 241V421H435','green',true)+rect(0,395,405,123,C.greenBg)+t(24,444,'只回读末尾 512 字节',30,C.green,700)+t(24,491,'找到随机证据',29)+
rule(582)+t(0,638,'复用落盘 · 有界读取 · 重启后仍可核对',32,C.ink,650)),
'图为机制示意。真实模型验收使用随机证据，答案不在提示词里；读取范围由模型调用工具指定。',['S01','S02','T02']);

page('needle','01 · 从一份日志开始','输出很长，\n问题却很具体','用户只想知道测试最后报告了哪个证据编号。',svg('一份很长的日志折叠，中间重复行淡化，底部证据突出；完整存储与阅读范围区分',
rect(0,0,595,540,C.white,C.line)+t(24,52,'large.log',31,C.ink,700)+rule(80,24,547)+
Array.from({length:8},(_,i)=>t(25,126+i*43,'synthetic-log-entry …',28,i>1&&i<6?'#ABB0A5':C.muted,400,'start',true)).join('')+
rect(17,458,561,62,C.greenBg)+t(30,500,'EVIDENCE=RESULT-…',30,C.green,700,'start',true)+
path('M620 489H690V195H735','green',true)+t(741,110,'只取',32,C.muted)+t(741,227,'512',78,C.green,700)+t(741,300,'字节',30,C.green)+
rule(584)+t(0,638,'完整保留是存储问题；取多少是上下文问题。',32,C.ink,650)),
'案例是合成日志。末尾位置是练习已知条件；如果证据位置未知，需要分段查找，不能保证一次读取就找到。',['T01','T02']);

page('reuse','02 · 与终端那课的区别','已有落盘，\n这一课补读取契约','先确认已有能力，避免再做一遍同样的功能。',svg('三层能力时间线：终端输出收集、上下文缩短、统一结果引用与回读',
path('M33 32V583','ink')+
[[65,'E02-S003','终端输出过长 → 流式写文件','解决一个输出生产者的收集问题。','ink'],[277,'E03-S001','上下文紧张 → 正文换临时路径','原史保留，发送视图变短。','amber'],[489,'E04-S002','引用 → 权限检查 → 按字节回读','终端、文件、搜索共用结果存储。','green']].map(([y,a,b,c,k])=>dot(33,y,11,k)+t(79,y+7,a,31,C[k],700)+t(79,y+69,b,35,C.ink,650)+t(79,y+125,c,29,C.muted)).join('')),
'本课仍复用终端 OutputSink。旧会话的大正文保留原史；新工具的大结果进入历史前就换成引用。',['S01','S02','S03']);

page('receipt','03 · 看懂工具回执','拿到一个引用，\n究竟知道了什么？','引用不包含任意文件路径，也不代表新的授权。',svg('结果回执字段解剖：引用定位、来源归因、大小分页、哈希校验、失效时间决定生命周期',
consoleBox(0,0,952,137,'tool_result_reference · UUID 与哈希在图中缩写',['reference: "a31…"'],31)+
[['source','read_file / source-once','对应哪次真实工具调用'],['bytes','315050','按字节计算尾部偏移'],['sha256','7b4…','检查原正文有没有改变'],['expiresAt','创建时间 + 7 天','明确本地引用何时失效']].map(([a,b,c],i)=>t(0,215+i*109,a,29,C.red,650,'start',true)+t(255,215+i*109,b,30,C.ink,650)+t(255,258+i*109,c,28,C.muted)+rule(282+i*109)).join('')),
'数字是教学示例，UUID 和 SHA-256 不能使用缩写调用工具。真实回执还有 read_tool_result 的起始读取参数。',['S01']);

page('flow','04 · 接入循环','保存成功之后，\n才把引用交给模型','结果仍然与原 tool_use_id 配对。',svg('模型工具调用到完整保存、引用进入历史、下轮按需读取的回路，存储与模型分离',
rect(0,0,290,105,C.soft)+t(22,65,'工具执行完成',33,C.ink,700)+path('M322 52H583','ink',true)+rect(612,0,340,105,C.greenBg)+t(636,65,'ResultStore 保存',31,C.green,700)+
path('M786 131V227','green',true)+file(612,252,340,238,'正文 × 1',['私有目录 / 0600','SHA-256 校验'])+
path('M585 297H302','red',true)+rect(0,242,282,118,C.redBg)+t(24,290,'短回执',36,C.red,700)+t(24,336,'同一 tool_use_id',25,C.muted)+
path('M140 388V466','ink',true)+t(0,522,'模型下一轮',34,C.ink,700)+path('M245 509H570','green',true)+t(600,522,'read_tool_result',28,C.green,650,'start',true)+
t(0,635,'每次回读是新工具调用，仍计入本轮运行预算。',30,C.ink,650)),
'保存失败时返回明确错误，说明原工具已经结算。不会把“存储失败”解释为“工具没执行过”。',['S01','S02']);

page('sizes','05 · 限制每次带入的正文','300 KB 的输出，\n不用每轮都重新发送','存储阈值、读取上限、上下文预算是三道检查。',svg('不同数量级的大小条，标注不按比例；完整正文大于20KiB转引用，回读4096字节，再过模型输入预算',
t(0,42,'原始正文 · 示例 300 KB',32,C.ink,700)+rect(0,76,952,94,C.ink)+t(24,137,'保存在本机结果存储',31,C.paper)+
t(0,249,'超过 20 KiB → 新结果换成短引用',33,C.red,700)+path('M470 277V335','red',true)+
rect(0,356,420,97,C.greenBg)+t(23,418,'每页最多 4096 字节',31,C.green,700)+t(481,398,'只读需要的范围',31)+t(481,445,'JSON 转义还会增加长度',27,C.muted)+
rule(515)+t(0,577,'发送前：完整请求再次经过 ContextBudget',30,C.ink,650)+t(0,630,'有界回读降低压力，但不能绕过输入预算。',29,C.muted)),
'条形图不按比例。4096 是正文原始字节上限，不是 token 数，也不是含来源元信息的整份 JSON 长度。',['S01','S02','S03']);

page('utf8','06 · 字节不等于字符','一个“𠮷”字，\n占用四个 UTF-8 字节','返回 next_offset，避免模型自己猜字符边界。',svg('UTF-8字节尺：A占1，中占3，𠮷占4；一个页尾切在四字节字符中时向前收缩',
t(0,54,'正文：A中𠮷B',42,C.ink,700)+
Array.from({length:9},(_,i)=>rect(i*102,108,98,110,i===0||i===8?C.soft:i<4?C.amberBg:C.greenBg)+t(i*102+49,181,String(i),36,C.ink,650,'middle')).join('')+
t(49,271,'A',35,C.ink,650,'middle')+t(253,271,'中',35,C.amber,650,'middle')+t(661,271,'𠮷',35,C.green,650,'middle')+t(865,271,'B',35,C.ink,650,'middle')+
path('M565 330V407','red',true)+t(0,384,'limit = 6 会切进“𠮷”',32,C.red,700)+
rect(0,447,952,124,C.white,C.line)+t(24,496,'实际返回：A中',34,C.green,700)+t(24,548,'next_offset = 4；下一页从完整字符开始。',30)+
t(0,643,'手填 offset 落在字符中间 → INVALID_RESULT_RANGE',27,C.red,650)),
'offset 从 0 开始，limit 必须是 4–4096 的整数。原始终端字节可能不是 UTF-8，此时另附 raw_base64 保留实际字节。',['S01','T03']);

page('tail','07 · 第一次按需读取','已知证据在末尾，\n直接算最后一页','先读回执中的 bytes，再向前取一个有限范围。',svg('尾部读取偏移公式和回执实参，分页器指向文件末端',
t(0,65,'offset = max(0, bytes − 512)',42,C.green,700,'start',true)+
rect(0,117,952,85,C.soft)+rect(726,117,226,85,C.greenBg)+t(23,173,'完整文件',31,C.muted)+t(749,173,'最后 512 字节',26,C.green,650)+
path('M726 225V278','green',true)+consoleBox(0,307,952,246,'read_tool_result · 教学参数',['reference: "完整 UUID"','offset: 314538','limit: 512'],31)+
t(0,624,'检查 untrusted_text，再核对 eof 与 source。',30,C.ink,650)),
'偏移单位是字节。任意尾部偏移可能切入 UTF-8 字符；遇到边界错误可以小幅向前调整，随后沿 next_offset 读取。',['S01','S04']);

page('long-line','08 · 大结果的回读方式','一整行再长，\n也只保留一页在内存里','读取范围按字节控制；校验使用固定大小的流式缓冲。',svg('单行日志通过64KiB验证缓冲，只有选中4096字节进入页响应，其他部分用于哈希',
rect(0,0,952,128,C.ink)+t(24,51,'一个很长的单行结果',32,C.paper,650)+t(24,101,'𠮷single-line𠮷single-line…END-EVIDENCE',27,C.paper,400,'start',true)+
path('M250 157V226','ink',true)+t(0,286,'64 KiB 缓冲',38,C.ink,700)+t(0,337,'流式校验完整 SHA-256',28,C.muted)+
path('M355 272H579','green',true)+rect(615,217,337,139,C.greenBg)+t(638,271,'≤ 4096 字节',34,C.green,700)+t(638,321,'回给模型的这一页',27,C.green)+
rule(425)+ls(0,494,['不再生成第二份 chunks.jsonl。','每次读取会顺序校验整份正文；','省的是返回正文和内存，未承诺常数磁盘 I/O。'],31,C.ink,62)),
'每份正文最多 16 MiB，校验途中也检查取消与文件增长。完整校验有成本；读者应理解这个取舍。',['S01','S03','T03']);

page('permission','09 · 重新检查读取权限','过去读到过，\n不代表现在永远能读','来源路径由 Harness 保存，模型不能替换成另一条路径。',svg('三条权限路径：工作区内只读允许、外部原来源重新审批、显式拒绝不返回正文',
[['工作区内来源','read-only','允许读取结果','green'],['工作区外来源','default','需要当前审批','amber'],['显式 deny 规则','read_tool_result','拒绝返回正文','red']].map(([a,b,d,c],i)=>{
const y=i*184;return t(0,y+44,a,34,C.ink,700)+t(0,y+99,b,28,C.muted,400,'start',true)+path(`M394 ${y+66}H648`,c,true)+tag(685,y+34,267,d,c)+rule(y+146);
}).join('')+t(0,632,'快照保存事实与引用，不保存旧审批。',32,C.ink,650)),
'来源按当时的真实路径记录；删除工作区内的软链接，也不能把外部数据变成内部来源。终端结果的读取不授权执行命令。',['S02','S04','T03']);

page('dedup','10 · 一份正文，多次引用','同样的字节，\n不必保存两份','正文按内容哈希存放，调用身份仍分别记录。',svg('两条不同工具调用结果指向一个SHA256正文，引用与内容不是同一个身份',
rect(0,0,380,162,C.soft)+t(22,53,'调用 A',38,C.ink,700)+t(22,116,'reference = UUID-A',26,C.muted,400,'start',true)+
rect(0,302,380,162,C.soft)+t(22,355,'调用 B',38,C.ink,700)+t(22,418,'reference = UUID-B',26,C.muted,400,'start',true)+
path('M405 83H535V220H585','green',true)+path('M405 383H535V270H585','green',true)+file(615,148,337,285,'正文 × 1',['SHA-256 相同','字节数相同','每次回读都校验'])+
rule(530)+ls(0,595,['去重的是同一会话中的正文；','来源、创建时间和失效时间属于各自引用。'],30,C.ink,52)),
'终端已结束的流式文件通过本地硬链接封存，再删除 pending 名称，不把整份日志读入字符串后重写。',['S01','S02','T03']);

page('lifecycle','11 · 引用的生命周期','过期、丢失、改变，\n是三个不同的事实','明确原因，才能避免错误地重跑原工具。',svg('结果的七天有效窗口时间线，下方给出三种不可读状态的不同解释',
path('M42 96H906','ink',true)+dot(55,96,11,'green')+dot(676,96,11,'red')+rect(66,61,588,69,C.greenBg)+t(86,107,'创建后，默认可读 7 天',34,C.green,700)+t(52,168,'创建',28,C.muted)+t(649,168,'到期',28,C.red,650)+
[['RESULT_EXPIRED','引用超过失效时间'],['RESULT_MISSING','文件被清理或移动'],['RESULT_CHANGED','大小或校验与原记录不同']].map(([a,b],i)=>t(0,283+i*112,a,31,C.red,650,'start',true)+t(0,330+i*112,b,31)+rule(363+i*112)).join('')),
'过期正文在该会话下次保存结果或显式 cleanupExpired 时回收。未再打开的会话目录需手工清理；TTL 不代表后台定时清理。',['S01']);

page('restart','12 · 关掉程序之后','恢复会话，\n需要两部分数据','本机快照中的引用，还要找到对应正文。',svg('会话JSON只存配对历史与引用元信息，正文在结果目录；新进程联接二者但不重放工具',
file(0,0,429,290,'会话 JSON',['调用与结果配对','结果目录身份','引用、来源、SHA-256'])+
file(523,0,429,290,'本机结果目录',['私有正文文件','按工作区与会话隔离','不含旧审批或旧进程'])+
path('M214 321V380H476V432','green',true)+path('M737 321V380H476','green')+
t(251,497,'新 CLI 进程',44,C.green,700)+t(88,559,'校验快照 → 当前权限 → 校验正文 → 回读',32)+
rule(605)+t(0,654,'只复制 JSON 到另一台电脑，不等于迁移了正文。',29,C.red,650)),
'不同工作区恢复会明确拒绝原引用。恢复失败保留当前会话；原工具不因读取需要而自动执行。',['S01','S04','T01']);

page('failure','13 · 保存失败的事实','工具执行成功了，\n磁盘却存不下输出','失败发生在保存结果时，原副作用仍可能已经发生。',svg('工具执行到保存失败的时间线，文件已经改变保留效果，不自动重做',
path('M57 112H910','ink',true)+[[80,'执行工具','green'],[453,'副作用完成','green'],[862,'保存失败','red']].map(([x,a,c])=>dot(x,112,12,c)+t(x,62,a,29,C[c],700,'middle')).join('')+
file(0,234,372,248,'effect.txt',['已修改的内容','仍然保留'])+
consoleBox(438,228,514,248,'Harness 明确报告',['execution settled','RESULT_CAPACITY','do not re-run'],27)+
rule(535)+t(0,597,'下一步核对实际效果，再决定如何继续。',33,C.ink,700)+t(0,650,'“结果无法保存”不能证明“操作从未发生”。',29,C.muted)),
'错误回执仍配对原调用。容量、写入和封存错误都可见；任意 shell 的恢复执行属于后续课程范围。',['S01','S02','T03']);

page('terminal','14 · 终端仍在运行时','文件还在增长，\n不能说它已经完整封存','后台日志与已结算结果有不同的读取语义。',svg('前台结束的输出进入封存引用，后台跳过输出仍为未封存路径，没有固定哈希',
t(0,54,'进程已结算',38,C.green,700)+path('M274 41H425','green',true)+t(469,54,'关闭流 → 封存 → 引用',34,C.green,700)+
rect(0,101,952,141,C.greenBg)+ls(24,153,['有固定字节数和 SHA-256。','取消或 drain 超时的回执仍说明输出可能不完整。'],30,C.ink,53)+
rule(302)+t(0,369,'Ctrl-S 转后台',38,C.amber,700)+path('M335 356H489','amber',true)+t(532,369,'仍在写入',34,C.amber,700)+
rect(0,416,952,143,C.amberBg)+ls(24,468,['回执明确标记 unsealed，保留原日志路径。','读取路径需要当前文件权限；不伪造已完成引用。'],30,C.ink,53)+
t(0,642,'人工终端的私密字节，继续不记录、不发给模型。',29,C.ink,650)),
'后台完成通知沿用既有机制。本课没有把活跃进程变成可恢复任务，也没有将人工输入纳入结果存储。',['S02','S05']);

page('capacity','15 · 给存储设边界','保存大结果，\n也要有容量上限','不能为了节省上下文，把风险转移给磁盘与队列。',svg('单份16MiB、会话64MiB、128引用三项额度，数据流背压与过限排空机制',
[[0,'16','MiB','单份正文'],[332,'64','MiB','会话正文'],[666,'128','条','会话引用']].map(([x,a,b,d])=>t(x,126,a,95,C.red,700)+t(x,207,b,29,C.muted)+t(x,270,d,33,C.ink,650)).join('')+
rule(302)+t(0,364,'终端流：写盘跟不上 → 暂停读取管道',32,C.ink,650)+path('M92 421H861','ink',true)+tag(0,453,245,'stdout / stderr','ink')+tag(356,453,245,'有界写入队列','amber')+tag(708,453,244,'私有正文文件','green')+
ls(0,581,['超过单份容量：继续排空进程，明确输出不完整。','活跃结果不会为了腾空间被静默删除。'],30,C.muted,53)),
'容量也包括执行前的输出预留；短命令结束释放，后台关闭后按实际大小计入。全机所有会话没有总配额。',['S01','S02','T03']);

page('evidence','16 · 用效果验收','正文真的省下了，\n证据也真的读到了','固定响应验证流程；真实模型验证它能使用这套工具。',svg('两类验收表：确定性本地服务与真实模型，分别证明9次请求4进程无重放及模型取得随机证据',
rect(0,0,952,60,C.ink)+t(22,41,'验收层级',29,C.paper,650)+t(340,41,'核对什么',29,C.paper,650)+
t(0,131,'真实 CLI / 本地 SSE',32,C.ink,700)+ls(340,127,['读文件、终端各一套流程。','4 次启动：创建 / 恢复 / 拒绝 / 丢失。','每套 9 次请求，原工具执行 1 次。'],28,C.ink,51)+rule(280)+
t(0,357,'真实模型服务',32,C.green,700)+ls(340,353,['约 300 KB 合成日志，随机答案。','模型先收引用，再回读末尾。','配对结果和最终答案都含证据。'],28,C.ink,51)+rule(512)+
t(0,580,'不能只检查最终一句“我找到了”。',35,C.red,700)+t(0,643,'还要核对调用、结果、文件哈希和发送请求。',29,C.muted)),
'数据来自本课实际验收。确定性服务不冒充真实模型；真实模型测试仅代表当前配置服务与平台。完整原始证据见跟练。',['T01','T02']);

page('practice','17 · 亲手验证','先预测，\n再运行这三个实验','跟练使用生产 CLI 和本地服务，不需要模型密钥。',svg('三道练习：重启回读、权限拒绝、删除正文；命令和预期行为',
consoleBox(0,0,952,230,'在仓库根目录',['pnpm build','pnpm --filter @zero2agent/e2e exec vitest run', '  src/result-references.test.ts'],24)+
[['01','重启后回读','证据仍在，原工具没有再执行。'],['02','增加读取 deny 规则','结果被拒绝，旧审批不继承。'],['03','删除正文文件','明确 RESULT_MISSING，不重跑命令。']].map(([n,a,b],i)=>t(0,278+i*122,n,46,C.red,700)+t(92,275+i*122,a,33,C.ink,650)+t(92,327+i*122,b,28,C.muted)+rule(358+i*122)).join('')+
t(0,654,'下一课：压缩摘要后，还能保住哪些事实？',30,C.green,650)),
'上方后两行是一条命令，完整可复制版本见跟练。先运行离线验收，再选择开启真实模型测试。',['T01','T02','D01']);

if(pages.length!==18) throw new Error('E04-S002 must contain exactly 18 pages including its cover');
for(const [i,p] of pages.entries()) {
 const number=String(i+1).padStart(2,'0');
 const header=`<header class="page-header"><span>Zero2Agent · ${esc(p.section)}</span><span class="page-number">${number}</span></header>`;
 const heading=`<div class="heading" data-block><h1>${esc(p.title).replaceAll('\n','<br>')}</h1><p class="deck" data-prose>${esc(p.deck)}</p></div>`;
 const content=`<div class="content">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div>`;
 const cover=`<div class="cover-frame"><header class="page-header"><span>Zero2Agent · 健壮性与上下文</span><span class="page-number">E04-S002</span></header><div class="series-masthead" data-block><h1 class="series-title">从零到一做 <span>Agent</span></h1><p class="series-description" data-prose>亲手实现 Coding Agent · 开源实战课程</p><h2 class="lesson-title">大工具结果按需读取</h2><p class="lesson-promise" data-prose>几十万字日志，只取需要的那一段。</p></div><div class="series-body">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div><div class="cover-tags"><span>结果引用</span><span>按需读取</span><span>开源课程</span></div></div>`;
 fs.writeFileSync(p.file,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080"><title>${esc(p.title.replaceAll('\n',''))}</title><link rel="stylesheet" href="course.css"></head><body><main class="sheet ${i===0?'cover series-cover':''}" data-page="${number}">${i===0?cover:header+heading+content}</main></body></html>\n`);
}
fs.writeFileSync('pages.json',JSON.stringify({title:'Zero2Agent · E04-S002 大工具结果按需读取',date:'2026-10-11',draft:false,publicationStatus:'unpublished',width:1080,height:1440,maxImages:18,edition:'v1-result-reference',pages:pages.map((p,i)=>({file:p.file,title:p.title.replaceAll('\n',''),number:i+1,sources:p.sources}))},null,2)+'\n');
