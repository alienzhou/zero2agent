// Editable E04-S003 diagrams. Facts are traceable through sources.md.
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

page('cover','摘要质量与事实保留','压缩后，仍按最新事实继续','E04-S003 · 找回原话，核对事实，再继续任务。',svg('用户纠正端口，摘要出现旧值，通过原始来源恢复纠正的教学示意',
rect(0,20,952,154,C.white,C.line)+t(28,77,'D1：端口 8123',36,C.muted)+t(28,137,'D2：改成 9237，禁止部署',38,C.green,700)+
path('M225 201V286','red',true)+path('M725 201V286','green',true)+
rect(0,315,429,158,C.redBg)+t(25,372,'摘要：仍写 8123',33,C.red,700)+t(25,427,'短了，事实却错了',30)+
rect(523,315,429,158,C.greenBg)+t(548,372,'来源：保留 D2 原话',32,C.green,700)+t(548,427,'回查纠正后再继续',30)+
rule(550)+t(0,615,'用后续任务验收摘要，用原始证据核对结论。',31,C.ink,650)),
'机制示意。来源索引帮助找回事实，不替模型证明每个结论；真实质量还要通过固定任务评测。',['S01','S02','E01']);

page('wrong','01 · 一份短摘要的代价','一句旧值，\n会改变后续操作','用户最后只说“继续”，不会重述所有有效要求。',svg('原始事实与错误交接并列，底部指出必须检查实际文件效果',
t(0,47,'原始事实',38,C.green,700)+t(506,47,'错误交接',38,C.red,700)+
[['端口已改为 9237','端口仍是 8123'],['测试返回失败','修复后应该通过了'],['部署尚未获准','下一步部署']].map(([a,b],i)=>t(0,147+i*122,a,33)+t(506,147+i*122,b,33,C.red)+rule(181+i*122)).join('')+
path('M473 84V445','line')+rect(0,492,952,141,C.ink)+t(25,548,'真正的验收：接下来写了什么、调用了什么？',33,C.paper,650)+t(25,598,'“我已记住”不能替代文件内容与工具轨迹。',29,C.paper)),
'这里的错误交接是教学反例。短、格式正确和请求成功，都不足以证明任务事实正确。',['D01','E01']);

page('layers','02 · 站在已有能力上','已经能压缩，\n现在要验证压缩质量','先保住工程约束，再检查模型是否继续做对任务。',svg('四段阶梯：上下文调度、运行预算、结果回读、事实保留',
[['E03-S001','原史与发送视图分离','能在有限窗口里继续会话。'],['E04-S001','请求与运行预算','知道尝试了多少、何时停止。'],['E04-S002','大结果引用与回读','保存证据，按范围取回。'],['E04-S003','摘要质量与事实保留','纠正、状态、来源是否仍然正确。']].map(([a,b,c],i)=>rect(i*30,i*145,952-i*30,126,i===3?C.greenBg:C.white)+t(i*30+20,i*145+45,a,27,i===3?C.green:C.muted,700)+t(i*30+213,i*145+45,b,32,C.ink,650)+t(i*30+213,i*145+96,c,28,C.muted)).join('')),
'本课继续使用现有调度、权限、预算与结果存储。比较时保持相同硬预算，索引额外占用的输入也要计入成本。',['S01','D01']);

page('views','03 · 三份信息，各有用途','原史、交接、\n工作上下文如何连接','只有发送视图被替换，原始事实仍在当前会话里。',svg('原史到模型交接和宿主索引的双分支，再合并新消息为工作上下文',
file(0,0,320,257,'原始对话',['用户纠正','工具调用与结果','assistant 的说法'])+
path('M348 100H461','ink',true)+path('M409 100V338H464','green',true)+
rect(492,0,460,190,C.white,C.line)+t(517,63,'模型交接',37,C.ink,700)+t(517,124,'简短综合，仍需核对',30)+
rect(492,266,460,190,C.greenBg)+t(517,329,'宿主来源索引',37,C.green,700)+t(517,390,'原文节选 + 准确引用',29)+
path('M722 482V541','green',true)+t(0,603,'交接 + 索引 + 未压缩尾部 → 本轮工作上下文',32,C.ink,650)),
'索引绑定原史位置与哈希。长原史也加提醒；回查后的完整任务提醒最多 4 KiB。v7 仅在原请求前标注，让用户原文位于末尾；全部计入预算，不改原史或授权。',['S01','S02','S03']);

page('constraints','04 · 分清哪些值仍然有效','后来的一条纠正，\n通常只替换一部分要求','变更端口，不代表项目名、地区或禁止项一起失效。',svg('变更前后字段对齐，只有端口变化被标红，其余值保留',
rect(0,0,952,62,C.ink)+t(20,42,'字段',29,C.paper,700)+t(316,42,'D1',29,C.paper,700)+t(638,42,'D2 明确改端口',29,C.paper,700)+
[['项目','quartz-k42','quartz-k42','ink'],['端口','8123','9237','red'],['地区','east','east','ink'],['部署','forbidden','forbidden','ink']].map(([a,b,c,k],i)=>t(20,141+i*103,a,32)+t(316,141+i*103,b,31,C.muted,400,'start',true)+t(638,141+i*103,c,31,C[k],650,'start',true)+rule(176+i*103)).join('')+
t(0,581,'按来源与时间理解“替换了什么”。',35,C.green,700)+t(0,639,'无法确认的冲突，标记未知并回查。',30,C.muted)),
'示例只有两次要求。固定评测的 corrections 剧本还包含 D3，最终端口为 9461；最新的明确纠正才有效。',['E01','S02']);

page('states','05 · 描述已发生的事','计划、观察、未知，\n不要在摘要里混成一种状态','“补丁文件存在”离“修复已验证”还差一次实际检查。',svg('五行证据状态表，从计划到未知，标注能说和不能推断的内容',
rect(0,0,952,66,C.ink)+t(20,43,'来源内容',30,C.paper,700)+t(485,43,'允许的结论',30,C.paper,700)+
[['计划部署','存在计划；许可仍需另查'],['工具返回测试失败','这次测试失败'],['补丁文件已写出','文件存在；效果待验证'],['assistant 猜测通过','仅有推断'],['未看到迁移结束','迁移完成状态未知']].map(([a,b],i)=>t(20,146+i*103,a,31)+t(485,146+i*103,b,30,i===1?C.red:C.ink)+rule(181+i*103)).join('')),
'is_error 和退出码描述工具状态，checksum-317 是诊断标识，两者应分开。禁止修改来自用户约束；未观察到执行，不会让已知禁令变成未知。',['S02','E01']);

page('references','06 · 给结论一个可查的来源','一个引用，\n究竟能证明什么？','先证明记录身份，再核对它是否支持当前结论。',svg('历史引用 h2:哈希的身份解析，来源存在与语义支持分两道判断',
consoleBox(0,0,952,144,'引用示意 · 调用需使用完整 16 位哈希',['h2:c847058aca82003f'],38)+
path('M81 174V252','ink',true)+path('M375 174V252','green',true)+t(0,308,'消息位置',34,C.ink,700)+t(291,308,'内容 SHA-256 前 16 位',32,C.green,700)+
rule(372)+tag(0,414,253,'身份校验通过','green')+t(290,447,'找到原来那条记录',32)+
tag(0,513,253,'语义仍需核对','amber')+t(290,546,'这条原话支持这个结论吗？',32)+
t(0,642,'模型伪造或引用别处的 hN:hash → 拒绝采用。',29,C.red,650)),
'索引引用由宿主附带，v4 不再要求摘要复制哈希；生成了伪引用仍拒绝采用。身份检查不是语义证明或数字签名，合法来源也可能被误读。',['S01','S03','T01']);

page('timeline','07 · 多次纠正的时间顺序','别让被替换的旧值，\n在第三次摘要里复活','顺序是事实的一部分，不要只保存孤立数字。',svg('8123到9237到9461三次纠正时间线，最终有效值突出，旧值仍在原史',
path('M55 188H903','ink',true)+[[100,'D1','8123','muted'],[474,'D2','9237','muted'],[848,'D3','9461','green']].map(([x,a,b,k])=>dot(x,188,12,k=== 'muted'?'ink':k)+t(x,99,a,34,C[k],700,'middle')+t(x,290,b,62,C[k],700,'middle',true)).join('')+
path('M193 240l-150 66','red')+path('M554 240l-150 66','red')+
rect(0,384,952,149,C.greenBg)+t(25,443,'最终报告：port = 9461，source = D3',36,C.green,700)+t(25,497,'项目名仍可来自 D1，不必一并丢弃。',31)+
t(0,626,'原史保留旧值，是为了追查，不是把它继续当当前值。',29,C.muted)),
'数值来自固定 corrections 剧本。任务最终提示不提供 9461，必须从历史或原始来源恢复。',['E01']);

page('capacity','08 · 有限窗口如何保留证据','索引有上限，\n遗漏必须可见','最近记录优先入选，早期有效约束需要继续查找。',svg('4096字节索引容量表和遗漏入口，容量满时显式omitted而非伪称全量',
t(0,120,'4096',106,C.red,700)+t(336,80,'字节',34,C.red)+t(337,139,'整个宿主索引的上限',30,C.muted)+
Array.from({length:5},(_,i)=>rect(i*183,226,170,95,i===4?C.greenBg:C.soft)+t(i*183+85,286,`来源 ${i+1}`,29,C.ink,650,'middle')).join('')+
t(0,385,'每条节选 ≤ 480 字节，partial 标记缺口。',32)+t(0,447,'放不下的条目计入 omitted，原史仍保留。',32)+
path('M435 488V552','green',true)+t(0,623,'read_history：沿 cursor 查目录，按 query 找原话。',29,C.green,650)),
'索引占用真实预算。目录 EOF 后 next_cursor 为 null，应停止翻页；读者自己的回查不会产生新原始证据。有限索引与字面搜索仍可能找不到答案。',['S01','S03']);

page('large-result','09 · 回到大工具证据','只看到结果引用时，\n沿用上一课的回读工具','先取回已有证据，不为了“再看一眼”重跑命令。',svg('历史收据通向read_tool_result和正文末尾，禁止重跑原工具',
file(0,0,407,255,'历史中的收据',['reference / bytes','source / sha256'])+
path('M435 125H579','green',true)+t(600,109,'read_tool_result',29,C.green,700,'start',true)+t(600,167,'当前权限 + 正文校验',27)+
path('M778 218V312H483','green',true)+rect(0,337,952,123,C.greenBg)+t(25,388,'回读末尾：needle-z83 / failed / E_LOG_19',31,C.green,700)+t(25,433,'这是工具正文里的证据，不在最终任务提示里。',29)+
rule(527)+t(0,590,'过期、缺失、改变 → 明确失败，不自动重放。',32,C.red,700)),
'非 EOF 页可能截断标识。EOF 空页不等于空正文：先看 total_bytes；非零时用 tail:true 且不带 offset，或读较早范围。权限、校验与每页上限保持不变。',['S04','E01','E09']);

page('history','10 · 回查用户原话','先定位，再读原文，\n原角色一起返回','query 只查用户原话；不带 query 可列工具来源身份。',svg('两步调用代码示例和带角色的回读结果，next_offset控制分页',
consoleBox(0,0,952,180,'第一步 · 字面检索',['read_history({ query: "port", cursor: 0 })'],26)+
path('M465 205V268','green',true)+consoleBox(0,293,952,188,'第二步 · 用返回的完整引用',['reference: "h2:c847058aca82003f"','offset: 0, limit: 512'],29)+
rect(0,527,952,123,C.greenBg)+t(23,573,'origin: user_statement · role: user',28,C.green,700,'start',true)+t(23,625,'原话：9237 replaces 8123；deployment forbidden',27)),
'用户原话提供要求，工具观察描述效果。旧工具无来源会拒绝新读取，但不会抹去已可见的观察。hN:hash 不能代替 S002 收据引用；正文每页最多 4096 字节。',['S03','T02']);

page('recursive','11 · 多次摘要的传播风险','让原始纠正，\n再次进入下一轮交接','只传上一份摘要，会把同一个错误反复传下去。',svg('错误摘要传递链与原史来源重新注入的对照流程',
t(0,42,'只有摘要继续传递',33,C.red,700)+
[0,346,692].map((x,i)=>rect(x,88,260,117,C.redBg)+t(x+130,140,`摘要 ${i+1}`,31,C.red,700,'middle')+t(x+130,181,'8123',30,C.red,400,'middle',true)).join('')+path('M282 146H324','red',true)+path('M628 146H670','red',true)+
rule(269)+t(0,335,'重建原史索引后',33,C.green,700)+
rect(0,379,320,165,C.white,C.line)+t(24,440,'原话 D2：9237',31,C.green,700)+t(24,497,'每轮从原史重建',29)+path('M348 463H505','green',true)+
rect(540,379,412,165,C.greenBg)+t(563,440,'旧交接 + 原文 + 新历史',29,C.green,700)+t(563,497,'生成下一份待核对交接',28)+
t(0,631,'重新看到来源，提升纠错机会；效果仍要实测。',30,C.muted)),
'每轮带回原始纠正。v3 中，已完成分块若组合后满足字节与输入预算，就按原顺序保留，避免再生成一次；仍不保证模型后续一定做对。',['S01','T02']);

page('restore','12 · 失败与恢复','恢复的是事实和来源，\n不是过去的审批','校验完整快照之后才替换当前状态。',svg('恢复前校验四项与失败分支，原史、绑定、配对和版本',
[['版本与格式','context.format / history.version'],['原史与边界','through 合法，工具调用与结果配对'],['来源绑定','消息位置、内容哈希、原来源路径'],['当前策略','新读取重新授权，计入本轮预算']].map(([a,b],i)=>t(0,60+i*125,String(i+1).padStart(2,'0'),46,C.red,700)+t(93,56+i*125,a,34,C.ink,650)+t(93,106+i*125,b,27,C.muted)+rule(133+i*125)).join('')+
t(0,624,'校验失败保留当前状态；旧工具记录无来源则拒绝回查。',28,C.red,650)),
'S002 正文仍有独立 TTL。v5 丢弃截断摘要，最多从原始片段发起一次更短交接请求；仍计入原预算，再失败就停止。取消不采用迟到结果，恢复不重放工具。',['S01','S03','T01','T03']);

page('score','13 · 先冻结事实清单','评分器要能抓住错误，\n再拿它比较两个版本','提前写答案，不根据模型输出修改及格线。',svg('预期事实和实际输出的逐字段对照，普通事实与关键事实分开',
rect(0,0,952,65,C.ink)+t(20,42,'字段',28,C.paper,700)+t(323,42,'预期',28,C.paper,700)+t(620,42,'实际',28,C.paper,700)+
[['port','9461','8123','red'],['region','west','west','green'],['deployment','forbidden','unknown','red'],['project','quartz-k42','quartz-k42','green']].map(([a,b,c,k],i)=>t(20,143+i*104,a,28,C.ink,400,'start',true)+t(323,143+i*104,b,29,C.ink,400,'start',true)+t(620,143+i*104,c,29,C[k],700,'start',true)+rule(180+i*104)).join('')+
t(0,586,'先用缺失、错值、禁止调用验证评分器。',33,C.ink,700)+t(0,640,'来源标签命中，只计“可定位”，不等于结论正确。',29,C.muted)),
'此表是人工错误样例。也要用漏键、错顶层对象验证契约检查；事实正确不代表 sources 键齐全，键齐全也不代表引用正确。原失败和补查分开保存。',['E01','E02','E12']);

page('task','14 · 完成前核对产物','口头说完成之后，\n再检查实际文件','调用方显式声明结构，Core 在当前权限下读取。',svg('按回合显式契约、实际文件校验、至多一次修复流程；结构不认证事实',
consoleBox(0,0,952,143,'原任务 + 显式结构声明',['artifact.json：build 为数字，stage 为允许状态'],29)+
path('M140 170V241','ink',true)+
rect(0,270,280,166,C.white,C.line)+t(140,331,'读取实际文件',31,C.ink,700,'middle')+t(140,391,'权限 / 64 KiB 上限',25,C.muted,400,'middle')+
path('M299 349H326','red',true)+rect(345,270,262,166,C.redBg)+t(476,331,'报告结构问题',31,C.red,700,'middle')+t(476,391,'位置 + 错误码',26,C.red,400,'middle')+
path('M626 349H653','green',true)+rect(672,270,280,166,C.greenBg)+t(812,331,'修复至多一次',31,C.green,700,'middle')+t(812,391,'原预算 / 重新授权',25,C.green,400,'middle')+
rule(497)+t(0,555,'缺文件、非法 JSON、缺键 → 可触发一次修复。',30,C.ink,650)+t(0,622,'拒绝、取消、未知效果 → 停止，不自动重放。',30,C.red,650)),
'结构通过不证明事实正确。反馈仅覆盖当前请求，不保存为用户指令；下一回合不继承契约。先前模糊自查只修复 2/4，原失败与成本保留；显式契约另做成对评测。',['S05','T04','E13','E14']);

page('comparison','15 · 看完整分母','固定集全部通过，\n仍保留每轮失败','同一调用方输入与预算；三版各完整 56 次。',svg('v2历史基线54/56、前候选55/56、新版本56/56；关键项56/56、普通事实63/63；非同期实验',
rect(0,0,952,69,C.ink)+t(24,46,'采用次数',30,C.paper,700)+t(270,46,'历史基线',30,C.paper,700)+t(510,46,'前候选',30,C.paper,700)+t(750,46,'读取纠错版',30,C.paper,700)+
[['0 次','6 / 8','7 / 8','8 / 8'],['1 次','24 / 24','24 / 24','24 / 24'],['3 次','24 / 24','24 / 24','24 / 24'],['全部','54 / 56','55 / 56','56 / 56']].map(([label,a,b,c],i)=>t(24,148+i*100,label,32,C.ink,700)+t(270,148+i*100,a,34,C.muted,650)+t(510,148+i*100,b,34,C.ink,650)+t(750,148+i*100,c,34,C.green,700)+rule(180+i*100)).join('')+
t(0,565,'关键项：56/56；普通事实：63/63。',32,C.green,700)+t(0,633,'严格门槛通过，原 728 份记录没有改写。',31,C.ink,650)),
'历史对照时间不同，不能把分数差异全归因于纠错。真实一轮没有触发纠错阶段；同响应前后回归另证机制。成本逐请求保存，固定集通过不保证任意任务无损。',['E15','E16','T05']);

page('practice','16 · 不用 API key 的跟练','故意留下一个坏摘要，\n看原始纠正还能否找回','用确定性替身隔离协议与模型行为。',svg('离线命令与三项可观察结果：错误被采用、原文重入、评分拒绝',
consoleBox(0,0,952,223,'仓库根目录',['pnpm build','node researches/summary-quality/offline-demo.mjs'],25)+
[['01','短坏摘要仍可能被采用','格式与预算检查没有证明它正确。'],['02','下一轮输入出现原始 D2','确认恢复的是原话，不是另一份猜测。'],['03','oracle 拒绝错误端口','最终任务结果也要单独验证。']].map(([a,b,c],i)=>t(0,294+i*127,a,48,C.red,700)+t(96,291+i*127,b,33,C.ink,650)+t(96,343+i*127,c,28,C.muted)+rule(372+i*127)).join('')),
'脚本不会访问网络或写业务文件。另一个 CLI 夹具启动五个真实进程，验证恢复后的来源权限及原工具不重放。',['T02','T03']);

page('next','17 · 读取纠错与完成判断','读取出错后，\n任务还没有完成','宿主记住未解决的读取，给一次有界纠错机会。',svg('错误参数进入pending，纠正读取成功才能结束，失败则未完成；不重放源工具',
consoleBox(0,0,952,150,'实测错误 · 两个读取模式混在一起',['read_tool_result({ reference, tail:true, offset:31573 })'],25)+
file(0,216,410,214,'工具拒绝参数',['没有取得证据','保留未解决状态'],'red')+
path('M439 322H510','amber',true)+file(540,216,412,214,'原预算内纠错一次',['tail:true，省略 offset','新调用重新授权'],'green')+
path('M747 451V508','green',true)+rect(0,541,952,110,C.greenBg)+t(24,586,'同一引用读取成功 → 才能继续完成检查',31,C.green,700)+t(24,630,'仍未解决 → 返回未完成，不自动重跑原命令',28,C.red,650)),
'结构合法不等于证据已经读到。模型说成功、读了其他引用或读到 EOF 空页，都不能清除失败状态。控制状态只属于当前回合，反馈不写成用户指令；严格固定集验收已通过；机制回归与真实评分分别留证。',['S04','S06','T05','E16','D01']);

if(pages.length!==18) throw new Error('E04-S003 must contain exactly 18 pages including its cover');
for(const [i,p] of pages.entries()) {
 const number=String(i+1).padStart(2,'0');
 const header=`<header class="page-header"><span>Zero2Agent · ${esc(p.section)}</span><span class="page-number">${number}</span></header>`;
 const heading=`<div class="heading" data-block><h1>${esc(p.title).replaceAll('\n','<br>')}</h1><p class="deck" data-prose>${esc(p.deck)}</p></div>`;
 const content=`<div class="content">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div>`;
 const cover=`<div class="cover-frame"><header class="page-header"><span>Zero2Agent · 健壮性与上下文</span><span class="page-number">E04-S003</span></header><div class="series-masthead" data-block><h1 class="series-title">从零到一做 <span>Agent</span></h1><p class="series-description" data-prose>亲手实现 Coding Agent · 开源实战课程</p><h2 class="lesson-title">摘要质量与事实保留</h2><p class="lesson-promise" data-prose>找回原话，核对事实，再继续任务。</p></div><div class="series-body">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div><div class="cover-tags"><span>事实保留</span><span>来源回查</span><span>开源课程</span></div></div>`;
 fs.writeFileSync(p.file,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080"><title>${esc(p.title.replaceAll('\n',''))}</title><link rel="stylesheet" href="course.css"></head><body><main class="sheet ${i===0?'cover series-cover':''}" data-page="${number}">${i===0?cover:header+heading+content}</main></body></html>\n`);
}
fs.writeFileSync('pages.json',JSON.stringify({title:'Zero2Agent · E04-S003 摘要质量与事实保留',date:'2026-10-13',draft:false,publicationStatus:'unpublished',width:1080,height:1440,maxImages:18,edition:'read-recovery-v1-accepted',pages:pages.map((p,i)=>({file:p.file,title:p.title.replaceAll('\n',''),number:i+1,sources:p.sources}))},null,2)+'\n');
