'use strict';
// 我的 PDC：公共工具。依赖上游 PADDashFormation 的全局变量
// (formation, solo, teamsCount, Cards, refreshTeamTotalHP 等)。
const MyPDC = (function () {
	const PREFIX = 'mypdc-';
	const listeners = [];
	const teamStats = []; // 每个队伍最近一次计算出的 HP 统计

	function load(key, fallback) {
		try {
			const s = localStorage.getItem(PREFIX + key);
			return s === null ? fallback : JSON.parse(s);
		} catch (e) {
			return fallback;
		}
	}
	function save(key, value) {
		try {
			localStorage.setItem(PREFIX + key, JSON.stringify(value));
		} catch (e) { /* 存储不可用时忽略 */ }
	}

	// 队伍的两个队长 ID（与上游 refreshTeamTotalHP 的逻辑一致）
	function leaderIds(teamIdx) {
		const teams = formation.teams;
		const team = teams[teamIdx];
		if (!team) return [0, 0];
		const [members, , , swapId] = team;
		const l1 = members[swapId || 0]?.id ?? 0;
		let l2;
		if (teamsCount === 2) {
			const other = teams[teamIdx === 1 ? 0 : 1];
			l2 = other?.[0]?.[other?.[3] || 0]?.id ?? 0;
		} else {
			l2 = members[5]?.id ?? 0;
		}
		return [l1, l2];
	}

	function cardName(id) {
		const card = Cards?.[id];
		if (!card) return '';
		return card.otLangName?.chs || card.otLangName?.cht || card.name || '';
	}

	const ATTR_NAMES = ['火', '水', '木', '光', '暗'];

	// 每次上游刷新队伍 HP 时，记下结果并通知自定义模块
	function hookTeamRefresh() {
		if (typeof refreshTeamTotalHP !== 'function' || refreshTeamTotalHP.__mypdc) return;
		const original = refreshTeamTotalHP;
		const wrapped = function (totalDom, team, teamIdx) {
			const out = original.apply(this, arguments);
			if (out && typeof teamIdx === 'number') {
				teamStats[teamIdx] = Object.assign({}, out, { team });
				listeners.forEach(fn => {
					try { fn(teamIdx); } catch (e) { console.error(e); }
				});
			}
			return out;
		};
		wrapped.__mypdc = true;
		refreshTeamTotalHP = wrapped; // eslint-disable-line no-global-assign
	}
	hookTeamRefresh();

	// 2 人协力：两队共用血量，由 refreshFormationTotalHP 计算
	const formationStats = {};
	function hookFormationRefresh() {
		if (typeof refreshFormationTotalHP !== 'function' || refreshFormationTotalHP.__mypdc) return;
		const original = refreshFormationTotalHP;
		const wrapped = function (totalDom) {
			const out = original.apply(this, arguments);
			const bar = totalDom?.querySelector?.('.reduce-details');
			if (bar && bar.tHP) {
				formationStats.tHP = bar.tHP;
				formationStats.tHPNoAwoken = bar.tHPNoAwoken;
				listeners.forEach(fn => {
					try { fn(-1); } catch (e) { console.error(e); }
				});
			}
			return out;
		};
		wrapped.__mypdc = true;
		refreshFormationTotalHP = wrapped; // eslint-disable-line no-global-assign
	}
	hookFormationRefresh();

	function el(tag, attrs, ...children) {
		const node = document.createElement(tag);
		if (attrs) {
			for (const [k, v] of Object.entries(attrs)) {
				if (v === undefined || v === null || v === false) continue;
				if (k === 'class') node.className = v;
				else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
				else if (k === 'value') node.value = v;
				else if (v === true) node.setAttribute(k, '');
				else node.setAttribute(k, v);
			}
		}
		for (const c of children.flat()) {
			if (c === null || c === undefined || c === false) continue;
			node.append(c instanceof Node ? c : document.createTextNode(String(c)));
		}
		return node;
	}

	function fmt(n) {
		if (!Number.isFinite(n)) return '-';
		return Math.round(n).toLocaleString('en-US');
	}

	// 顶部：去掉“帮助和提示”“反馈”，改为来源声明
	window.addEventListener('load', () => {
		const help = document.getElementById('help-link');
		if (!help || document.querySelector('.mypdc-credit')) return;
		const credit = el('span', { class: 'mypdc-credit' },
			'来源：基于 ',
			el('a', { href: 'https://github.com/Mapaler/PADDashFormation', target: '_blank', rel: 'noopener' }, 'PADDashFormation'),
			'（Mapaler，GPL-3.0）修改，功能参考 PDC ダメージ計算（corombo13）。游戏图片与资料版权属于 GungHo Online Entertainment。',
			el('a', { href: 'https://github.com/haizhou85/mypdc-web', target: '_blank', rel: 'noopener' }, '本站源码'));
		help.before(credit);
	});

	// 编辑窗口：把绿色的宠物信息挪到能力值/技能正上方，合成一张卡片；
	// ID 输入、进化链、潜觉留在卡片上方
	window.addEventListener('load', () => {
		const info = document.querySelector('.edit-box .monsterinfo-box');
		const ability = document.querySelector('.edit-box .setting-box .ability-box');
		if (!info || !ability || info.nextElementSibling === ability) return;
		ability.before(info);
		document.body.classList.add('mypdc-merged-card');
	});

	// 截图：宽屏时上游会把队伍信息排成左右两栏，截图成横版；截图时改用竖向排列
	if (typeof captureScreenshot === 'function') {
		captureScreenshot = function (target, filename = 'capture', transparent = true) { // eslint-disable-line no-global-assign
			statusLine?.writeText(localTranslating.status_message.prepare_capture);
			formationBox.classList.remove('edit-code');
			const downLink = controlBox.querySelector('.down-capture');
			// 用窄于 1310px 的虚拟窗口渲染，宽屏两栏布局的媒体查询不生效，直接得到上游的竖向布局
			const options = {
				windowWidth: 1000,
				onclone: doc => doc.body.classList.remove('side-mode'),
			};
			if (transparent) options.backgroundColor = null;
			html2canvas(target, options).then(canvas => {
				canvas.toBlob(blob => {
					window.URL.revokeObjectURL(downLink.href);
					downLink.href = URL.createObjectURL(blob);
					downLink.download = `${filename}.png`;
					downLink.click();
					statusLine?.writeText();
				});
			});
		};
	}

	return {
		load, save, leaderIds, cardName, el, fmt, teamStats, formationStats, ATTR_NAMES,
		onTeamUpdate: fn => listeners.push(fn),
	};
})();

// 手机：固定宽度的区块（编队 6/7 列、属性选择、宠物信息等）比屏幕宽时按屏宽等比缩放
(function () {
	const SELECTORS = [
		'.formation-box',
		'.edit-box .search-box #search-attr',
		'.edit-box .search-box .type-list',
		'.edit-box .search-box .selected-awokens-div',
		'.edit-box .search-box .special-filter-list > li',
		'.edit-box .monsterinfo-box',
		'.edit-box .id-string-search',
		'.edit-box .setting-box .row-mon-id',
		'.edit-box .setting-box .row-mon-latent',
		'.edit-box .setting-box .row-ability',
		'.edit-box .button-box',
	];
	const isPhone = () => window.innerWidth <= 700;
	function fitOne(node) {
		node.style.zoom = '';
		if (!isPhone() || node.offsetParent === null) return;
		const W = document.documentElement.clientWidth;
		const r = node.getBoundingClientRect();
		const natural = Math.max(node.scrollWidth, r.width);
		const left = Math.max(0, r.left);
		const avail = W - left - Math.min(left, 8);
		if (natural > avail + 1) node.style.zoom = (avail / natural).toFixed(4);
	}
	let pending = false;
	function fitAll() {
		if (pending) return;
		pending = true;
		requestAnimationFrame(() => {
			pending = false;
			SELECTORS.forEach(sel => document.querySelectorAll(sel).forEach(fitOne));
		});
	}
	window.addEventListener('load', () => {
		fitAll();
		const box = document.querySelector('.edit-box');
		if (box) new MutationObserver(fitAll).observe(box, { attributes: true, attributeFilter: ['class'] });
		document.addEventListener('toggle', fitAll, true);
		document.getElementById('form-id-search')?.addEventListener('change', () => setTimeout(fitAll, 50));
		MyPDC.onTeamUpdate(fitAll);
	});
	window.addEventListener('resize', fitAll);
	window.addEventListener('orientationchange', () => setTimeout(fitAll, 300));
	MyPDC.fit = fitAll;
})();

// 统一用开关（toggle）样式：把 <label><input type=checkbox>文字</label> 改成上游的 input.switch-ipt + label 结构；
// 上游搜索栏里剩下的普通勾选框也加上开关样式
(function () {
	let seq = 0;
	function convertLabelWrapped(root) {
		root.querySelectorAll('label > input[type="checkbox"]:not(.switch-ipt)').forEach(input => {
			const label = input.parentElement;
			if (!input.id) input.id = 'mypdc-sw-' + (++seq);
			input.classList.add('switch-ipt');
			label.htmlFor = input.id;
			label.before(input);
			// 去掉文字前多余的空格
			const first = label.firstChild;
			if (first && first.nodeType === 3) first.textContent = first.textContent.replace(/^\s+/, '');
		});
	}
	const UPSTREAM = ['#fix-main-color', '#consider-equivalent-awoken', '#screenshot-transparent', '#change-swap-to-copy', '#use-side-mode'];
	function convertUpstream() {
		UPSTREAM.forEach(sel => {
			const input = document.querySelector(sel);
			if (input && input.type === 'checkbox' && input.nextElementSibling?.tagName === 'LABEL') input.classList.add('switch-ipt');
		});
	}
	let pending = false;
	function run() {
		if (pending) return;
		pending = true;
		requestAnimationFrame(() => { pending = false; convertLabelWrapped(document); });
	}
	window.addEventListener('load', () => {
		convertUpstream();
		convertLabelWrapped(document);
		new MutationObserver(muts => {
			if (muts.some(m => [...m.addedNodes].some(n => n.nodeType === 1 && (n.matches?.('label') || n.querySelector?.('label > input[type="checkbox"]'))))) run();
		}).observe(document.body, { childList: true, subtree: true });
	});
})();

// 点队伍里的宠物：已有宠物时直接滚到宠物信息卡片（上游停在搜索栏顶部）；空位仍停在搜索栏，方便找宠物
(function () {
	if (typeof editMember !== 'function') return;
	const orig = editMember;
	editMember = function (teamNum, isAssist, indexInTeam) { // eslint-disable-line no-global-assign
		const out = orig.apply(this, arguments);
		try {
			const mon = formation.teams[teamNum]?.[isAssist]?.[indexInTeam];
			// 宽屏左右分栏（side-mode 且宽于 1310px）时编辑框在侧边，不用滚动
			const sideBySide = document.body.classList.contains('side-mode') && window.innerWidth > 1310;
			if (mon?.id > 0 && !sideBySide) {
				// 搜索结果列表随后才渲染，上面的高度会变：分几次对齐；用户自己动手滚动后就不再动
				let userMoved = false;
				const stop = () => { userMoved = true; };
				const evs = ['touchstart', 'wheel', 'keydown', 'mousedown'];
				evs.forEach(ev => window.addEventListener(ev, stop, { once: true, passive: true }));
				const align = () => {
					if (userMoved) return false;
					const card = document.querySelector('.edit-box .monsterinfo-box');
					if (!card?.offsetParent) return true;
					window.scrollTo({ top: card.getBoundingClientRect().top + window.scrollY - 4, behavior: 'instant' });
					return true;
				};
				let i = 0;
				const delays = [50, 250, 600, 1200];
				const step = () => {
					if (align() && ++i < delays.length) setTimeout(step, delays[i] - delays[i - 1]);
					else evs.forEach(ev => window.removeEventListener(ev, stop));
				};
				setTimeout(step, delays[0]);
			}
		} catch (e) { console.error(e); }
		return out;
	};
	const wrapped = editMember;
	window.addEventListener('load', () => setTimeout(() => {
		if (typeof editBox !== 'undefined' && editBox.editMon === orig) editBox.editMon = wrapped;
	}));
})();

// 顶部控制栏精简：去掉二维码、我的箱子、数据更新时间按钮；来源声明移到页面最下面；“拖拽时复制”放进“展示信息开关列表”
(function () {
	window.addEventListener('load', () => {
		document.body.classList.add('mypdc-compact-top');
		const credit = document.querySelector('.mypdc-credit');
		if (credit) document.body.append(MyPDC.el('footer', { class: 'mypdc-footer' }, credit));
		const setting = document.querySelector('.config-display-list .setting');
		const swap = document.getElementById('change-swap-to-copy');
		const swapLabel = document.querySelector('label[for="change-swap-to-copy"]');
		if (setting && swap && swapLabel) setting.append(swap, swapLabel);
	});
})();
