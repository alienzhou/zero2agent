const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const pad = value => String(value).padStart(2, '0');
const storageKey = 'zero2agent.book.progress.v1';
const main = $('#main');
const outline = $('#outline');
const sidebar = $('#sidebar');
const dialog = $('#search-dialog');
let course;
let currentChapter = null;
let activePage = null;
let resizeObserver = null;
let saveTimer = null;
let scrollPending = false;
let restoring = false;
let progress = readStorage(storageKey, {chapters: {}, last: null});
if (!progress || typeof progress !== 'object' || !progress.chapters || typeof progress.chapters !== 'object') progress = {chapters: {}, last: null};

function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Reading works without browser storage. */ }
}
function routeURL(chapter, page) {
  return '#/chapter/' + chapter.id + (page ? '/' + page.id : '');
}
function footer() {
  return '<footer class="book-footer">Zero2Agent · 从零实现 Coding Agent &nbsp; / &nbsp; 免费开源实战教程</footer>';
}
function isCompleted(chapter) { return Boolean(progress.chapters[chapter.id]?.completed); }
function renderNav() {
  $('#course-nav').innerHTML = '<a class="course-home" href="#/"' + (!currentChapter ? ' aria-current="page"' : '') + '><span aria-hidden="true">⌂</span>课程总览</a>' + course.epics.map(epic =>
    '<section class="nav-group"><h2 class="nav-group-heading"><span>' + escapeHTML(epic.title) + '</span><span>' + pad(epic.number) + '</span></h2>' +
    course.chapters.filter(chapter => chapter.epic === epic.id).map(chapter =>
      '<a class="chapter-link" href="' + routeURL(chapter) + '"' + (currentChapter?.id === chapter.id ? ' aria-current="page"' : '') + '><span class="chapter-number">' + pad(chapter.number) + '</span><span>' + escapeHTML(chapter.title) + '</span>' + (isCompleted(chapter) ? '<span class="chapter-check" aria-label="已读完">✓</span>' : '') + '</a>'
    ).join('') + '</section>'
  ).join('');
}
function renderHome() {
  const completed = course.chapters.filter(isCompleted).length;
  const lastChapter = course.chapters.find(chapter => chapter.id === progress.last?.chapter);
  const lastPage = lastChapter?.pages.find(page => page.id === progress.last?.page);
  main.innerHTML = '<section class="home-hero"><p class="eyebrow">A PRACTICAL GUIDE TO AGENT HARNESS</p><h1>从零开始，<br>做一个能动手的 <em>Agent。</em></h1><p class="home-description">从第一行代码到产品级 Agent Harness。一起搭建循环、工具与上下文，在真实工程问题中理解 Coding Agent 是怎样工作的。</p><a class="primary-link" href="' + routeURL(lastChapter || course.chapters[0], lastPage) + '">' + (lastChapter ? '继续阅读' : '从第一章开始') + '<span aria-hidden="true">→</span></a><a class="quiet-link" href="#/chapter/' + course.chapters.at(-1).id + '">查看最新章节 ↗</a><div class="hero-stats"><span><strong>' + course.chapters.length + '</strong> 个章节</span><span><strong>' + course.totalPages + '</strong> 篇图解</span><span><strong>TypeScript</strong> 工程实战</span></div></section>' +
    '<figure class="loop-figure"><figcaption class="loop-title"><span>先理解一个最小的 Agent 闭环</span><span>REACT LOOP</span></figcaption><div class="loop-nodes"><div class="loop-node"><strong>01 · THINK</strong>思考下一步</div><span class="loop-arrow" aria-hidden="true">→</span><div class="loop-node accent"><strong>02 · ACT</strong>调用工具</div><span class="loop-arrow" aria-hidden="true">→</span><div class="loop-node"><strong>03 · OBSERVE</strong>观察结果</div></div><p class="loop-return">↳ 把结果带回对话，继续思考，直到任务完成 ↲</p></figure>' +
    course.epics.map(epic => '<section class="course-section" id="' + epic.id + '"><div class="course-section-heading"><span class="part-number">' + pad(epic.number) + '</span><div><h2>' + escapeHTML(epic.title) + '</h2><p>' + escapeHTML(epic.description) + '</p></div></div>' +
      course.chapters.filter(chapter => chapter.epic === epic.id).map(chapter => '<a class="lesson-row" href="' + routeURL(chapter) + '"><span class="lesson-row-number">' + pad(chapter.number) + '</span><div><h3>' + escapeHTML(chapter.title) + '</h3><p>' + escapeHTML(chapter.description) + '</p></div><div class="lesson-row-tail">' + (isCompleted(chapter) ? '已读完 ✓' : chapter.pages.length + ' 篇图解') + '<span aria-hidden="true">↗</span></div></a>').join('') + '</section>').join('') + footer();
  outline.innerHTML = '<h2 class="outline-heading">如何阅读这门课</h2><div class="home-guide"><p><strong>从一个最小闭环开始</strong>先让 Agent 会看、会查，再一步步接上行动能力。</p><p><strong>每章聚焦一个能力</strong>图解建立理解，源码与设计文档帮助你深入和跟练。</p><p><strong>按自己的节奏阅读</strong>可以顺着课程学，也可以从目录直接进入关心的问题。</p></div><h2 class="outline-heading">课程路线</h2><div class="outline-list">' +
    course.epics.map(epic => '<a class="outline-link" href="#' + epic.id + '" data-home-anchor="' + epic.id + '">' + pad(epic.number) + ' &nbsp; ' + escapeHTML(epic.title) + '</a>').join('') + '</div><div class="outline-note">你的阅读进度<div class="progress-track"><span style="width:' + (completed / course.chapters.length * 100) + '%"></span></div><div class="progress-caption"><span>已读完 ' + completed + ' 章</span><span>共 ' + course.chapters.length + ' 章</span></div><p>进度保存在当前浏览器中。</p></div>';
  $('#outline-button').hidden = true;
}
function renderChapter(chapter) {
  const epic = course.epics.find(item => item.id === chapter.epic);
  const chapterIndex = course.chapters.indexOf(chapter);
  const previous = course.chapters[chapterIndex - 1];
  const next = course.chapters[chapterIndex + 1];
  main.innerHTML = '<nav class="breadcrumbs" aria-label="当前位置"><a href="#/">课程总览</a><span>/</span><span>' + escapeHTML(epic.title) + '</span><span>/</span><span>第 ' + pad(chapter.number) + ' 章</span></nav><header class="chapter-header"><p class="eyebrow">CHAPTER ' + pad(chapter.number) + ' · ' + escapeHTML(chapter.code) + '</p><h1>' + escapeHTML(chapter.title) + '</h1><p class="chapter-description">' + escapeHTML(chapter.description) + '</p><div class="chapter-meta"><span>' + chapter.pages.length + ' 篇图解</span><span>·</span><span>按顺序连续阅读</span><a href="' + chapter.sourceURL + '" target="_blank" rel="noopener noreferrer">设计文档与源码 ↗</a></div></header><p class="reading-note">用右侧目录跳到具体问题。图解可放大查看，也可以展开文字内容。</p>' +
    chapter.pages.map(page => '<section class="lesson-section" id="' + page.id + '" data-page="' + page.id + '"><div class="section-heading"><span>' + pad(page.number) + '</span><h2>' + escapeHTML(page.title) + '</h2><button class="zoom-button" data-zoom="' + page.id + '" aria-expanded="false">放大图解</button></div><div class="figure-viewport"><div class="figure-stage"><iframe loading="lazy" width="1080" height="1440" title="' + escapeHTML(page.title) + '" src="./chapters/' + chapter.id + '/' + page.file + '" scrolling="no" sandbox="allow-same-origin"></iframe></div></div><details class="text-content"><summary>文字内容</summary>' + page.paragraphs.map(text => '<p>' + escapeHTML(text) + '</p>').join('') + '</details></section>').join('') +
    '<div class="chapter-finish"><p>读完这一章了？<small>标记后，可以在课程目录中查看进度。</small></p><button class="complete-button" id="complete-button">' + (isCompleted(chapter) ? '已读完 ✓ · 取消标记' : '标记本章已读完 ✓') + '</button></div><nav class="chapter-pagination" aria-label="章节翻页"><a href="' + (previous ? routeURL(previous) : '#/') + '"><span>← ' + (previous ? '上一章' : '返回课程总览') + '</span><strong>' + escapeHTML(previous?.title || '查看完整学习路线') + '</strong></a><a href="' + (next ? routeURL(next) : '#/') + '"><span>' + (next ? '下一章 →' : '回到课程总览 →') + '</span><strong>' + escapeHTML(next?.title || '继续按自己的节奏学习') + '</strong></a></nav>' + footer();
  outline.innerHTML = '<div class="drawer-heading mobile-only"><strong>本章目录</strong><button class="icon-button" data-close-drawer aria-label="关闭本章目录">×</button></div><h2 class="outline-heading">本章内容</h2><nav class="outline-list">' + chapter.pages.map(page => '<a class="outline-link" data-outline-page="' + page.id + '" href="' + routeURL(chapter, page) + '"><small>' + pad(page.number) + '</small>' + escapeHTML(page.title) + '</a>').join('') + '</nav><div class="outline-note"><div class="progress-caption"><span>当前小节</span><span id="page-count">1 / ' + chapter.pages.length + '</span></div><div class="progress-track"><span id="chapter-progress" style="width:0"></span></div><a href="' + chapter.sourceURL + '" target="_blank" rel="noopener noreferrer">结合源码跟练 ↗</a></div>';
  $('#outline-button').hidden = false;
  resizeObserver = new ResizeObserver(() => resizeFigures());
  $$('.figure-viewport').forEach(viewport => resizeObserver.observe(viewport));
  resizeFigures();
  $$('iframe', main).forEach(frame => frame.addEventListener('load', () => {
    try {
      const style = frame.contentDocument.createElement('style');
      style.textContent = 'html,body{margin:0!important;overflow:hidden!important}';
      frame.contentDocument.head.append(style);
    } catch { /* Navigation remains available if a page cannot be opened. */ }
  }));
}
function resizeFigures() {
  $$('.figure-viewport').forEach(viewport => {
    const expanded = viewport.closest('.lesson-section').classList.contains('expanded');
    const scale = Math.min(1, expanded ? Math.max(.85, viewport.clientWidth / 1080) : viewport.clientWidth / 1080);
    const stage = $('.figure-stage', viewport);
    stage.style.width = (1080 * scale) + 'px';
    stage.style.height = (1440 * scale) + 'px';
    $('iframe', stage).style.transform = 'scale(' + scale + ')';
  });
}
function setActivePage(page, persist = true) {
  if (!currentChapter || !page) return;
  activePage = page;
  $$('[data-outline-page]').forEach(link => {
    if (link.dataset.outlinePage === page.id) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
  $('#page-count').textContent = page.number + ' / ' + currentChapter.pages.length;
  $('#chapter-progress').style.width = (page.number / currentChapter.pages.length * 100) + '%';
  if (persist && !restoring) {
    history.replaceState(null, '', routeURL(currentChapter, page));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(savePosition, 180);
  }
}
function savePosition() {
  if (!currentChapter || !activePage) return;
  const section = document.getElementById(activePage.id);
  const offset = section ? Math.min(1, Math.max(0, (100 - section.getBoundingClientRect().top) / section.offsetHeight)) : 0;
  const saved = progress.chapters[currentChapter.id] || {};
  progress.chapters[currentChapter.id] = {page: activePage.id, offset, completed: Boolean(saved.completed)};
  progress.last = {chapter: currentChapter.id, page: activePage.id};
  writeStorage(storageKey, progress);
}
function trackScroll() {
  if (!currentChapter || restoring || scrollPending) return;
  scrollPending = true;
  requestAnimationFrame(() => {
    scrollPending = false;
    let page = currentChapter?.pages[0];
    for (const candidate of currentChapter?.pages || []) {
      if (document.getElementById(candidate.id).getBoundingClientRect().top <= 160) page = candidate;
      else break;
    }
    setActivePage(page);
  });
}
function parseRoute() {
  const parts = location.hash.slice(1).split('/').filter(Boolean);
  if (!parts.length) return {home: true};
  if (parts[0] !== 'chapter') return {missing: true};
  const chapter = course.chapters.find(item => item.id === parts[1]);
  if (!chapter) return {missing: true};
  const page = parts[2] ? chapter.pages.find(item => item.id === parts[2]) : null;
  if (parts[2] && !page) return {missing: true};
  return {chapter, page};
}
function handleRoute(initial = false) {
  const route = parseRoute();
  closeDrawers();
  if (dialog.open) dialog.close();
  clearTimeout(saveTimer);
  if (route.chapter && route.chapter === currentChapter && !initial) {
    const target = route.page || route.chapter.pages[0];
    setActivePage(target, false);
    document.getElementById(target.id).scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    return;
  }
  savePosition();
  resizeObserver?.disconnect();
  currentChapter = route.chapter || null;
  activePage = null;
  restoring = true;
  if (route.home) {
    renderHome();
    document.title = 'Zero2Agent · 从零实现 Coding Agent';
  } else if (route.missing) {
    main.innerHTML = '<h1>没有找到这一节</h1><p>可以从课程目录选择章节，继续阅读。</p><a class="primary-link" href="#/">回到课程总览 →</a>';
    outline.innerHTML = '';
    $('#outline-button').hidden = true;
  } else {
    renderChapter(route.chapter);
    document.title = route.chapter.title + ' · Zero2Agent';
    setActivePage(route.page || route.chapter.pages[0], false);
  }
  renderNav();
  window.scrollTo(0, 0);
  requestAnimationFrame(() => {
    if (route.chapter && route.page) {
      const target = document.getElementById(route.page.id);
      const saved = progress.chapters[route.chapter.id];
      const offset = initial && saved?.page === route.page.id ? Math.min(1, Math.max(0, Number(saved.offset) || 0)) : 0;
      window.scrollTo(0, window.scrollY + target.getBoundingClientRect().top - 92 + offset * target.offsetHeight);
    }
    restoring = false;
    if (route.chapter) savePosition();
    if (!initial) main.focus({preventScroll: true});
  });
}
function highlight(text, query) {
  if (!query) return escapeHTML(text);
  const position = text.toLowerCase().indexOf(query.toLowerCase());
  return position < 0 ? escapeHTML(text) : escapeHTML(text.slice(0, position)) + '<mark>' + escapeHTML(text.slice(position, position + query.length)) + '</mark>' + escapeHTML(text.slice(position + query.length));
}
function renderSearch() {
  const query = $('#search-input').value.trim();
  let results = [];
  if (!query) {
    results = course.chapters.map(chapter => ({chapter, page: chapter.pages[0], score: 0}));
  } else {
    const terms = query.toLowerCase().split(/\s+/);
    for (const chapter of course.chapters) {
      for (const page of chapter.pages) {
        const text = (chapter.title + ' ' + page.title + ' ' + page.paragraphs.join(' ')).toLowerCase();
        if (!terms.every(term => text.includes(term))) continue;
        const score = terms.reduce((sum, term) => sum + (page.title.toLowerCase().includes(term) ? 4 : 0) + (chapter.title.toLowerCase().includes(term) ? 2 : 0), 0);
        results.push({chapter, page, score});
      }
    }
    results.sort((a, b) => b.score - a.score);
  }
  $('#search-count').textContent = query ? '找到 ' + results.length + ' 个小节' + (results.length > 30 ? ' · 显示前 30 个结果' : '') : '选择章节，或输入关键词搜索';
  $('#search-results').innerHTML = results.slice(0, 30).map(({chapter, page}) => {
    const body = page.paragraphs.join(' ');
    const position = body.toLowerCase().indexOf(query.toLowerCase());
    const start = Math.max(0, position - 25);
    const excerpt = body.slice(start, start + 110);
    return '<a class="search-result" href="' + routeURL(chapter, query ? page : null) + '"><small>第 ' + pad(chapter.number) + ' 章 · ' + escapeHTML(chapter.title) + '</small><strong>' + highlight(query ? page.title : chapter.title, query) + '</strong><p>' + highlight(query ? (start ? '…' : '') + excerpt : chapter.description, query) + '</p></a>';
  }).join('') || '<p class="home-guide">没有找到相关小节，试试工具名、章节名或另一个关键词。</p>';
}
function openSearch() {
  if (!course) return;
  closeDrawers();
  $('#search-input').value = '';
  renderSearch();
  dialog.showModal();
  $('#search-input').focus();
}
function closeDrawers() {
  sidebar.classList.remove('open');
  outline.classList.remove('open');
  $('#scrim').hidden = true;
  $('#menu-button').setAttribute('aria-expanded', 'false');
  $('#outline-button').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('drawer-open');
  updateDrawerAccess();
}
function updateDrawerAccess() {
  sidebar.inert = matchMedia('(max-width: 760px)').matches && !sidebar.classList.contains('open');
  outline.inert = matchMedia('(max-width: 1000px)').matches && !outline.classList.contains('open');
}
function openDrawer(kind) {
  const panel = kind === 'menu' ? sidebar : outline;
  const button = kind === 'menu' ? $('#menu-button') : $('#outline-button');
  const wasOpen = panel.classList.contains('open');
  closeDrawers();
  if (wasOpen) return;
  panel.classList.add('open');
  button.setAttribute('aria-expanded', 'true');
  $('#scrim').hidden = false;
  document.body.classList.add('drawer-open');
  updateDrawerAccess();
  $('button, a', panel)?.focus();
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#theme-button').setAttribute('aria-label', theme === 'dark' ? '切换浅色主题' : '切换深色主题');
}
applyTheme(readStorage('zero2agent.book.theme', 'light'));
$('#theme-button').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme); writeStorage('zero2agent.book.theme', theme);
});
$('#search-button').addEventListener('click', openSearch);
$('#search-close').addEventListener('click', () => dialog.close());
$('#search-input').addEventListener('input', renderSearch);
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => $('#search-button').focus({preventScroll: true}));
$('#menu-button').addEventListener('click', () => openDrawer('menu'));
$('#outline-button').addEventListener('click', () => openDrawer('outline'));
$('#scrim').addEventListener('click', closeDrawers);
document.addEventListener('click', event => {
  const close = event.target.closest('[data-close-drawer]');
  if (close) { closeDrawers(); $('#menu-button').focus(); }
  const homeAnchor = event.target.closest('[data-home-anchor]');
  if (homeAnchor) {
    event.preventDefault();
    document.getElementById(homeAnchor.dataset.homeAnchor)?.scrollIntoView({behavior: 'smooth'});
  }
  const zoom = event.target.closest('[data-zoom]');
  if (zoom) {
    const expanded = document.getElementById(zoom.dataset.zoom).classList.toggle('expanded');
    zoom.setAttribute('aria-expanded', String(expanded));
    zoom.textContent = expanded ? '适合屏幕' : '放大图解';
    resizeFigures();
  }
  if (event.target.closest('#complete-button')) {
    savePosition();
    const saved = progress.chapters[currentChapter.id];
    saved.completed = !saved.completed;
    writeStorage(storageKey, progress);
    $('#complete-button').textContent = saved.completed ? '已读完 ✓ · 取消标记' : '标记本章已读完 ✓';
    renderNav();
  }
  const searchResult = event.target.closest('.search-result');
  if (searchResult) {
    dialog.close();
    if (searchResult.getAttribute('href') === location.hash) handleRoute();
  }
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault(); openSearch();
  }
  if (event.key === 'Escape' && !dialog.open) closeDrawers();
  const drawer = sidebar.classList.contains('open') ? sidebar : outline.classList.contains('open') ? outline : null;
  if (event.key === 'Tab' && drawer) {
    const controls = $$('button, a', drawer).filter(control => control.offsetParent !== null);
    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
  }
});
window.addEventListener('scroll', trackScroll, {passive: true});
window.addEventListener('pagehide', savePosition);
window.addEventListener('resize', () => { closeDrawers(); resizeFigures(); });
window.addEventListener('hashchange', () => { if (course) handleRoute(); });
updateDrawerAccess();
try {
  const response = await fetch(new URL('../course.json', import.meta.url));
  if (!response.ok) throw new Error('课程目录暂时无法加载');
  course = await response.json();
  handleRoute(true);
} catch {
  main.innerHTML = '<h1>课程目录暂时无法加载</h1><p>请刷新页面重试。</p>';
}
