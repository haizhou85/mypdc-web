'use strict';
// 我的 PDC：队伍库 —— 任何人无需登录都能把编队保存成新队伍；列表查看、分享链接；只有管理员（知道管理密码）能删除
// 后端地址由构建时生成的 mypdc-config.js 提供（window.MYPDC_API）
(function () {
	const API = (window.MYPDC_API || '').replace(/\/+$/, '');
	if (!API) return;
	const { load, save, el } = MyPDC;
	const PAGE_FILE = { solo: 'solo.html', multi: 'multi.html', triple: 'triple.html' };
	const PAGE_TEXT = { solo: '单人', multi: '2人协力', triple: '3人' };
	const SERVER_TEXT = { ja: '日服', en: '美服', ko: '韩服' };
	const base = new URL('.', location.href);

	async function api(path, opts = {}) {
		const headers = Object.assign({}, opts.headers);
		if (opts.body) headers['Content-Type'] = 'application/json';
		const adminKey = load('admin-key', '');
		if (adminKey && opts.admin) headers['X-Admin-Key'] = adminKey;
		const res = await fetch(API + path, { method: opts.method || 'GET', cache: 'no-store', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
		let data = null;
		try { data = await res.json(); } catch (e) { /* 空响应 */ }
		if (!res.ok) throw new Error(data?.error || `请求失败（${res.status}）`);
		return data;
	}

	const shareUrl = id => new URL(`solo.html?team=${id}`, base).href;
	const listUrl = () => new URL('solo.html#teams', base).href;
	function teamUrl(t) {
		const u = new URL(PAGE_FILE[t.page] || 'solo.html', base);
		const l = new URLSearchParams(location.search).get('l');
		if (l) u.searchParams.set('l', l);
		if (t.server && t.server !== 'ja') u.searchParams.set('s', t.server);
		u.searchParams.set('d', JSON.stringify(t.data));
		u.searchParams.set('tid', t.id);
		return u.href;
	}
	function fmtTime(ms) {
		const d = new Date(ms);
		const p = n => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
	}
	async function copy(text, btn) {
		try {
			await navigator.clipboard.writeText(text);
			if (btn) { const old = btn.textContent; btn.textContent = '已复制'; setTimeout(() => { btn.textContent = old; }, 1500); }
		} catch (e) {
			window.prompt('复制这个链接：', text); // eslint-disable-line no-alert
		}
	}
	function cardsReady() { return typeof Cards !== 'undefined' && Cards?.length > 0; }
	function whenCards(fn) {
		if (cardsReady()) return fn();
		const t = setInterval(() => { if (cardsReady()) { clearInterval(t); fn(); } }, 200);
	}
	function headIcon(id) {
		const wrap = el('span', { class: 'mypdc-team-head' });
		if (id > 0 && typeof createCardA === 'function') {
			const dom = createCardA({ noBoxCount: true });
			dom.removeAttribute('href');
			dom.onclick = e => e.preventDefault();
			try { changeid({ id }, dom); } catch (e) { /* 数据没有这只宠物 */ }
			wrap.append(dom);
		}
		return wrap;
	}

	// ---------- 1) 打开分享链接 ?team=编号：读取后跳到对应的编队页面 ----------
	const params = new URLSearchParams(location.search);
	const openId = parseInt(params.get('team'), 10);
	if (openId > 0) {
		document.documentElement.classList.add('mypdc-team-loading');
		const note = el('div', { class: 'mypdc-team-opening-note' }, `正在打开队伍库 #${openId}…`);
		document.documentElement.append(note);
		api(`/api/teams/${openId}`).then(t => location.replace(teamUrl(t))).catch(e => {
			document.documentElement.classList.remove('mypdc-team-loading');
			note.remove();
			window.addEventListener('load', () => showBanner({ error: `队伍库 #${openId}：${e.message}` }));
		});
		return;
	}

	// ---------- 2) 从队伍库打开的队伍：顶部显示名称、作者、备注和分享链接 ----------
	let loaded = null;
	const tid = parseInt(params.get('tid'), 10);
	function showBanner(info) {
		document.querySelector('.mypdc-team-banner')?.remove();
		const box = el('div', { class: 'mypdc-team-banner' });
		if (info.error) box.append(info.error);
		else {
			box.append(...[
				el('div', { class: 'mypdc-team-banner-title' }, `📚 队伍库 #${info.id}　`, el('b', null, info.title),
					info.author ? el('span', { class: 'mypdc-team-meta' }, ` · ${info.author}`) : null,
					el('span', { class: 'mypdc-team-meta' }, ` · ${fmtTime(info.created)}`)),
				info.note ? el('div', { class: 'mypdc-team-note' }, info.note) : null,
				el('div', { class: 'mypdc-team-actions' },
					el('button', { type: 'button', onclick: e => copy(shareUrl(info.id), e.target) }, '🔗 复制分享链接'),
					el('button', { type: 'button', onclick: () => openLibrary() }, '📚 队伍库'),
					el('span', { class: 'mypdc-team-meta' }, '可以直接修改；再保存会存成新的队伍，不会改动这一个')),
			].filter(Boolean));
		}
		const target = document.querySelector('.formation-box') || document.body.firstElementChild;
		target.before(box);
	}
	if (tid > 0) {
		window.addEventListener('load', () => {
			api(`/api/teams/${tid}`).then(t => { loaded = t; showBanner(t); }).catch(() => { /* 已删除等 */ });
		});
	}

	// ---------- 3) 保存到队伍库 ----------
	let saveDlg;
	function openSave() {
		if (!saveDlg) {
			saveDlg = el('div', { class: 'mypdc-panel mypdc-team-dlg display-none' });
			document.body.append(saveDlg);
		}
		const outObj = (MyPDC.assistOff?.fullOutObj?.() || formation.outObj());
		const f = outObj?.f || [];
		const ids = f.map(t => (t?.[0] || []).map(m => (Array.isArray(m) ? m[0] : 0) || 0));
		const empty = !ids.flat().some(id => id > 0);

		const title = el('input', { type: 'text', maxlength: 60, value: formation.title || loaded?.title || '', placeholder: '例如：卯之花 7×6 周回' });
		const author = el('input', { type: 'text', maxlength: 30, value: load('team-author', ''), placeholder: '可不填' });
		const note = el('textarea', { rows: 4, maxlength: 1000, placeholder: '可不填：用途、关卡、操作要点等' });
		note.value = formation.detail || loaded?.note || '';
		const msg = el('div', { class: 'mypdc-team-msg' });
		const submit = el('button', { type: 'button', class: 'mypdc-team-primary' }, '保存');
		submit.onclick = async () => {
			if (!title.value.trim()) { msg.textContent = '请填写队伍名称'; title.focus(); return; }
			submit.disabled = true; msg.textContent = '保存中…';
			save('team-author', author.value.trim());
			try {
				const r = await api('/api/teams', {
					method: 'POST', admin: true,
					body: { title: title.value, author: author.value, note: note.value, server: currentDataSource?.code || 'ja', data: (MyPDC.assistOff?.fullOutObj?.() || formation.outObj()) },
				});
				const link = shareUrl(r.id);
				body.innerHTML = '';
				body.append(
					el('p', null, `已保存为队伍库 #${r.id}。`),
					el('div', { class: 'mypdc-team-link' }, el('input', { type: 'text', readonly: true, value: link, onclick: e => e.target.select() })),
					el('div', { class: 'mypdc-team-actions' },
						el('button', { type: 'button', class: 'mypdc-team-primary', onclick: e => copy(link, e.target) }, '🔗 复制分享链接'),
						el('button', { type: 'button', onclick: () => { close(); openLibrary(); } }, '📚 查看队伍库'),
						el('button', { type: 'button', onclick: close }, '关闭')));
			} catch (e) {
				msg.textContent = e.message;
				submit.disabled = false;
			}
		};
		const close = () => { saveDlg.classList.add('display-none'); document.body.classList.remove('mypdc-panel-open'); };
		const body = el('div', { class: 'mypdc-panel-body' },
			empty ? el('p', null, '队伍是空的，先编好队伍再保存。') : [
				el('label', { class: 'mypdc-team-field' }, el('span', null, '队伍名称'), title),
				el('label', { class: 'mypdc-team-field' }, el('span', null, '作者'), author),
				el('label', { class: 'mypdc-team-field' }, el('span', null, '备注'), note),
				el('p', { class: 'mypdc-hint' }, '保存后任何人都能在队伍库看到。每次保存都会存成一个新的队伍，不会覆盖以前保存的。'),
				msg,
				el('div', { class: 'mypdc-team-actions' }, submit, el('button', { type: 'button', onclick: close }, '取消')),
			]);
		saveDlg.innerHTML = '';
		saveDlg.append(
			el('div', { class: 'mypdc-panel-head' }, el('h2', null, '💾 保存到队伍库'), el('button', { type: 'button', onclick: close }, '关闭')),
			body);
		saveDlg.classList.remove('display-none');
		document.body.classList.add('mypdc-panel-open');
		if (!empty) setTimeout(() => title.focus(), 50);
	}

	// ---------- 4) 队伍库列表 ----------
	let lib, libTitle, libBody, listBox, moreBtn, searchInput, adminBox, pickBar;
	const picked = new Map(); // 多选的队伍（跨搜索保留）
	let items = [], more = false, loading = false, query = '';
	let isAdmin = false;
	let adminView = false; // 通过管理专属链接 #teams-admin 打开

	function buildLibrary() {
		lib = el('div', { class: 'mypdc-panel mypdc-team-lib display-none' });
		searchInput = el('input', { type: 'search', placeholder: '搜索名称、作者、备注，或宠物编号（多个用空格隔开）', class: 'mypdc-team-search' });
		let timer;
		searchInput.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { query = searchInput.value.trim(); reload(); }, 300); };
		listBox = el('div', { class: 'mypdc-team-list' });
		moreBtn = el('button', { type: 'button', class: 'mypdc-more', onclick: () => fetchPage() }, '显示更多');
		adminBox = el('div', { class: 'mypdc-team-admin' });
		libBody = el('div', { class: 'mypdc-panel-body' },
			el('div', { class: 'mypdc-team-toolbar' }, searchInput,
				el('button', { type: 'button', onclick: e => copy(listUrl(), e.target) }, '🔗 复制队伍库链接')),
			listBox, moreBtn);
		pickBar = el('div', { class: 'mypdc-team-pickbar display-none' });
		libTitle = el('h2', null, '📚 队伍库');
		lib.append(
			el('div', { class: 'mypdc-panel-head' }, libTitle, el('button', { type: 'button', onclick: closeLibrary }, '关闭')),
			libBody, pickBar);
		document.body.append(lib);
	}

	// admin=true：管理专属链接打开，先输入管理密码，之后每个队伍有删除按钮；普通队伍库不显示任何管理入口
	async function openLibrary(admin = false) {
		if (!lib) buildLibrary();
		adminView = admin === true;
		lib.classList.remove('display-none');
		lib.classList.toggle('mypdc-team-admin-view', adminView);
		document.body.classList.add('mypdc-panel-open');
		const hash = adminView ? '#teams-admin' : '#teams';
		if (location.hash !== hash) history.replaceState(history.state, '', location.pathname + location.search + hash);
		libTitle.textContent = adminView ? '🔒 队伍库管理' : '📚 队伍库';
		adminBox.remove();
		isAdmin = false;
		if (adminView) {
			libBody.prepend(adminBox);
			adminBox.innerHTML = '';
			adminBox.append('检查管理密码…');
			await checkAdmin();
			renderAdmin();
			if (!isAdmin) { listBox.innerHTML = ''; moreBtn.style.display = 'none'; return; }
		}
		reload();
	}
	function closeLibrary() {
		lib.classList.add('display-none');
		document.body.classList.remove('mypdc-panel-open');
		if (location.hash.startsWith('#teams')) history.replaceState(history.state, '', location.pathname + location.search);
	}

	function reload() { items = []; more = false; listBox.innerHTML = ''; fetchPage(); }
	async function fetchPage() {
		if (loading) return;
		loading = true;
		moreBtn.disabled = true; moreBtn.textContent = '读取中…'; moreBtn.style.display = '';
		const q = query;
		try {
			const before = items.length ? items[items.length - 1].id : 0;
			const r = await api(`/api/teams?limit=30${before ? '&before=' + before : ''}${q ? '&q=' + encodeURIComponent(q) : ''}`);
			if (q !== query) return;
			items.push(...r.items); more = r.more;
			const hitIds = r.ids || [];
			whenCards(() => r.items.forEach(t => listBox.append(renderItem(t, hitIds))));
			if (!items.length) listBox.append(el('p', { class: 'mypdc-team-empty' }, q ? '没有找到符合的队伍。' : '还没有保存的队伍。'));
		} catch (e) {
			listBox.append(el('p', { class: 'mypdc-team-msg' }, e.message));
		} finally {
			loading = false;
			moreBtn.disabled = false; moreBtn.textContent = '显示更多';
			moreBtn.style.display = more ? '' : 'none';
		}
	}

	function renderItem(t, hitIds = []) {
		const row = el('div', { class: 'mypdc-team-item' });
		// 多选（生成合集图片）：只支持单人队伍
		const solo = !t.page || t.page === 'solo';
		const pick = el('input', { type: 'checkbox', class: 'mypdc-team-pick', disabled: !solo, title: solo ? '选中后可生成合集图片' : '合集图片只支持单人队伍' });
		pick.checked = picked.has(t.id);
		pick.onclick = e => e.stopPropagation();
		pick.onchange = () => { if (pick.checked) picked.set(t.id, t); else picked.delete(t.id); row.classList.toggle('mypdc-team-picked', pick.checked); updatePickBar(); };
		row.classList.toggle('mypdc-team-picked', pick.checked);
		// 列表里没有编队数据：点开时再读取完整队伍
		const open = async () => {
			if (row.classList.contains('mypdc-team-opening')) return;
			row.classList.add('mypdc-team-opening');
			try { location.href = teamUrl(await api(`/api/teams/${t.id}`)); } catch (e) {
				row.classList.remove('mypdc-team-opening');
				window.alert(e.message); // eslint-disable-line no-alert
			}
		};
		const hit = id => hitIds.includes(id);
		const heads = el('div', { class: 'mypdc-team-heads' },
			t.members.map(team => el('div', { class: 'mypdc-team-row' }, team.map(id => {
				const h = headIcon(id);
				if (hit(id)) h.classList.add('mypdc-team-hit');
				return h;
			}))));
		// 搜索的编号只在辅助里：列出那些辅助
		const assistHits = (t.assists || []).flat().filter((id, i, a) => hit(id) && a.indexOf(id) === i && !t.members.flat().includes(id));
		if (assistHits.length) heads.append(el('div', { class: 'mypdc-team-row mypdc-team-assisthit' },
			el('span', { class: 'mypdc-team-assistlabel' }, '辅助'), assistHits.map(id => { const h = headIcon(id); h.classList.add('mypdc-team-hit'); return h; })));
		const actions = el('div', { class: 'mypdc-team-item-actions' },
			el('button', { type: 'button', onclick: e => { e.stopPropagation(); copy(shareUrl(t.id), e.target); } }, '🔗'));
		if (adminView && isAdmin) {
			const del = el('button', { type: 'button', class: 'mypdc-team-del' }, '🗑');
			del.onclick = async e => {
				e.stopPropagation();
				if (!del.classList.contains('confirm')) {
					del.classList.add('confirm'); del.textContent = '确认删除';
					setTimeout(() => { del.classList.remove('confirm'); del.textContent = '🗑'; }, 3000);
					return;
				}
				del.disabled = true;
				try {
					await api(`/api/teams/${t.id}`, { method: 'DELETE', admin: true });
					row.remove();
					items = items.filter(x => x.id !== t.id);
				} catch (err) { del.disabled = false; del.textContent = err.message; }
			};
			actions.append(del);
		}
		row.append(
			el('div', { class: 'mypdc-team-pickwrap', onclick: e => { e.stopPropagation(); if (e.target !== pick && !pick.disabled) { pick.checked = !pick.checked; pick.onchange(); } } }, pick),
			heads,
			el('div', { class: 'mypdc-team-info' },
				el('div', { class: 'mypdc-team-title' }, el('span', { class: 'mypdc-team-id' }, `#${t.id}`), ' ', t.title),
				el('div', { class: 'mypdc-team-meta' },
					[t.author, PAGE_TEXT[t.page], SERVER_TEXT[t.server], fmtTime(t.created)].filter(Boolean).join(' · ')),
				t.note ? el('div', { class: 'mypdc-team-note' }, t.note) : null),
			actions);
		row.onclick = open;
		return row;
	}

	// ---------- 多选队伍 → 合集图片（每队：徽章 + 标题，辅助、潜觉、队员） ----------
	function updatePickBar() {
		if (!pickBar) return;
		pickBar.innerHTML = '';
		pickBar.classList.toggle('display-none', picked.size === 0);
		if (!picked.size) return;
		pickBar.append(
			el('span', null, `已选 ${picked.size} 队`),
			el('button', { type: 'button', class: 'mypdc-team-collage-btn', onclick: makeCollage }, '🖼 生成合集图片'),
			el('button', { type: 'button', onclick: () => { picked.clear(); listBox.querySelectorAll('.mypdc-team-pick').forEach(c => { c.checked = false; }); listBox.querySelectorAll('.mypdc-team-picked').forEach(r => r.classList.remove('mypdc-team-picked')); updatePickBar(); } }, '清空'));
	}
	const sleep = ms => new Promise(r => setTimeout(r, ms));
	async function waitImages(root) { // 等头像、潜觉等背景图载入
		const urls = new Set();
		root.querySelectorAll('*').forEach(n => {
			const bg = getComputedStyle(n).backgroundImage;
			(bg.match(/url\("?([^")]+)"?\)/g) || []).forEach(u => urls.add(u.replace(/^url\("?|"?\)$/g, '')));
		});
		await Promise.all([...urls].map(u => new Promise(res => { const i = new Image(); i.onload = i.onerror = res; i.src = u; })));
	}
	// 徽章：底框和图案都是固定像素的贴图，直接切出来画（比 html2canvas 快）
	const imgCache = new Map();
	function loadImg(url) {
		if (!imgCache.has(url)) imgCache.set(url, new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }));
		return imgCache.get(url);
	}
	async function drawBadge(badge) {
		const W = badge.offsetWidth || 102, H = badge.offsetHeight || 76;
		const c = document.createElement('canvas');
		c.width = W * 2; c.height = H * 2;
		const g = c.getContext('2d');
		g.scale(2, 2);
		for (const cs of [getComputedStyle(badge), getComputedStyle(badge, '::before')]) {
			const m = cs.backgroundImage.match(/url\("?([^")]+)"?\)/);
			if (!m) continue;
			const [px, py] = cs.backgroundPosition.split(' ').map(v => (v.endsWith('%') ? 0 : -parseFloat(v) || 0));
			try {
				const img = await loadImg(m[1]);
				const w = parseFloat(cs.width) || W, h = parseFloat(cs.height) || H;
				g.drawImage(img, px, py, w, h, 0, 0, w, h);
			} catch (e) { /* 图片读不到就跳过 */ }
		}
		return c;
	}
	async function makeCollage() {
		if (typeof html2canvas !== 'function' || typeof formation === 'undefined') return;
		const list = [...picked.values()];
		const overlay = el('div', { class: 'mypdc-collage-overlay' }, el('div', { class: 'mypdc-collage-msg' }, '准备中…'));
		document.body.append(overlay);
		const msg = overlay.firstChild;
		const saved = JSON.parse(JSON.stringify(formation.getPdfQrObj(false).d));
		const savedScroll = window.scrollY;
		lib.classList.add('display-none');
		MyPDC.capturing = true; // 手机上队伍区用 zoom 缩放，截图时先恢复原尺寸
		document.body.classList.add('mypdc-capturing');
		document.querySelectorAll('[style*="zoom"]').forEach(n => { if (n.closest('.formation-box') || n.matches('.formation-box')) n.style.zoom = ''; });
		const scaler = document.querySelector('.mypdc-scale-inner');
		const savedTransform = scaler?.style.transform;
		if (scaler) scaler.style.transform = 'none';
		let stage = null;
		try {
			msg.textContent = '读取队伍…';
			const fulls = await Promise.all(list.map(x => api(`/api/teams/${x.id}`)));
			// 每载入一队就把“辅助、潜觉、队员”那块复制到临时区域，最后只截一次图
			for (let i = 0; i < list.length; i++) {
				msg.textContent = `载入队伍 ${i + 1} / ${list.length}…`;
				const t = fulls[i];
				formation.loadObj(); // 先清空：原网站载入时遇到空位（0）不会清掉上一队的队员
				formation.loadObj(t.data);
				refreshAll(formation);
				// 等页面刷新完（部分头像是在下一轮才更新的），再复制
				await new Promise(r => requestAnimationFrame(() => setTimeout(r, 60)));
				const box = document.querySelector('.formation-box .team-bigbox .team-box');
				await waitImages(box);
				const badge = document.querySelector('.formation-box .team-bigbox .team-badge');
				if (!stage) {
					stage = el('div', { class: 'mypdc-collage-stage' });
					stage.style.width = (box.offsetWidth + 16) + 'px'; // 每块左右各 8px 内边距
					box.parentNode.append(stage);
				}
				const head = el('div', { class: 'mypdc-collage-head' });
				if (badge && Number(formation.teams[0][2])) head.append(await drawBadge(badge));
				head.append(el('span', { class: 'mypdc-collage-title' }, t.title || `#${t.id}`));
				stage.append(el('div', { class: 'mypdc-collage-block' }, head, box.cloneNode(true)));
			}
			msg.textContent = '生成图片…';
			document.querySelectorAll('.formation-box, .formation-box [style*="zoom"]').forEach(n => { n.style.zoom = ''; });
			await waitImages(stage);
			const only = target => node => node !== document.body && document.body.contains(node) && !node.contains(target) && !target.contains(node);
			// 每队分别截图（只复制这一块，跳过页面其他元素）；输出宽 750（手机宽度）
			const W = 750;
			const blocks = [...stage.children];
			const scale = W / stage.offsetWidth;
			const shots = [];
			for (let i = 0; i < blocks.length; i++) {
				msg.textContent = `生成图片 ${i + 1} / ${blocks.length}…`;
				shots.push(await html2canvas(blocks[i], { backgroundColor: '#ffffff', scale, logging: false, imageTimeout: 8000, ignoreElements: only(blocks[i]) }));
			}
			const c = document.createElement('canvas');
			c.width = W; c.height = shots.reduce((a, x) => a + Math.round(x.height * W / x.width), 0);
			const g = c.getContext('2d');
			g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
			let y = 0;
			shots.forEach(x => { const h = Math.round(x.height * W / x.width); g.drawImage(x, 0, y, W, h); y += h; });
			const blob = await new Promise(r => c.toBlob(r, 'image/png'));
			showCollage(URL.createObjectURL(blob), list.length);
		} catch (e) {
			window.alert('生成失败：' + e.message); // eslint-disable-line no-alert
		} finally {
			stage?.remove();
			formation.loadObj();
			formation.loadObj(saved);
			refreshAll(formation);
			if (scaler) scaler.style.transform = savedTransform || '';
			MyPDC.capturing = false;
			document.body.classList.remove('mypdc-capturing');
			window.dispatchEvent(new Event('resize'));
			lib.classList.remove('display-none');
			window.scrollTo(0, savedScroll);
			overlay.remove();
		}
	}
	function showCollage(url, n) {
		const name = `队伍合集-${n}队.png`;
		const box = el('div', { class: 'mypdc-collage-overlay mypdc-collage-result' },
			el('div', { class: 'mypdc-collage-bar' },
				el('a', { href: url, download: name, class: 'mypdc-collage-save' }, '⬇ 保存图片'),
				el('span', { class: 'mypdc-collage-tip' }, '手机上也可以长按图片保存'),
				el('button', { type: 'button', onclick: () => { box.remove(); URL.revokeObjectURL(url); } }, '关闭')),
			el('div', { class: 'mypdc-collage-scroll' }, el('img', { src: url, alt: name })));
		document.body.append(box);
	}

	// 管理：输入管理密码后可以删除
	async function checkAdmin() {
		const key = load('admin-key', '');
		if (!key) { isAdmin = false; return; }
		try { await api('/api/admin', { admin: true }); isAdmin = true; } catch (e) { isAdmin = false; }
	}
	function renderAdmin() {
		adminBox.innerHTML = '';
		if (isAdmin) {
			adminBox.append('已登录管理：每个队伍右边有 🗑 删除按钮（点两次确认删除）。 ',
				el('button', { type: 'button', onclick: () => { save('admin-key', ''); openLibrary(true); } }, '退出登录'));
			return;
		}
		const input = el('input', { type: 'password', placeholder: '管理密码', autocomplete: 'current-password' });
		const msg = el('div', { class: 'mypdc-team-msg' });
		const btn = el('button', { type: 'button', class: 'mypdc-team-primary' }, '进入');
		const go = async () => {
			btn.disabled = true;
			save('admin-key', input.value);
			await checkAdmin();
			btn.disabled = false;
			if (isAdmin) { renderAdmin(); reload(); } else { save('admin-key', ''); msg.textContent = '密码不对'; input.select(); }
		};
		btn.onclick = go;
		input.onkeydown = e => { if (e.key === 'Enter') go(); };
		adminBox.append(
			el('form', { class: 'mypdc-team-login', onsubmit: e => { e.preventDefault(); go(); } },
				el('p', null, '请输入管理密码。这个浏览器会记住密码，下次打开这个链接直接进入。'),
				el('div', { class: 'mypdc-team-actions' }, input, btn),
				msg));
		setTimeout(() => input.focus(), 50);
	}

	// ---------- 5) 按钮 ----------
	window.addEventListener('load', () => {
		// 和“绘制截图”放在同一行
		const shot = document.getElementById('draw-screenshot');
		const btns = [
			el('button', { type: 'button', class: 'mypdc-team-btn', onclick: openSave }, '💾 保存'),
			el('button', { type: 'button', class: 'mypdc-team-btn', onclick: () => openLibrary() }, '📚 队伍库'),
		];
		if (shot) shot.before(...btns);
		else document.body.prepend(el('div', { class: 'mypdc-team-buttons' }, btns));
		openFromHash();
	});
	// #teams 打开队伍库；#teams-admin 是管理专属链接
	function openFromHash() {
		if (location.hash === '#teams-admin') openLibrary(true);
		else if (location.hash === '#teams') openLibrary();
	}
	window.addEventListener('hashchange', openFromHash);

	MyPDC.teams = { openLibrary, openSave };
})();
