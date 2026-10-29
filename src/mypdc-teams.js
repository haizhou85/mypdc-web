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
	let lib, libTitle, libBody, listBox, moreBtn, searchInput, adminBox;
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
		libTitle = el('h2', null, '📚 队伍库');
		lib.append(
			el('div', { class: 'mypdc-panel-head' }, libTitle, el('button', { type: 'button', onclick: closeLibrary }, '关闭')),
			libBody);
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
