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
		['转珠', [
			['→火', ['主动技', '指定色转珠类', '转为颜色', '变为-火'], 0],
			['→水', ['主动技', '指定色转珠类', '转为颜色', '变为-水'], 1],
			['→木', ['主动技', '指定色转珠类', '转为颜色', '变为-木'], 2],
			['→光', ['主动技', '指定色转珠类', '转为颜色', '变为-光'], 3],
			['→暗', ['主动技', '指定色转珠类', '转为颜色', '变为-暗'], 4],
			['→心', ['主动技', '指定色转珠类', '转为颜色', '变为-心'], 5],
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
	const CUSTOM_FILTERS = {
		'maxhp-up': cards => cards.filter(c => { const sk = activeSkillOf(c, [237]); return sk && sk.params[1] > 100; }),
		'enemy-attr-any': cards => cards.filter(c => enemyAttrOf(c) !== null),
	};
	for (let a = 0; a < 5; a++) CUSTOM_FILTERS['enemy-attr-' + a] = cards => cards.filter(c => enemyAttrOf(c) === a);

	function findFilter(path) {
		if (typeof path === 'string') return CUSTOM_FILTERS[path.replace('custom:', '')] || null;
		let node = specialSearchFunctions;
		for (const name of path) {
			node = node?.functions?.find(f => (f.otLangName?.chs ?? f.name) === name);
			if (!node) return null;
		}
		return typeof node.function === 'function' ? node.function : null;
	}

	const fstate = Object.assign({ chips: [], mode: 'and', maxCd: 0 }, load('skill-filter', {}));
	function saveF() { save('skill-filter', fstate); }

	function minCd(card) {
		const sk = Skills?.[card.activeSkillId];
		if (!card.activeSkillId || !sk) return Infinity;
		return sk.initialCooldown - sk.maxLevel + 1;
	}

	function applySkillFilter(cards) {
		let result = cards;
		if (fstate.maxCd > 0) result = result.filter(c => minCd(c) <= fstate.maxCd);
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

	function runSearch() {
		document.querySelector('.search-box .search-start')?.click();
	}

	function buildSkillFilter() {
		const anchor = document.querySelector('.search-box .special-div');
		if (!anchor || document.querySelector('.mypdc-skill-filter')) return;
		const countLabel = el('span', { class: 'mypdc-chip-count' });
		const chipButtons = [];
		const refresh = () => {
			chipButtons.forEach(b => b.classList.toggle('on', fstate.chips.includes(b.dataset.key)));
			const n = fstate.chips.length + (fstate.maxCd > 0 ? 1 : 0);
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
				el('button', { type: 'button', onclick: () => { fstate.chips = []; fstate.maxCd = 0; saveF(); panel.querySelector('input[type=number]').value = ''; refresh(); runSearch(); } }, '清除技能条件'),
			),
			groups,
			el('div', { class: 'mypdc-hint' }, '点选后自动重新搜索，可以和上面的属性、类型、觉醒条件一起用。更细的技能条件在下面的“特殊搜索”里。'),
		);
		panel.addEventListener('toggle', () => save('skill-filter-open', panel.open));
		anchor.before(panel);
		refresh();
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

	function doRender() {
		document.body.classList.toggle('mypdc-listview', !!S.cfg.listView);
		if (!wrap || !S.cfg.listView) return;
		const heads = [...ul.children].filter(li => li.card);
		const scroll = wrap.scrollTop;
		wrap.innerHTML = '';
		if (!heads.length) {
			wrap.append(el('div', { class: 'mypdc-hint mypdc-list-empty' }, '没有搜索结果。设置条件后点“开始搜索”。'));
			return;
		}
		let rows = heads.map(li => ({ li, card: li.card }));
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

		const head = el('tr', null, COLUMNS.map(c => {
			const active = c.key === lstate.key;
			return el('th', {
				class: (c.value ? 'mypdc-sortable' : '') + (active ? ' mypdc-sorted' : ''),
				onclick: c.value ? () => {
					if (lstate.key === c.key) lstate.desc = !lstate.desc;
					else { lstate.key = c.key; lstate.desc = !c.asc; }
					save('list-sort', lstate); shown = PAGE; render();
				} : null,
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

	function buildList() {
		ul = document.querySelector('.search-mon-list');
		if (!ul || wrap) return;
		wrap = el('div', { class: 'mypdc-list-wrap' });
		ul.before(wrap);
		new MutationObserver(() => { shown = PAGE; render(); }).observe(ul, { childList: true });
		S.onChange(render);
		render();
	}

	window.addEventListener('load', () => {
		buildSkillFilter();
		buildList();
	});
	MyPDC.list = { render, applySkillFilter, fstate };
})();
