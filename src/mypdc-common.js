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
			const options = {
				onclone: doc => doc.body.classList.add('mypdc-capture'),
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
