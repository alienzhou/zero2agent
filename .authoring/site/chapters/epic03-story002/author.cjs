// Editable diagram source. Run pnpm site:build from the Zero2Agent repository.
const fs=require('node:fs');
const C={ink:'#202622',muted:'#555C55',line:'#CACDC3',paper:'#F4F1EA',white:'#FFFEF8',green:'#28614D',greenBg:'#E0EBDF',amber:'#896016',amberBg:'#F0E5C9',red:'#B53830',redBg:'#F2DED7',soft:'#E7EADF',lightGreen:'#B6D5C4'};
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const text=(x,y,s,size=34,color=C.ink,weight=400,anchor='start',cls='')=>`<text x="${x}" y="${y}" style="white-space:pre;font-size:${size}px;fill:${color};font-weight:${weight}" text-anchor="${anchor}" class="${cls}">${esc(s)}</text>`;
const lines=(x,y,ss,size=34,color=C.ink,weight=400,anchor='start',lh=1.5,cls='')=>ss.map((s,i)=>text(x,y+i*size*lh,s,size,color,weight,anchor,cls)).join('');
const rect=(x,y,w,h,fill=C.white,stroke=C.line,r=12,dash='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2" ${dash?`stroke-dasharray="${dash}"`:''}/>`;
const path=(d,color=C.ink,arrow=true,dash='')=>`<path class="edge" d="${d}" stroke="${color}" ${arrow?`marker-end="url(#a${Object.keys(C).find(k=>C[k]===color)||'ink'})"`:''} ${dash?`stroke-dasharray="${dash}"`:''}/>`;
const circle=(x,y,r,fill=C.white,stroke=C.ink)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>`;
const chip=(x,y,w,s,tone='green')=>rect(x,y,w,52,C[tone+'Bg'],C[tone],26)+text(x+w/2,y+36,s,29,C[tone],650,'middle');
const num=(x,y,n)=>circle(x,y,24,C.ink,C.ink)+text(x,y+10,n,28,C.paper,700,'middle','serif');
const doc=(x,y,w=110,h=132,color=C.ink)=>`<path d="M${x} ${y}h${w-27}l27 27v${h-27}h-${w}Z M${x+w-27} ${y}v27h27" fill="${C.white}" stroke="${color}" stroke-width="3"/>`+[h*.40,h*.57,h*.74].map((dy,i)=>path(`M${x+20} ${y+dy}h${w-40-(i===2?20:0)}`,color,false)).join('');
const folder=(x,y,w=160,h=105,color=C.ink)=>`<path d="M${x} ${y+17}v-${17}h${w*.43}l15 17H${x+w}v${h-17}H${x}Z" fill="${C.white}" stroke="${color}" stroke-width="3"/>`;
const terminal=(x,y,w=180,h=125)=>rect(x,y,w,h,C.ink,C.ink,10)+text(x+22,y+53,'>_',38,C.paper,700,'start','mono')+path(`M${x+23} ${y+87}h${w-46}`,C.paper,false);
const cross=(x,y,color=C.red)=>path(`M${x-11} ${y-11}l22 22 M${x+11} ${y-11}l-22 22`,color,false);
const check=(x,y,color=C.green)=>path(`M${x-12} ${y}l9 10l19-23`,color,false);
const svg=(h,label,body)=>`<svg class="diagram" viewBox="0 0 952 ${h}" width="952" height="${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><defs>${Object.entries(C).map(([k,v])=>`<marker id="a${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${v}"/></marker>`).join('')}</defs>${body}</svg>`;
const pages=[];
function page(file,section,title,deck,diagram,note='',extra=''){pages.push({file,section,title,deck,diagram,note,extra});}
// P01: a tool proposal visibly forks at a host-owned permission gate.
const cover=svg(690,'模型提出工具调用，由宿主权限判断分为允许、询问与拒绝',
rect(267,30,418,90,C.white,C.ink)+text(476,86,'模型提出工具调用',38,C.ink,650,'middle')+
path('M476 120V181')+
rect(209,194,534,147,C.ink,C.ink,18)+text(476,251,'宿主检查权限',45,C.paper,700,'middle')+text(476,301,'规则 · 模式 · 工作区边界',29,C.paper,400,'middle')+
path('M476 341V395',C.ink,false)+path('M476 395H157V449',C.green)+path('M476 395V449',C.amber)+path('M476 395H795V449',C.red)+
[[157,'允许','直接执行','green'],[476,'询问','等你批准','amber'],[795,'拒绝','返回原因','red']].map(([x,a,b,t])=>circle(x,487,37,C[t+'Bg'],C[t])+ (t==='green'?check(x,487):t==='red'?cross(x,487):text(x,499,'?',37,C.amber,700,'middle'))+text(x,570,a,42,C[t],700,'middle')+text(x,622,b,30,C.ink,400,'middle')).join(''));
page('01-cover.html','', 'Agent 执行前\n先过权限关','三态规则与一次 Approval',cover);
// P12: same path string, different physical destination.
page('12-paths.html','路径重查','你批准的路径，\n执行时还在原地吗？','同一个路径字符串，可能已指向另一个位置。',svg(840,'审批时目标位于工作区，等待期间目录被替换为软链接；执行前再次检查真实路径并拒绝外部写入',
text(24,42,'目标参数',29,C.muted)+text(215,42,'out/report.txt',34,C.ink,600,'start','mono')+
rect(0,90,952,286,C.soft,C.line)+num(38,132,'1')+text(85,144,'审批时 · 路径在工作区内',35,C.ink,650)+
rect(31,175,578,158,C.white,C.green,8,'9 7')+text(56,213,'/project',28,C.green,600,'start','mono')+folder(60,239,104,63)+text(189,282,'out/',33,C.ink,500,'start','mono')+path('M286 271H357',C.green)+doc(387,230,70,87,C.green)+text(480,282,'文件',32)+chip(654,235,236,'路径检查通过','green')+
path('M476 379V458',C.amber)+rect(200,399,552,48,C.paper,C.paper,0)+text(476,433,'等待回答时，out 被换成软链接',30,C.amber,600,'middle')+
rect(0,482,952,317,C.white,C.line)+num(38,526,'2')+text(85,538,'执行前 · 重新解析真实路径',35,C.ink,650)+
rect(31,579,398,160,C.soft,C.green,8,'9 7')+text(56,618,'/project',28,C.green,600,'start','mono')+folder(63,648,86,56)+text(179,692,'out →',33,C.ink,500,'start','mono')+path('M326 675H578',C.red)+text(472,643,'越过工作区',27,C.red,600,'middle')+rect(597,579,322,160,C.redBg,C.red)+text(758,630,'/outside',32,C.red,600,'middle','mono')+cross(665,681)+text(782,693,'拒绝写入',34,C.red,700,'middle')),
'目标尚未创建时，先解析已存在的祖先目录。批准后仍须重查；路径检查无法提供操作系统级隔离。');
// P02: one user task leads to three distinct types of side effect.
page('02-scope.html','任务与授权','“修好这个报错”，\n授权到了哪一步？','先区分操作造成的影响，再决定是否自动执行。',svg(842,'修复任务拆为读取文件、修改文件与运行命令，默认模式分别允许、询问、询问',
rect(0,16,952,126,C.ink,C.ink)+text(36,59,'用户任务',27,C.paper)+text(36,111,'帮我修复项目，然后运行验证。',40,C.paper,650)+
path('M476 144V208')+text(476,250,'模型可能提出的三次调用',32,C.muted,500,'middle')+
[0,326,652].map(x=>rect(x,300,300,431,C.white,C.line)).join('')+
doc(94,340,112,139)+rect(398,340,154,141,C.white,C.ink,4)+text(419,382,'− old',28,C.red,500,'start','mono')+text(419,429,'+ fix',28,C.green,500,'start','mono')+path('M420 456H532',C.line,false)+terminal(711,345,180,128)+
path('M305 410H319')+path('M631 410H645')+
[[150,'读取文件',['看源码与错误信息'],'green','默认允许'],[476,'修改文件',['改动会写入磁盘'],'amber','默认询问'],[802,'运行命令',['会启动新进程'],'amber','默认询问']].map(([x,a,b,t,c])=>text(x,532,a,40,C.ink,700,'middle')+lines(x,590,b,29,C.muted,400,'middle')+chip(x-113,642,226,c,t)).join('')+
text(476,803,'条件：default 模式、工作区内、无显式规则',29,C.muted,400,'middle')),
'任务描述给出目标。Harness 仍要逐次判断工具调用，不能把“修好项目”直接视为所有操作的批准。');
// P03: the execution call site and ownership boundary.
page('03-gate.html','执行入口','权限判断，\n必须接在 execute 之前','模型提供调用；宿主代码负责控制执行。',svg(841,'模型的工具请求进入宿主控制的权限检查，通过后重查路径并调用工具，拒绝则生成错误结果',
rect(0,18,276,657,C.soft,C.line)+text(138, 70,'模型',39,C.ink,700,'middle')+doc(84,124,108,138)+text(138,324,'提出调用',36,C.ink,600,'middle')+lines(138,391,['write_file','path: fix.txt'],28,C.ink,400,'middle',1.65,'mono')+text(138,586,'没有执行权',30,C.red,650,'middle')+
rect(316,18,636,657,C.white,C.ink,14,'10 7')+text(635,70,'宿主 Harness',39,C.ink,700,'middle')+
rect(408,113,454,85,C.soft,C.line)+text(635,166,'宿主设置模式与规则',31,C.ink,600,'middle')+path('M635 198V247')+
path('M276 316H405')+rect(408,249,454,134,C.ink,C.ink)+text(635,302,'检查权限',40,C.paper,700,'middle')+text(635,352,'authorize(...)',29,C.paper,400,'middle','mono')+
path('M635 383V457',C.green)+text(728,427,'获准后',29,C.green,600)+rect(408,460,454,129,C.greenBg,C.green)+text(635,513,'重查路径 → 执行工具',35,C.green,650,'middle')+text(635,558,'tool.execute(...)',28,C.green,400,'middle','mono')+
text(636,635,'拒绝 → 跳过执行，返回错误结果',29,C.red,500,'middle')+
rect(0,715,952,112,C.amberBg,C.amber)+text(35,756,'提示词里的“先问我”',29,C.amber,600)+text(35,807,'宿主把检查接在执行前，才能阻止未经授权的操作。',30,C.ink)),
'权限配置由宿主提供。界面接收展示事件，审批回调返回决定；普通展示事件不能替用户放行。');
// P04: distinct branches and convergence, with explicit approval conditions.
page('04-three-actions.html','三态分支','同一次工具调用，\n有三条去路','ask 会暂停当前调用，等待有效的审批结果。',svg(850,'权限评估分为允许、询问、拒绝；询问批准后执行，拒绝或失效产生错误结果',
rect(298,12,356,86,C.ink,C.ink)+text(476,67,'权限评估',39,C.paper,700,'middle')+
path('M476 98V148',C.ink,false)+path('M476 148H152V207',C.green)+path('M476 148V207',C.amber)+path('M476 148H800V207',C.red)+
[[152,'allow','允许','green'],[476,'ask','询问','amber'],[800,'deny','拒绝','red']].map(([x,a,b,t])=>circle(x,254,44,C[t+'Bg'],C[t])+text(x,266,t==='green'?'✓':t==='amber'?'?':'×',40,C[t],650,'middle')+text(x,339,a,32,C[t],700,'middle','mono')+text(x,390,b,36,C.ink,600,'middle')).join('')+
path('M152 407V597',C.green)+path('M800 407V597',C.red)+path('M476 407V449',C.amber)+
rect(325,455,302,106,C.amberBg,C.amber)+text(476,498,'等待用户',36,C.amber,650,'middle')+text(476,542,'工具尚未执行',28,C.amber,400,'middle')+
path('M325 509H236V598',C.green)+text(323,591,'批准',29,C.green,600,'middle')+
path('M627 509H716V598',C.red)+text(602,591,'拒绝 / 失效',28,C.red,600,'middle')+
rect(32,608,401,152,C.greenBg,C.green)+text(233,666,'重查后执行',40,C.green,650,'middle')+text(233,722,'产生真实工具结果',30,C.ink,400,'middle')+
rect(521,608,400,152,C.redBg,C.red)+text(722,666,'跳过执行',40,C.red,650,'middle')+text(722,722,'生成拒绝结果',30,C.ink,400,'middle')+
text(476,825,'两条结果路径都保留原调用 ID',31,C.muted,600,'middle')),
'允许后仍须重查路径；拒绝时工具不执行。模型收到拒绝原因，可以调整后续操作。');
// P05: graphical mechanisms, preserving the original comparison scope.
page('05-competitors.html','机制对照','都叫权限控制，\n判定方法并不相同','四个机制示意，来自本课 2026-10-05 调研快照。',svg(848,'Claude 按拒绝询问允许排序；Codex 分开审批和沙箱；Gemini 按优先级；OpenCode v1 最后匹配生效',
rect(0,12,452,396,C.white,C.line)+text(28,64,'Claude Code',36,C.ink,700)+text(28,111,'三态的判定顺序',30,C.muted)+
chip(28,157,112,'deny','red')+path('M148 183H169')+chip(178,157,105,'ask','amber')+path('M291 183H311')+chip(320,157,104,'allow','green')+lines(28,288,['先看拒绝，再看询问，','最后才看允许。'],32)+
rect(500,12,452,396,C.white,C.line)+text(528,64,'Codex',36,C.ink,700)+text(528,111,'两条独立配置轴',30,C.muted)+
path('M570 263V159',C.ink)+path('M570 263H890',C.ink)+text(617,193,'审批：是否需要询问',28)+text(617,245,'沙箱：可访问的资源',28)+text(528,343,'批准与执行边界分开配置。',30)+
rect(0,447,452,376,C.white,C.line)+text(28,499,'Gemini CLI',36,C.ink,700)+text(28,546,'按规则优先级匹配',30,C.muted)+
rect(28,590,90,25,C.green,C.green,4)+rect(28,632,146,25,C.amber,C.amber,4)+rect(28,674,210,25,C.ink,C.ink,4)+path('M278 590V699')+text(315,626,'优先级',28)+text(315,671,'升高',28)+text(28,775,'无交互时询问按拒绝处理。',30)+
rect(500,447,452,376,C.white,C.line)+text(528,499,'OpenCode v1',36,C.ink,700)+text(528,546,'最后一条匹配生效',30,C.muted)+
rect(528,588,165,54,C.soft,C.line)+text(610,625,'前一匹配',28,C.muted,400,'middle')+path('M702 615H743')+rect(754,588,168,54,C.amberBg,C.amber)+text(838,625,'最后匹配',28,C.amber,650,'middle')+lines(528,730,['同一批规则换顺序，','可能得到不同结论。'],30)),
'本课采用 deny → ask → allow，只做单次批准。完整调研与固定源码版本见 sources.md。');
// P06: a readable, conditional matrix instead of prose definitions.
page('06-modes.html','宿主模式','先选默认模式，\n再处理例外规则','这张表的前提：无显式规则，读写目标在工作区内。',svg(814,'四种权限模式矩阵，对照工作区读、工作区写、命令和未知工具',
text(32,51,'模式',30,C.muted,650)+text(355,51,'读',34,C.ink,650,'middle')+text(553,51,'写',34,C.ink,650,'middle')+text(782,51,'命令 / 未知工具',29,C.ink,650,'middle')+
path('M0 80H952',C.ink,false)+
[['default',['allow','ask','ask']],['read-only',['allow','deny','deny']],['accept-edits',['allow','allow','ask']],['bypass',['allow','allow','allow']]].map(([name,states],i)=>{const y=97+i*145;return (i===0?rect(0,y,952,131,C.soft,C.soft,8):'')+text(30,y+ 75,name,28,C.ink,650,'start','mono')+states.map((s,j)=>{const tone={allow:'green',ask:'amber',deny:'red'}[s];const x=[355,553,782][j];return circle(x,y+47,22,C[tone+'Bg'],C[tone])+text(x,y+55,{allow:'✓',ask:'?',deny:'×'}[s],25,C[tone],700,'middle')+text(x,y+103,{allow:'允许',ask:'询问',deny:'拒绝'}[s],30,C[tone],600,'middle');}).join('')+(i?path(`M0 ${y+132}H952`,C.line,false):'');}).join('')+
rect(0,719,952,83,C.amberBg,C.amber)+text( 30,770,'bypass 仍受显式 deny / ask 与工作区写边界约束。',31,C.amber,600)),
'工作区外读取另行判断：只读模式拒绝；默认模式与自动编辑模式询问。模式由宿主在创建 Agent 时选择。');
// P07: precedence as an actual decision path, plus a conflict example.
page('07-rule-order.html','规则优先级','两条规则都命中，\n该听哪一条？','本课规则：deny 优先于 ask，ask 优先于 allow。',svg(844,'先检查硬边界，再按拒绝询问允许顺序寻找命中规则，无命中才使用默认模式',
text(38,44,'实际判定顺序',31,C.muted,650)+
[[85,'硬边界','越界等 → 拒绝',C.red],[251,'deny','命中 → 拒绝',C.red],[417,'ask','命中 → 审批',C.amber],[583,'allow','命中 → 允许',C.green]].map(([y,name,result,col],i)=>rect(18,y,345,105,C.white,col)+text(191,y+66,name,38,col,650,'middle')+path(`M363 ${y+52}H428`,col)+text(452,y+65,result,32,col,600)+(i<3?path(`M191 ${y+105}V${y+158}`,C.ink)+text(225,y+142,i===0?'通过':'未命中',26,C.muted):'')).join('')+
path('M191 688V748')+text(226,727,'未命中',26,C.muted)+rect(18,753,345,76,C.soft,C.line)+text(191,803,'采用默认模式',32,C.ink,650,'middle')+
rect(690,107,252,606,C.soft,C.line)+text(816,161,'同一调用',32,C.ink,650,'middle')+text(816,211,'terminal',27,C.ink,400,'middle','mono')+chip(715,257,203,'allow 命中','green')+chip(715,345,203,'deny 命中','red')+path('M816 408V494',C.red)+circle(816,541,36,C.redBg,C.red)+cross(816,541)+text(816,625,'拒绝执行',35,C.red,700,'middle')),
'先判断工作区硬边界与只读模式限制。同级规则不依赖书写顺序；模型不能用“已经批准”绕过这条决策链。');
// P08: a visual diff makes exact string matching concrete.
page('08-exact-match.html','参数匹配','允许 git status，\n不等于允许后面的命令','显式规则只匹配顶层标量值；字符串必须完全相同。',svg(849,'规则 command 等于 git status，只允许完全匹配输入，追加命令不命中这条 allow 规则',
rect(0,17,952,170,C.ink,C.ink)+text(30,64,'宿主配置的规则',28,C.paper)+text(30,119,'tool: terminal   action: allow',30,C.paper,500,'start','mono')+text(30,161,'input.command: "git status"',30,C.paper,500,'start','mono')+
path('M476 188V236H235V289',C.green)+path('M476 188V236H717V289',C.amber)+
rect(0,307,452,361,C.greenBg,C.green)+text( 30,361,'输入 A',34,C.green,700)+rect( 20,397,412,76,C.white,C.green,4)+text(226,446,'git status',34,C.ink,500,'middle','mono')+check( 60,532)+text(95,544,'完全相同',36,C.green,650)+text(30,615,'命中这条 allow',31,C.green,600)+
rect(500,307,452,361,C.amberBg,C.amber)+text(530,361,'输入 B',34,C.amber,700)+rect(520,397,412,134,C.white,C.amber,4)+text(540,444,'git status;',32,C.ink,500,'start','mono')+text(540,491,'other-command',32,C.red,650,'start','mono')+text(530,590,'多出的内容改变了字符串',29,C.amber,650)+text(530,638,'不命中这条 allow',31,C.amber,600)+
path('M726 669V730',C.amber)+text(476,796,'B 继续走其它规则；若无命中，default 会询问。',30,C.ink,600,'middle')),
'这里没有命令前缀白名单，也不解析 shell 语法。图中换行仅用于排版；匹配时比较完整原始字符串。');
// P09: teach the current CLI using an annotated reconstruction, not invented UI.
page('09-request.html','审批界面','批准之前，\n把“这次操作”看完整','以下按当前 CLI 输出结构重排；为教学示意。',svg(850,'当前CLI审批内容标注：工具名、工作目录、完整参数、原因和默认拒绝的y/N输入',
rect(0,25,682,681,C.ink,C.ink)+text(30,76,'APPROVAL · 当前终端',26,C.paper,500)+path('M30 102H650',C.line,false)+
text(30,153,'Approval · "write_file"',31,C.paper,600,'start','mono')+text(30,221,'工作目录: "/project"',30,C.paper,400,'start','mono')+
lines(30,288,['参数: {','  "path": "fix.txt",','  "content": "fixed"','}'],30,C.paper,400,'start',1.7,'mono')+
text(30,528,'原因: "Approval required',27,C.paper,400,'start','mono')+text(30,572,'for write"',27,C.paper,400,'start','mono')+
rect( 20,608,642,77,'#39483B','#79937D',4)+text(40,659,'允许这次操作？[y/N]:',31,C.paper,600,'start','mono')+
[[150,'① 哪个工具'],[219,'② 在哪里执行'],[365,'③ 完整参数'],[550,'④ 为什么询问'],[650,'⑤ 只批准本次']].map(([y,s])=>path(`M688 ${y}H723`,C.muted,false)+text(747,y+10,s,27,C.ink,600)).join('')+
chip(35,759,397,'y → 批准这次','green')+chip(510,759,407,'回车 / n → 拒绝','red')),
'SDK 请求还带有独立 request ID，响应必须与其对应。CLI 只有在输入和输出都是真实 TTY 时接受审批回答。');
// P10: request IDs and frozen inputs across two calls.
page('10-once.html','单次授权','同一个工具，\n下一次还要重新判断','一次批准绑定一个请求，以及当时保存的参数快照。',svg(849,'调用A创建审批请求A，用户回答请求A才执行A；调用B创建新请求B，旧回答不能批准B',
[[120,'工具调用'],[470,'权限控制器'],[830,'用户']].map(([x,s])=>rect(x-115,15,230,70,C.soft,C.line)+text(x,62,s,32,C.ink,650,'middle')+path(`M${x} 104V824`,C.line,false,'8 9')).join('')+
text(58,149,'A',32,C.green,700)+text(159,143,'write_file',27,C.ink,400,'start','mono')+path('M120 171H470')+
rect(317,201,307,100,C.amberBg,C.amber)+text(470,243,'创建请求 req-A',29,C.amber,650,'middle')+text(470,283,'保存参数快照',29,C.ink,400,'middle')+
path('M470 360H830',C.amber)+text(650,349,'请求 req-A',29,C.amber,600,'middle')+
path('M830 415H470',C.green)+text(650,402,'批准 req-A',29,C.green,600,'middle')+
path('M470 491H120',C.green)+text(294,480,'重查后执行 A',28,C.green,650,'middle')+
path('M20 545H931',C.line,false)+text(57,601,'B',32,C.amber,700)+text(159,595,'write_file',27,C.ink,400,'start','mono')+path('M120 620H470')+
rect(317,650,307,76,C.amberBg,C.amber)+text(470,699,'新请求 req-B',29,C.amber,650,'middle')+
path('M830 786H630',C.red)+cross(610,786)+text(716,769,'旧回答 req-A',27,C.red,600,'middle')),
'旧回答的 ID 不匹配，就不能放行新请求。批准只绑定当次参数；本课不提供“始终允许”。');
// P11: time and terminal outcomes, not merely a list of errors.
page('11-expiry.html','等待与失效','用户一直没回答，\n调用不能一直悬着','审批默认最多等待 120 秒；失败都回到拒绝结果。',svg(851,'等待窗口从请求开始至120秒超时，超时后拒绝；晚到批准不会执行，异常取消无界面同样拒绝',
text( 30,60,'审批请求发出',35,C.ink,650)+text(907,60,'默认 120s',35,C.amber,700,'end')+
rect(30,121,717,95,C.amberBg,C.amber,8)+text(386,182,'等待有效回答',38,C.amber,650,'middle')+
path('M30 248H921')+circle(30,248,9,C.ink)+circle(747,248,9,C.red)+text(30,301,'0s',29,C.muted,500,'start','mono')+text(785,301,'超时',31,C.red,650,'start')+
path('M747 262V358',C.red)+rect(550,368,382,111,C.redBg,C.red)+cross(603,423)+text(770,437,'本次拒绝',38,C.red,700,'middle')+
path('M90 408H511',C.red)+text(286,385,'超时后才到的 y',31,C.red,600,'middle')+cross(518,408)+text(281,461,'已失效，不再触发执行',30,C.muted,400,'middle')+
text(30,551,'这些情况也会结束等待',33,C.ink,650)+
[[30,'没有审批界面','无处理器 / 非 TTY'],[354,'响应无效','ID 错误 / 回调异常'],[678,'等待被终止','Ctrl+C / EOF / 取消']].map(([x,a,b])=>rect(x,590,274,150,C.white,C.line)+text(x+137,645,a,32,C.red,650,'middle')+text(x+137,696,b,25,C.muted,400,'middle')).join('')+
text(476,808,'结束后清理计时器与挂起项',31,C.muted,600,'middle')),
'这里的取消只终结正在等待的审批，不会撤销已执行的工具，也不代表整轮对话已取消。');
// P13: matching identifiers and actual outcomes.
page('13-receipts.html','消息配对','拒绝执行之后，\n模型会收到什么？','每个 tool_use 都要有对应的 tool_result。',svg(846,'模型调用call-7被拒绝后生成相同tool_use_id的错误结果，进入下一轮请求，工具没有执行',
rect(0,16,952,176,C.white,C.ink)+text(31, 60,'模型 → Harness',28,C.muted,600)+text(31,111,'tool_use',38,C.ink,700,'start','mono')+text(31,162,'name: write_file',30,C.ink,400,'start','mono')+chip(610, 80,308,'id: call-7','amber')+
path('M476 192V257',C.red)+rect(301,267,350,90,C.redBg,C.red)+cross(347,313)+text(500,326,'权限拒绝',38,C.red,650,'middle')+
path('M651 313H817V381',C.red,false)+cross(817,398)+text(817,448,'工具未执行',29,C.red,650,'middle')+
path('M476 357V464',C.red)+rect(0,474,952,239,C.ink,C.ink)+text(30,521,'Harness → 下一次模型请求',28,C.paper,600)+text(30,580,'tool_result',38,C.paper,700,'start','mono')+text(30,634,'tool_use_id: "call-7"',31,C.paper,500,'start','mono')+text(30,677,'is_error: true',29,'#F3A599',600,'start','mono')+text(391,677,'原因: Permission denied',27,'#F3A599',500,'start','mono')+
path('M851 168H935V474',C.amber,false,'7 8')+path('M935 474V633H509','#E4C181',false,'7 8')+text(860,241,'同一 ID',28,C.amber,650,'middle')+
path('M476 713V765')+text(476,821,'模型知道：这次写入被拒绝，可以调整后续操作。',32,C.ink,600,'middle')),
'拒绝原因与调用 ID 一起保留。工具没有运行，就不能给模型一个“写入成功”的结果；同批其它调用仍各自配对。');
// P14: two gates with independent meaning, plus PTY output ownership.
page('14-two-layers.html','人工终端','允许启动命令，\n还要确认终端交给谁','模型提出 terminal 时，依次经过两层确认。',svg(841,'模型终端调用先经过权限审批，再经过人工PTY接管确认；人直接操作终端，只把结束状态返回模型',
rect(246,15,460,80,C.soft,C.line)+text(476,66,'模型提出 terminal',34,C.ink,650,'middle')+path('M476 95V152')+
rect(57,161,839,156,C.white,C.amber)+num(103,206,'1')+text(157,219,'通用权限',37,C.ink,650)+text(157,275,'这个命令，是否允许执行？',33)+chip(665,202,198,'批准本次','amber')+
path('M476 317V391',C.green)+text(520,365,'通过后',28,C.green,600)+
rect(57,401,839,156,C.white,C.ink)+num(103,446,'2')+text(157,459,'人工 PTY 交接',37,C.ink,650)+text(157,516,'现在是否把键盘与终端交给人？',31)+
path('M476 557V622')+
rect(31,631,532,174,C.ink,C.ink)+text( 60,680,'人 ↔ 交互终端',36,C.paper,650)+text(60,732,'输入、密码、完整终端正文',30,C.paper)+text(60,780,'由人直接查看与操作',30,C.paper)+
path('M569 708H691',C.green)+text(636,676,'结束后',26,C.green,600,'middle')+rect(708,646,221,142,C.greenBg,C.green)+text(819,700,'状态摘要',32,C.green,650,'middle')+text(819,750,'返回模型',30,C.ink,400,'middle')),
'两层确认分别负责执行权限和输入交接。人工终端正文不回传模型；shell 仍需独立的系统隔离。');
// P15: executable exercise and observable file outcomes.
page('15-practice.html','动手验证','先拒绝，再批准，\n直接检查文件有没有生成','在工程仓库运行离线示例，不调用模型。',
`<div class="terminal" data-block><p class="mini">工程仓库根目录 · 跟练命令</p><pre>pnpm install --frozen-lockfile
pnpm build
node \\
  scripts/e03-s002-permission-demo.mjs</pre></div>`+
svg(470,'离线示例对照拒绝和批准，拒绝时deny.txt不存在，批准时allow.txt存在，均通过生产执行入口',
rect(0,15,452,438,C.redBg,C.red)+text(30,69,'试验 A · 回答 deny',33,C.red,650)+doc(60,113,99,125,C.red)+cross(230,180)+text( 30,290,'deny.txt 不存在',33,C.red,650)+lines(30,351,['fileExists: false','is_error: true'],28,C.ink,400,'start',1.7,'mono')+
rect(500,15,452,438,C.greenBg,C.green)+text(530,69,'试验 B · 回答 allow',33,C.green,650)+doc(560,113,99,125,C.green)+check( 730,180)+text(530,290,'allow.txt 已写入',33,C.green,650)+lines(530,351,['fileExists: true','内容: approved once'],27,C.ink,400,'start',1.7,'mono')),
'脚本通过真实执行入口验证文件效果，退出后清理。亲自回答 y/N 的练习见配套 follow-along.md。','practice');
// P16: the whole loop, then a specific bridge to S003.
page('16-next.html','本课闭环','权限已接入，\n下一步把运行过程展示出来','E03-S002 · 权限与一次 Approval',svg(784,'本课工具调用经过判断，必要时审批，执行前重查并生成配对结果；下一课把状态和控制接入TUI',
text( 30,58,'本课实现的执行链',31,'#C4CDBF',600)+
[[30,124,'工具调用'],[349,124,'权限判断'],[668,124,'必要时审批']].map(([x,y,s])=>rect(x,y,255,100,'#314034','#81917E')+text(x+127,y+63,s,32,C.paper,650,'middle')).join('')+
path('M292 174H340','#B6D5C4')+path('M610 174H659','#B6D5C4')+path('M796 224V321H475V366','#B6D5C4')+
rect(280,375,392,104,'#314034','#81917E')+text(476,440,'重查 / 执行 / 配对结果',31,C.paper,650,'middle')+
path('M476 479V561','#B6D5C4')+rect(0,572,952,180,'#F4F1EA','#F4F1EA')+text( 30,622,'下一课 · E03-S003',29,C.green,650)+text(30,682,'运行状态与 TUI',46,C.ink,700)+text(30,730,'看见工具进度，在界面里审批与控制。',31,C.ink)),
'课程免费开源。按配套跟练观察真实文件效果，再对照源码理解每一个分支。','dark closing');

function write(){const manifest=JSON.parse(fs.readFileSync('pages.json'));for(const p of pages){const i=manifest.pages.findIndex(q=>q.file===p.file);if(i<0)throw new Error("Page missing from pages.json: "+p.file);const n=String(i+1).padStart(2,'0');let body;if(n==='01'){body=`<main class="sheet cover" data-page="01"><div class="cover-frame"><header class="page-header"><span>Zero2Agent</span><span class="page-number">Epic. 03 / Story 002</span></header><div class="masthead" data-block><p class="eyebrow">从零实现 CODING AGENT</p><h1>${esc(p.title).replaceAll('\n','<br>')}</h1><p class="cover-sub" data-prose>${p.deck}</p></div><div class="cover-hero" data-block>${p.diagram}</div><div class="cover-tags" data-block><span>工程实战</span><span>真实经验</span><span>开源项目</span></div></div></main>`;}else{body=`<main class="sheet ${p.extra}" data-page="${n}"><header class="page-header"><span>Zero2Agent • ${p.section}</span><span class="page-number">${n}</span></header><div class="heading" data-block><h1>${esc(p.title).replaceAll('\n','<br>')}</h1><p class="deck" data-prose>${p.deck}</p></div><div class="content">${p.diagram}${p.note?`<p class="explain" data-prose data-block>${p.note}</p>`:''}</div></main>`;}fs.writeFileSync(p.file,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080"><title>${esc(p.title.replaceAll('\n',''))}</title><link rel="stylesheet" href="course.css"></head><body>${body}</body></html>\n`);manifest.pages[i].title=p.title.replaceAll('\n','');}manifest.date='2026-10-06';manifest.edition='v2-illustrated-permissions';fs.writeFileSync('pages.json',JSON.stringify(manifest,null,2)+'\n');}
write();
