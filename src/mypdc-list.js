'use strict';
// 我的 PDC：搜索结果列表显示 + PDC 式主动技能快速筛选
(function () {
	const { el, load, save, fmt, cardName } = MyPDC;
	const S = MyPDC.sort;

	// ---------------- 主动技能快速筛选 ----------------
	// 路径是上游“特殊搜索”里的中文名称；上游改名时对应按钮会自动隐藏
	const SKILL_CHIPS = [
		['破吸/解封', [
			['破属吸', ['主动技', '破吸类', '破属吸 buff']],
			['破伤吸', ['主动技', '破吸类', '破伤吸 buff']],
			['破C吸', ['主动技', '破吸类', '破C吸 buff']],
			['贯穿', ['主动技', '破吸类', '贯穿无效盾 buff']],
			['解封', ['主动技', '解封类', '解封角色']],
			['解觉醒', ['主动技', '解封类', '解觉醒']],
			['解禁消', ['主动技', '解封类', '解禁消珠']],
		]],
		['强化', [
			['攻击buff', ['主动技', 'buff 类', '全队攻击力 buff']],
			['回复buff', ['主动技', 'buff 类', '回复力 buff']],
			['加秒', ['主动技', 'buff 类', '操作时间 buff']],
			['加C', ['主动技', 'buff 类', '加C buff']],
			['减伤', ['主动技', 'buff 类', '全属减伤 buff']],
			['属性减伤', ['主动技', 'buff 类', '限属减伤 buff']],
			['全体攻击', ['主动技', 'buff 类', '变为全体攻击']],
			['伤害上限', ['主动技', '对自身队伍生效类', '增加伤害上限', '增加伤害上限 - 任意']],
			['HP上限↑', 'custom:maxhp-up'],
		]],
		['队伍/回复', [
			['溜(减CD)', ['主动技', '对自身队伍生效类', '【溜】减少CD']],
			['换队长', ['主动技', '对自身队伍生效类', '更换队长']],
			['转属性', ['主动技', '对自身队伍生效类', '转换队员属性']],
			['回合回血', ['主动技', '玩家HP操纵类', '回合结束回血 buff']],
			['立刻回血', ['主动技', '玩家HP操纵类', '玩家立刻回血']],
			['时间暂停', ['主动技', '时间暂停']],
		]],
		['对敌', [
			['威吓', ['主动技', '对敌 buff 类', '威吓']],
			['破防', ['主动技', '对敌 buff 类', '破防']],
			['中毒', ['主动技', '对敌 buff 类', '中毒']],
			['反击', ['主动技', '对敌 buff 类', '受伤反击 buff']],
			['重力(剩余HP%)', ['主动技', '对敌直接伤害类-重力', '敌人当前血量']],
			['重力(最大HP%)', ['主动技', '对敌直接伤害类-重力', '敌人最大血量']],
			['部位破坏重力', ['主动技', '对敌直接伤害类-重力', '部位破坏重力']],
			['固伤', ['主动技', '对敌直接伤害类-固伤', '任意']],
			['全体大炮', ['主动技', '对敌直接伤害类-大炮', '对象', '对象-敌方全体']],
		]],
		['变敌属性', [
			['任意', 'custom:enemy-attr-any'],
			['敌→火', 'custom:enemy-attr-0', 0],
			['敌→水', 'custom:enemy-attr-1', 1],
			['敌→木', 'custom:enemy-attr-2', 2],
			['敌→光', 'custom:enemy-attr-3', 3],
			['敌→暗', 'custom:enemy-attr-4', 4],
		]],
		['板面', [
			['解锁', ['主动技', '改变宝珠状态类', '解锁']],
			['强化珠', ['主动技', '改变宝珠状态类', '强化宝珠']],
			['刷版', ['主动技', '改变板面状态类', '刷版']],
			['洗版', ['主动技', '洗板类', '洗版-任意']],
			['无天降', ['主动技', '改变板面状态类', '无天降 buff']],
			['掉落提升', ['主动技', '珠子掉落 类', '掉落率提升', '掉落率提升 buff']],
			['掉强化', ['主动技', '珠子掉落 类', '掉落强化宝珠 buff']],
		]],
		['生成珠子', [
			['火', 'custom:orb-0', 0], ['水', 'custom:orb-1', 1], ['木', 'custom:orb-2', 2],
			['光', 'custom:orb-3', 3], ['暗', 'custom:orb-4', 4], ['心', 'custom:orb-5', 5],
			['废珠', 'custom:orb-6'], ['毒', 'custom:orb-7'], ['猛毒', 'custom:orb-8'], ['炸弹', 'custom:orb-9'],
		]],
		['产珠', [
			['产竖', ['主动技', '固定位置产珠类', '产竖']],
			['产竖心', ['主动技', '固定位置产珠类', '产竖心']],
			['产横', ['主动技', '固定位置产珠类', '产横']],
			['十字', ['主动技', '固定位置产珠类', '生成十字']],
			['L字', ['主动技', '固定位置产珠类', '生成L字']],
			['3×3', ['主动技', '固定位置产珠类', '生成3×3方块']],
			['一圈', ['主动技', '固定位置产珠类', '生成四周一圈']],
		]],
	];

	// 上游没有直接对应的条件，在这里自己写
	function activeSkillOf(card, types) {
		if (!card.activeSkillId) return null;
		return getActuallySkills(Skills[card.activeSkillId], types, true)?.[0] || null;
	}
	function enemyAttrOf(card) { // 变敌属性：返回变成的属性，没有则 null
		const sk = activeSkillOf(card, [153, 224]);
		if (!sk) return null;
		return sk.type == 153 ? sk.params[0] : (sk.params[1] || 0);
	}
	// 技能最终会在板面上生成的珠子颜色（转珠、洗版、随机产珠、固定位置生成都算）
	const orbCache = new Map();
	function orbColorsOf(card) {
		if (orbCache.has(card.id)) return orbCache.get(card.id);
		const set = new Set();
		const add = arr => (Array.isArray(arr) ? arr : [arr]).forEach(a => { if (Number.isInteger(a) && a >= 0) set.add(a); });
		const walk = n => {
			if (Array.isArray(n)) { n.forEach(walk); return; }
			if (!n || typeof n !== 'object') return;
			switch (n.kind) {
				case SkillKinds.ChangeOrbs: (n.changes || []).forEach(c => add(c.to)); break;
				case SkillKinds.BoardChange: add(n.attrs); break;
				case SkillKinds.GenerateOrbs: add(n.orbs); break;
				case SkillKinds.FixedOrbs: (n.generates || []).forEach(g => add(g.orbs)); break;
			}
			for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v);
		};
		try { if (card.activeSkillId) walk(skillParser(card.activeSkillId)); } catch (e) { /* 解析失败当作没有 */ }
		orbCache.set(card.id, set);
		return set;
	}

	const CUSTOM_FILTERS = {
		'maxhp-up': cards => cards.filter(c => { const sk = activeSkillOf(c, [237]); return sk && sk.params[1] > 100; }),
		'enemy-attr-any': cards => cards.filter(c => enemyAttrOf(c) !== null),
	};
	for (let a = 0; a < 5; a++) CUSTOM_FILTERS['enemy-attr-' + a] = cards => cards.filter(c => enemyAttrOf(c) === a);
	for (let a = 0; a <= 9; a++) CUSTOM_FILTERS['orb-' + a] = cards => cards.filter(c => orbColorsOf(c).has(a));

	function findFilter(path) {
		if (typeof path === 'string') return CUSTOM_FILTERS[path.replace('custom:', '')] || null;
		let node = specialSearchFunctions;
		for (const name of path) {
			node = node?.functions?.find(f => (f.otLangName?.chs ?? f.name) === name);
			if (!node) return null;
		}
		return typeof node.function === 'function' ? node.function : null;
	}

	const fstate = Object.assign({ chips: [], mode: 'and', maxCd: 0, turnsKind: '', minTurns: 0, impartAw: [], impartMode: 'and', impartAny: false }, load('skill-filter', {}));

	// ---------- 技能持续回合 ----------
	const K = typeof SkillKinds === 'object' ? SkillKinds : {};
	const TURN_KINDS = [
		['', '任意效果', null],
		['reduce', '减伤', [K.ReduceDamage]],
		['power', '攻击/回复buff', [K.PowerUp, K.SlotPowerUp]],
		['combo', '加C', [K.AddCombo]],
		['time', '加秒', [K.TimeExtend]],
		['void', '破吸', [K.VoidEnemyBuff]],
		['cap', '伤害上限', [K.IncreaseDamageCapacity]],
		['heal', '回合回血', [K.AutoHealBuff, K.AutoHeal]],
		['drop', '掉落提升', [K.OrbDropIncrease]],
		['skyfall', '无天降', [K.NoSkyfall]],
		['counter', '反击', [K.CounterAttack]],
		['mass', '全体攻击', [K.MassAttack]],
		['board', '板面大小', [K.BoardSizeChange]],
	];
	const turnsCache = new Map();
	// 技能里所有限时效果：[{ turns, kinds:Set }]
	function timedEffects(card) {
		if (turnsCache.has(card.id)) return turnsCache.get(card.id);
		const out = [];
		const collectKinds = (node, set) => {
			if (Array.isArray(node)) node.forEach(n => collectKinds(n, set));
			else if (node && typeof node === 'object') {
				if (node.kind) set.add(node.kind);
				for (const v of Object.values(node)) if (v && typeof v === 'object') collectKinds(v, set);
			}
			return set;
		};
		const walk = node => {
			if (Array.isArray(node)) { node.forEach(walk); return; }
			if (!node || typeof node !== 'object') return;
			if (node.kind === K.ActiveTurns) {
				const t = Array.isArray(node.turns) ? Math.max(...node.turns) : Number(node.turns);
				if (t > 0) out.push({ turns: t, kinds: collectKinds(node.skills, new Set()) });
			}
			for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
		};
		try { if (card.activeSkillId) walk(skillParser(card.activeSkillId)); } catch (e) { /* 解析失败当作没有 */ }
		turnsCache.set(card.id, out);
		return out;
	}
	// 指定效果类型的最长持续回合（没有则 0）
	function maxTurns(card, kindKey = fstate.turnsKind) {
		const kinds = TURN_KINDS.find(k => k[0] === kindKey)?.[2];
		let best = 0;
		for (const e of timedEffects(card)) {
			if (kinds && !kinds.some(k => e.kinds.has(k))) continue;
			if (e.turns > best) best = e.turns;
		}
		return best;
	}
	function saveF() { save('skill-filter', fstate); }

	function minCd(card) {
		const sk = Skills?.[card.activeSkillId];
		if (!card.activeSkillId || !sk) return Infinity;
		return sk.initialCooldown - sk.maxLevel + 1;
	}

	function applySkillFilter(cards) {
		let result = cards;
		if (fstate.maxCd > 0) result = result.filter(c => minCd(c) <= fstate.maxCd);
		if (fstate.minTurns > 0) result = result.filter(c => maxTurns(c) >= fstate.minTurns);
		// 觉醒赋予（武器技能）
		if (fstate.impartAny || fstate.impartAw.length) {
			const impartOf = MyPDC.impart?.impartOf;
			result = result.filter(c => {
				const imp = impartOf?.(c);
				if (!imp) return false;
				if (!fstate.impartAw.length) return true;
				return fstate.impartMode === 'or'
					? fstate.impartAw.some(a => imp.includes(a))
					: fstate.impartAw.every(a => imp.includes(a));
			});
		}
		const fns = fstate.chips.map(key => chipIndex.get(key)?.fn).filter(Boolean);
		if (!fns.length) return result;
		if (fstate.mode === 'or') {
			const ok = new Set();
			fns.forEach(fn => { try { fn(result).forEach(c => ok.add(c)); } catch (e) { console.error(e); } });
			return result.filter(c => ok.has(c));
		}
		return fns.reduce((cur, fn) => { try { return fn(cur); } catch (e) { console.error(e); return cur; } }, result);
	}

	// 接在上游 searchCards 之后，这样“开始搜索”的结果、数量、排序都包含技能筛选
	if (typeof searchCards === 'function') {
		const originalSearch = searchCards;
		searchCards = function () { // eslint-disable-line no-global-assign
			return applySkillFilter(originalSearch.apply(this, arguments));
		};
	}

	const chipIndex = new Map();
	let clearAll = () => {};

	function runSearch() { MyPDC.list.autoSearch(); }

	function buildSkillFilter() {
		const anchor = document.querySelector('.search-box .special-div');
		if (!anchor || document.querySelector('.mypdc-skill-filter')) return;
		const countLabel = el('span', { class: 'mypdc-chip-count' });
		const chipButtons = [];
		const refresh = () => {
			chipButtons.forEach(b => b.classList.toggle('on', fstate.chips.includes(b.dataset.key)));
			const n = fstate.chips.length + (fstate.maxCd > 0 ? 1 : 0) + (fstate.minTurns > 0 ? 1 : 0) + fstate.impartAw.length + (fstate.impartAny ? 1 : 0);
			fillImpart();
			impartIcons.forEach(i => i.classList.toggle('on', fstate.impartAw.includes(+i.dataset.awokenIcon)));
			impartAnyBox.checked = fstate.impartAny;
			impartModeSel.value = fstate.impartMode;
			countLabel.textContent = n ? `（已选 ${n} 项）` : '';
		};

		const groups = SKILL_CHIPS.map(([title, chips]) => {
			const items = chips.map(([label, path, attr]) => {
				const fn = findFilter(path);
				if (!fn) return null;
				const key = typeof path === 'string' ? path : path.join('/');
				chipIndex.set(key, { fn, label });
				const b = el('button', { type: 'button', class: 'mypdc-chip' + (attr !== undefined ? ` mypdc-chip-attr-${attr}` : ''), 'data-key': key, title: typeof path === 'string' ? label : path.slice(1).join(' › '),
					onclick: () => {
						const i = fstate.chips.indexOf(key);
						if (i >= 0) fstate.chips.splice(i, 1); else fstate.chips.push(key);
						saveF(); refresh(); runSearch();
					} }, label);
				chipButtons.push(b);
				return b;
			}).filter(Boolean);
			return items.length ? el('div', { class: 'mypdc-chip-group' }, el('span', { class: 'mypdc-chip-title' }, title), items) : null;
		});
		// 去掉已失效的选项
		fstate.chips = fstate.chips.filter(k => chipIndex.has(k));

		const awName = a => {
			try { return localTranslating.skill_parse.awokens[a]({ icon: '' }).textContent.trim(); } catch (e) { return ''; }
		};
		// 觉醒赋予：只列出有武器能赋予的觉醒（怪物数据读完后再填充）
		const impartIcons = [];
		const impartIconBox = el('div', { class: 'mypdc-impart-icons' });
		let impartFilled = false;
		function fillImpart() {
			const impartOf = MyPDC.impart?.impartOf;
			if (impartFilled || !impartOf || !(Cards?.length > 100)) return;
			impartFilled = true;
			const impartable = new Set();
			Cards.forEach(c => { if (c?.enabled) impartOf(c)?.forEach(a => impartable.add(a)); });
			const orderOf = typeof official_awoken_sorting !== 'undefined' && Array.isArray(official_awoken_sorting) ? official_awoken_sorting : [];
			const list = [...impartable].sort((a, b) => {
				const ia = orderOf.indexOf(a), ib = orderOf.indexOf(b);
				return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a - b;
			});
			fstate.impartAw = fstate.impartAw.filter(a => impartable.has(a));
			list.forEach(a => {
				const b = el('button', { type: 'button', class: 'awoken-icon mypdc-impart-icon', 'data-awoken-icon': a,
					onmouseenter: e => { if (!e.currentTarget.title) e.currentTarget.title = awName(a); },
					onclick: () => {
						const i = fstate.impartAw.indexOf(a);
						if (i >= 0) fstate.impartAw.splice(i, 1); else fstate.impartAw.push(a);
						saveF(); refresh(); runSearch();
					} });
				impartIcons.push(b);
				impartIconBox.append(b);
			});
		}
		const impartAnyBox = el('input', { type: 'checkbox', onchange: e => { fstate.impartAny = e.target.checked; saveF(); refresh(); runSearch(); } });
		const impartModeSel = el('select', { onchange: e => { fstate.impartMode = e.target.value; saveF(); if (fstate.impartAw.length) runSearch(); } },
			el('option', { value: 'and' }, '全部(AND)'), el('option', { value: 'or' }, '任一(OR)'));
		const impartBox = el('div', { class: 'mypdc-impart-filter' },
			el('div', { class: 'mypdc-row' },
				el('span', { class: 'mypdc-chip-title' }, '觉醒赋予'),
				el('label', null, impartAnyBox, ' 有觉醒赋予技能'),
				el('label', null, '所选觉醒 ', impartModeSel),
				el('span', { class: 'mypdc-hint' }, '点觉醒图标：找能赋予这些觉醒的武器')),
			impartIconBox);

		const panel = el('details', { class: 'mypdc-skill-filter', open: load('skill-filter-open', true) },
			el('summary', null, '★主动技能筛选', countLabel),
			el('div', { class: 'mypdc-row' },
				el('label', null, '条件关系 ',
					el('select', { onchange: e => { fstate.mode = e.target.value; saveF(); runSearch(); } },
						el('option', { value: 'and', selected: fstate.mode === 'and' }, '全部满足(AND)'),
						el('option', { value: 'or', selected: fstate.mode === 'or' }, '任一满足(OR)'))),
				el('label', null, '最短CD ≤ ',
					el('input', { type: 'number', min: 0, max: 99, value: fstate.maxCd || '', placeholder: '不限', style: 'width:4em',
						onchange: e => { fstate.maxCd = Math.max(0, parseInt(e.target.value, 10) || 0); saveF(); refresh(); runSearch(); } })),
				el('label', { title: '技能里该效果持续的回合数' }, '持续回合 ',
					el('select', { class: 'mypdc-turns-kind', onchange: e => { fstate.turnsKind = e.target.value; saveF(); if (fstate.minTurns) runSearch(); MyPDC.list.render(); } },
						TURN_KINDS.map(([k, t]) => el('option', { value: k, selected: fstate.turnsKind === k }, t))),
					' ≥ ',
					el('input', { type: 'number', class: 'mypdc-min-turns', min: 0, max: 99, value: fstate.minTurns || '', placeholder: '不限', style: 'width:4em',
						onchange: e => { fstate.minTurns = Math.max(0, parseInt(e.target.value, 10) || 0); saveF(); refresh(); runSearch(); } }),
					' 回合'),
				el('button', { type: 'button', onclick: () => clearAll() }, '清除技能条件'),
			),
			groups,
			impartBox,
			el('div', { class: 'mypdc-hint' }, '点选后自动重新搜索，可以和上面的属性、类型、觉醒条件一起用。“生成珠子”包括转珠、洗版、随机产珠和固定位置生成，多选时按上面的 AND/OR 关系。更细的技能条件在下面的“特殊搜索”里。'),
		);
		panel.addEventListener('toggle', () => { save('skill-filter-open', panel.open); refresh(); });
		document.querySelector('.search-box')?.addEventListener('toggle', refresh);
		anchor.before(panel);
		refresh();

		function resetState() {
			Object.assign(fstate, { chips: [], maxCd: 0, mode: 'and', turnsKind: '', minTurns: 0, impartAw: [], impartMode: 'and', impartAny: false }); saveF();
			panel.querySelectorAll('input[type=number]').forEach(i => { i.value = ''; });
			panel.querySelector('select').value = 'and';
			panel.querySelector('.mypdc-turns-kind').value = '';
			refresh();
		}
		clearAll = () => { resetState(); runSearch(); MyPDC.list.render(); };
		// 上游“清空搜索”也清除这里的技能条件（之后会自动重新搜索）
		document.querySelector('.search-box .search-clear')?.addEventListener('click', resetState);
	}

	// ---------------- 列表显示 ----------------
	const lstate = Object.assign({ key: null, desc: true }, load('list-sort', {}));
	const PAGE = 200;
	let shown = PAGE;
	let wrap, ul;

	const ATTR_CHARS = ['火', '水', '木', '光', '暗', '心'];
	const COLUMNS = [
		{ key: 'icon', title: '' },
		{ key: 'id', title: 'No.', value: c => c.id, asc: true },
		{ key: 'name', title: '名称', value: c => cardName(c.id), asc: true, text: true },
		{ key: 'attr', title: '属性', value: c => c.attrs[0] * 10 + (c.attrs[1] >= 0 ? c.attrs[1] : 9), asc: true },
		{ key: 'rarity', title: '★', value: c => c.rarity },
		{ key: 'hp', title: 'HP', value: c => S.stats(c)?.hp ?? 0 },
		{ key: 'atk', title: '攻击', value: c => S.stats(c)?.atk ?? 0 },
		{ key: 'rcv', title: '回复', value: c => S.stats(c)?.rcv ?? 0 },
		{ key: 'teamhp', title: '队伍中HP', value: c => S.teamHp(c) },
		{ key: 'cd', title: '最短CD', value: c => minCd(c), asc: true },
		{ key: 'turns', title: '持续', value: c => maxTurns(c) },
		{ key: 'awoken', title: '觉醒 / 超觉醒' },
	];

	function selectCard(id) {
		const input = document.getElementById('card-id');
		const form = document.getElementById('form-id-search');
		if (!input || !form) return;
		input.value = id;
		form.onchange?.();
	}

	function awokenIcons(list, cls) {
		return el('span', { class: cls }, list.map(a => el('span', { class: 'awoken-icon', 'data-awoken-icon': a })));
	}

	let renderTimer = null;
	function render() {
		if (renderTimer) return;
		renderTimer = setTimeout(() => { renderTimer = null; doRender(); }, 30);
	}

	function sortedRows(heads) {
		const rows = heads.map(li => ({ li, card: li.card }));
		const col = COLUMNS.find(c => c.key === lstate.key && c.value);
		if (col) {
			const dir = lstate.desc ? -1 : 1;
			const vals = new Map(rows.map(r => [r, col.value(r.card)]));
			rows.sort((a, b) => {
				const va = vals.get(a), vb = vals.get(b);
				const d = col.text ? String(va).localeCompare(String(vb), 'zh') : va - vb;
				return d * dir || a.card.id - b.card.id;
			});
		}
		return { rows, col };
	}

	function setSort(key) {
		const c = COLUMNS.find(x => x.key === key);
		if (!c) { lstate.key = null; }
		else if (lstate.key === key) lstate.desc = !lstate.desc;
		else { lstate.key = key; lstate.desc = !c.asc; }
		save('list-sort', lstate); shown = PAGE; render();
	}

	// 排序栏（图标模式下用来选排序；列表模式下直接点表头）
	let sortBar;
	function renderSortBar() {
		if (!sortBar) return;
		sortBar.innerHTML = '';
		sortBar.append('排序 ',
			el('select', { onchange: e => setSort(e.target.value) },
				el('option', { value: '' }, '默认'),
				COLUMNS.filter(c => c.value).map(c => el('option', { value: c.key, selected: c.key === lstate.key }, c.title))),
			lstate.key ? el('button', { type: 'button', onclick: () => setSort(lstate.key) }, lstate.desc ? '▼ 从大到小' : '▲ 从小到大') : null,
		);
	}

	let reordering = false;
	function doRender() {
		const listView = !S.cfg.iconView;
		document.body.classList.toggle('mypdc-listview', listView);
		renderSortBar();
		if (!wrap) return;
		const heads = [...ul.children].filter(li => li.card);
		const { rows, col } = sortedRows(heads);

		if (!listView) { // 图标模式：按同样的排序重新排列头像，并在头像上显示数值
			reordering = true;
			const frag = document.createDocumentFragment();
			rows.forEach(({ li, card }) => {
				let badge = li.querySelector('.mypdc-sortval');
				if (col && !col.text && col.key !== 'id') {
					if (!badge) { badge = el('span', { class: 'mypdc-sortval' }); li.append(badge); }
					const v = col.value(card);
					badge.textContent = Number.isFinite(v) ? fmt(v) : '-';
				} else badge?.remove();
				frag.append(li);
			});
			ul.append(frag);
			setTimeout(() => { reordering = false; });
			return;
		}

		const scroll = wrap.scrollTop;
		wrap.innerHTML = '';
		// 没有结果时整块不显示（和上游图标列表为空时一样）
		wrap.classList.toggle('mypdc-empty', !heads.length);
		if (!heads.length) return;

		const head = el('tr', null, COLUMNS.map(c => {
			const active = c.key === lstate.key;
			return el('th', {
				class: (c.value ? 'mypdc-sortable' : '') + (active ? ' mypdc-sorted' : ''),
				onclick: c.value ? () => setSort(c.key) : null,
			}, c.title, active ? (lstate.desc ? ' ▼' : ' ▲') : '');
		}));
		const table = el('table', { class: 'mypdc-list-table' }, head);
		const currentId = parseInt(document.getElementById('card-id')?.value, 10);

		rows.slice(0, shown).forEach(({ li, card }) => {
			const st = S.stats(card);
			const icon = li.head ? li.head.cloneNode(true) : el('span');
			icon.removeAttribute('href');
			const attrs = card.attrs.filter(a => a >= 0 && a <= 5);
			const supers = (card.superAwakenings || []);
			const tr = el('tr', { class: card.id === currentId ? 'mypdc-current' : null, onclick: () => {
				selectCard(card.id);
				table.querySelectorAll('.mypdc-current').forEach(r => r.classList.remove('mypdc-current'));
				tr.classList.add('mypdc-current');
			} },
				el('td', { class: 'mypdc-list-icon' }, icon),
				el('td', null, card.id),
				el('td', { class: 'mypdc-list-name' }, cardName(card.id)),
				el('td', null, attrs.map(a => el('span', { class: `mypdc-attr mypdc-attr-${a}` }, ATTR_CHARS[a]))),
				el('td', null, card.rarity),
				el('td', { class: 'mypdc-num' }, st ? fmt(st.hp) : '-'),
				el('td', { class: 'mypdc-num' }, st ? fmt(st.atk) : '-'),
				el('td', { class: 'mypdc-num' }, st ? fmt(st.rcv) : '-'),
				el('td', { class: 'mypdc-num' }, fmt(S.teamHp(card))),
				el('td', null, Number.isFinite(minCd(card)) ? minCd(card) : '-'),
				el('td', { title: (TURN_KINDS.find(k => k[0] === fstate.turnsKind)?.[1] || '') + '最长持续回合' }, maxTurns(card) || '-'),
				el('td', { class: 'mypdc-list-awoken' },
					awokenIcons(card.awakenings, 'mypdc-aw'),
					supers.length ? awokenIcons(supers, 'mypdc-aw mypdc-saw') : null,
					st?.sawoken ? el('span', { class: 'mypdc-saw-pick', title: 'HP计算采用的超觉醒' }, '超:', el('span', { class: 'awoken-icon', 'data-awoken-icon': st.sawoken })) : null),
			);
			table.append(tr);
		});
		wrap.append(table);
		if (rows.length > shown) {
			wrap.append(el('button', { type: 'button', class: 'mypdc-more', onclick: () => { shown += PAGE; render(); } },
				`显示更多（${shown} / ${rows.length}）`));
		}
		wrap.scrollTop = scroll;
	}

	// ---------------- 条件一改就自动搜索 ----------------
	function searchOptionsEmpty() {
		const box = document.querySelector('.search-box');
		const o = box?.getSearchOptions?.();
		if (!o) return false;
		return o.attrs.every(a => !a) && !o.types.length && !o.rares.length && !o.awokens.length && !o.sawokens.length &&
			!o.canAssist && !o.canLv110 && !o.is8Latent && !o.notWeapon &&
			o.specialFilters.every(f => !f || f.every(n => !n)) &&
			!fstate.chips.length && !fstate.maxCd && !fstate.minTurns && !fstate.impartAw.length && !fstate.impartAny;
	}
	let searchTimer = null;
	function autoSearch() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			if (searchOptionsEmpty()) {
				// 没有任何条件时不列出全部 1 万多只，改为显示最新的 100 只
				const form = document.getElementById('form-string-search');
				const input = form?.querySelector('[name="search-string"]');
				if (input) input.value = '';
				form?.requestSubmit?.();
			} else {
				document.querySelector('.search-box .search-start')?.click();
			}
		}, 250);
	}
	function setupAutoSearch() {
		const box = document.querySelector('.search-box');
		if (!box) return;
		const ignore = '.mypdc-sort-cfg, .mypdc-skill-filter, .sort-div, .additional-div, .search-close, .search-share, .search-start, summary';
		const handler = e => { if (!e.target.closest(ignore)) autoSearch(); };
		box.addEventListener('change', handler);
		box.addEventListener('click', e => { if (e.target.closest('button, .awoken-icon, .type-icon') && !e.target.closest('select')) handler(e); });
		// 打开搜索栏时，如果还没有结果就先搜一次
		box.addEventListener('toggle', () => { if (box.open && !ul?.children.length) autoSearch(); });
	}

	// ---------------- 选中宠物时把加蛋设为 +297 / +891 ----------------
	function applyPlusToEditBox() {
		const editBox = document.querySelector('.edit-box');
		const btns = [...document.querySelectorAll('.edit-box .m-plus-fast-setting')];
		if (!editBox || !btns.length) return;
		const want = S.cfg.plus891 && !editBox.isAssist ? '3' : '1';
		btns.find(b => b.value === want)?.click();
	}
	function setupPlus() {
		const form = document.getElementById('form-id-search');
		if (!form || form.__mypdc) return;
		const original = form.onchange;
		form.onchange = function () {
			const r = original?.apply(this, arguments);
			applyPlusToEditBox();
			return r;
		};
		form.__mypdc = true;
		let last = S.cfg.plus891;
		S.onChange(() => { // 切换“满加蛋”时也更新正在编辑的宠物
			if (S.cfg.plus891 === last) return;
			last = S.cfg.plus891;
			const editBox = document.querySelector('.edit-box');
			if (editBox && !editBox.classList.contains('display-none') && editBox.mid > 0) applyPlusToEditBox();
		});
	}

	function buildList() {
		ul = document.querySelector('.search-mon-list');
		if (!ul || wrap) return;
		wrap = el('div', { class: 'mypdc-list-wrap' });
		sortBar = el('div', { class: 'mypdc-sort-bar' });
		ul.before(sortBar, wrap);
		new MutationObserver(() => { if (reordering) return; shown = PAGE; render(); }).observe(ul, { childList: true });
		S.onChange(render);
		render();
	}

	window.addEventListener('load', () => {
		buildSkillFilter();
		buildList();
		setupAutoSearch();
		setupPlus();
	});
	MyPDC.list = { render, applySkillFilter, fstate, autoSearch };
})();
