'use strict';
// 我的 PDC：按条件计算宠物能力值（激活各种条件觉醒），用于排序和列表
(function () {
	const { el, load, save, leaderIds, fmt } = MyPDC;

	const cfg = Object.assign({
		level: 120,         // 按多少级计算（不能突破的按最高等级）
		superAwoken: true,  // 计入超觉醒（自动选 HP 最高的那个）
		selfAwoken: false,  // 自力（无辅助）×3
		assistSync: false,  // 武装 / 武器同色（辅助共鸣）×3
		coop: false,        // 协力觉醒 ×1.5（多人模式下自动计入）
		stage: 1,           // 熟成：地下城层数 1 / 5(×1.5) / 10(×2)
		benefit: 0,         // 加护：1=阳 2=阴 3=阴阳（HP×2 攻×5 回×2）
		brokens: 0,         // 部位破坏个数（每个 ×1.2）
		useLeader: true,    // “队伍中HP”乘当前队伍队长技 HP 倍率
		useTeamHp: true,    // “队伍中HP”计入全队 HP 觉醒
		uniformBase: 0,     // >0 时：所有宠物假定同一基础 HP，只比较觉醒倍率效果
		teamIdx: 0,
		iconView: false,    // 搜索结果用图标显示（默认列表）
		plus891: false,     // 满加蛋 +891（每项 297）；默认 +297（每项 99）
	}, load('sort-cfg', {}));
	delete cfg.listView; // 旧版设置

	// 武器（有“武器”觉醒的辅助）加蛋超过 297 的部分无效
	function plusPerStat(card) {
		return cfg.plus891 && !card.awakenings.includes(49) ? 297 : 99;
	}

	const listeners = [];
	let cache = new Map();
	let teamCache = new Map();
	let teamCacheStamp = '';

	// 生成一个“满级满加值满觉醒”的临时队员
	function makeTempMember(card, sawoken) {
		const level = card.limitBreakIncr ? Math.min(cfg.level, 120) : card.maxLevel;
		const stackable = card.stackable || (card.types[0] == 15 && card.types[1] == -1);
		return {
			id: card.id,
			level: cfg.level === 99 ? card.maxLevel : level,
			plus: stackable ? [0, 0, 0] : Array(3).fill(plusPerStat(card)),
			awoken: card.awakenings.length,
			sawoken: sawoken || 0,
			latent: [],
		};
	}

	function awokenListOf(card, member) {
		const list = card.awakenings.slice(0, member.awoken);
		if ((solo || teamsCount === 3) && member.sawoken > 0) list.push(member.sawoken);
		return list;
	}

	// 条件觉醒的倍率 [HP, 攻, 回]
	function conditionScale(list) {
		const count = id => list.filter(a => a === id).length;
		const s = [1, 1, 1];
		const mul = (arr, n) => { if (n) for (let i = 0; i < 3; i++) s[i] *= arr[i] ** n; };
		// 自力（无辅助）和武装（有辅助）不能同时成立：两个都勾选时只算一次 ×3
		if (cfg.selfAwoken && cfg.assistSync) mul([3, 3, 3], Math.max(count(139), count(138)));
		else if (cfg.selfAwoken) mul([3, 3, 3], count(139));
		else if (cfg.assistSync) mul([3, 3, 3], count(138));
		if (cfg.coop && solo) mul([1.5, 1.5, 1.5], count(30));
		if (cfg.stage >= 5) { const k = cfg.stage >= 10 ? 2 : 1.5; mul([k, k, k], count(130)); }
		if (cfg.benefit & 1) mul([2, 5, 2], count(128));
		if (cfg.benefit & 2) mul([2, 5, 2], count(129));
		if (cfg.brokens > 0) { const k = 1.2 ** cfg.brokens; mul([k, k, k], count(131)); }
		return s;
	}

	// 统一基础值模式：所有宠物同一基础 HP，只体现（无条件）觉醒效果
	function uniformHp(card, list) {
		const X = cfg.uniformBase;
		const count = id => list.filter(a => a === id).length;
		const prev = 1.1 ** count(63);
		const flat = count(1) * (isJP ? 3000 : 2000) - count(65) * 2500;
		let latter = 1.5 ** count(127) * 1.25 ** count(132) * 1.8 ** count(142)
			* 1.5 ** (count(145) + count(146) + count(147));
		if (!solo) latter *= 1.5 ** count(30);
		const plus = card.stackable ? 0 : plusPerStat(card) * 10;
		return Math.max(1, Math.floor((Math.round(X * prev) + plus + flat) * latter));
	}

	// 计算时暂时去掉页面“地下城强化”里的熟成/加护/部位破坏，改用上面的条件，避免重复计算
	function withNeutralDungeon(fn) {
		const dge = formation.dungeonEnchance;
		const saved = { benefit: dge.benefit, stage: dge.stage, brokens: dge.brokens };
		dge.benefit = 0; dge.stage = 1; dge.brokens = 0;
		try { return fn(); } finally { Object.assign(dge, saved); }
	}

	function statsWith(card, sawoken) {
		const m = makeTempMember(card, sawoken);
		const ab = withNeutralDungeon(() => calculateAbility(m, null, solo, teamsCount));
		if (!ab) return null;
		const list = awokenListOf(card, m);
		const scale = conditionScale(list);
		const base = ab.map(a => a[0]);
		if (cfg.uniformBase > 0) base[0] = uniformHp(card, list);
		const [hp, atk, rcv] = base.map((v, i) => Math.floor(v * scale[i] + 1e-9));
		return { hp, atk, rcv, sawoken, member: m, list };
	}

	// 宠物自身能力值（取 HP 最高的超觉醒）
	function stats(card) {
		if (!card || !card.enabled) return null;
		if (cache.has(card.id)) return cache.get(card.id);
		const options = [0];
		if (cfg.superAwoken && (solo || teamsCount === 3)) options.push(...(card.superAwakenings || []));
		let best = null;
		for (const sa of options) {
			const r = statsWith(card, sa);
			if (r && (!best || r.hp > best.hp)) best = r;
		}
		cache.set(card.id, best);
		return best;
	}

	function teamStamp() {
		const team = formation?.teams?.[cfg.teamIdx];
		if (!team) return '';
		return JSON.stringify([team[0].map(m => [m.id, m.awoken, m.sawoken]), team[1].map(m => [m.id, m.awoken]), team[3], solo, teamsCount]);
	}

	// 把宠物放进当前队伍后的 HP
	function teamHp(card) {
		const stamp = teamStamp();
		if (stamp !== teamCacheStamp) { teamCacheStamp = stamp; teamCache = new Map(); }
		if (teamCache.has(card.id)) return teamCache.get(card.id);
		const best = stats(card);
		let hp = best?.hp || 0;
		const team = formation.teams[cfg.teamIdx] || formation.teams[0];
		if (hp > 0 && team) {
			if (cfg.useLeader) {
				const [l1, l2] = leaderIds(cfg.teamIdx);
				const m = Object.assign({}, best.member, { ability: [hp, 0, 0], abilityNoAwoken: [hp, 0, 0] });
				const arr = countTeamHp([[...team[0], m], [...team[1], { id: 0 }]], l1, l2, solo);
				hp = arr[arr.length - 1] ?? hp;
			}
			if (cfg.useTeamHp) {
				const own = best.list.filter(a => a === 46).length;
				hp *= 1 + 0.05 * (awokenCountInTeam(team, 46, solo, teamsCount) + own);
			}
			hp = Math.round(hp + 1e-12);
		}
		teamCache.set(card.id, hp);
		return hp;
	}

	function changed() {
		cache = new Map();
		teamCache = new Map();
		save('sort-cfg', cfg);
		listeners.forEach(fn => fn());
	}

	function buildPanel() {
		const sortDiv = document.querySelector('.search-box .sort-div');
		if (!sortDiv || document.querySelector('.mypdc-sort-cfg')) return;
		// 上游的排序下拉框和表格表头排序冲突，固定为“无”并隐藏（CSS）
		const upstreamSort = sortDiv.querySelector('.sort-list');
		if (upstreamSort) { upstreamSort.selectedIndex = 0; upstreamSort.dispatchEvent(new Event('change')); }

		const onChange = (key, parse) => e => { cfg[key] = parse(e.target); changed(); };
		const bool = t => t.checked;
		const num = t => Math.max(0, parseInt(t.value, 10) || 0);
		const check = (key, text, title) => el('label', { title }, el('input', { type: 'checkbox', checked: cfg[key], onchange: onChange(key, bool) }), ' ' + text);
		const select = (key, options) => el('select', { onchange: onChange(key, num) },
			options.map(([v, t]) => el('option', { value: v, selected: cfg[key] === v }, t)));

		const teamSel = el('select', { onchange: onChange('teamIdx', num) });
		const teamLabel = el('label', null, '参照 ', teamSel);
		const refreshTeamSel = () => {
			const n = formation?.teams?.length || 1;
			teamSel.innerHTML = '';
			for (let i = 0; i < n; i++) teamSel.add(new Option(`队伍${i + 1}`, i));
			if (cfg.teamIdx >= n) cfg.teamIdx = 0;
			teamSel.value = cfg.teamIdx;
			teamLabel.classList.toggle('display-none', n < 2);
		};

		const panel = el('details', { class: 'mypdc-sort-cfg', open: load('sort-cfg-open', true) },
			el('summary', null, '★能力值计算条件'),
			el('div', { class: 'mypdc-row' },
				el('label', { class: 'mypdc-switch' }, el('input', { type: 'checkbox', checked: cfg.iconView, onchange: onChange('iconView', bool) }), ' 图标模式'),
				el('label', null, '等级 ', select('level', [[99, '最高(不突破)'], [110, 'Lv110'], [120, 'Lv120']])),
				check('plus891', '满加蛋 +891', '每项加蛋 297（武器最多 +297）；不勾选为 +297'),
				check('superAwoken', '计入超觉醒(取HP最高)'),
			),
			el('div', { class: 'mypdc-row' },
				el('span', { class: 'mypdc-label' }, '激活觉醒：'),
				check('selfAwoken', '自力×3', '无辅助时'),
				check('assistSync', '武装(武器同色)×3', '辅助与本体同主属性且有共同类型时。和自力不能同时成立，同时拥有两种觉醒的宠物只算一次 ×3'),
				check('coop', '协力×1.5', '多人模式下自动计入'),
				el('label', null, '熟成 ', select('stage', [[1, '无'], [5, '5层+ ×1.5'], [10, '10层+ ×2']])),
				el('label', null, '加护 ', select('benefit', [[0, '无'], [1, '阳'], [2, '阴'], [3, '阴阳']])),
				el('label', null, '部位破坏 ', el('input', { type: 'number', min: 0, max: 10, value: cfg.brokens, style: 'width:3.5em', onchange: onChange('brokens', num) }), '个'),
			),
			el('div', { class: 'mypdc-row' },
				el('span', { class: 'mypdc-label' }, '队伍中HP：'),
				check('useLeader', '队长技HP倍率'),
				check('useTeamHp', '全队HP觉醒'),
				teamLabel,
				el('label', { title: '填 0 关闭。填入数值后，所有宠物都按这个基础HP计算，只比较觉醒带来的倍率效果' }, '统一基础HP ',
					el('input', { type: 'number', min: 0, step: 1000, value: cfg.uniformBase, style: 'width:6em', onchange: onChange('uniformBase', num) }),
					' (0=关闭)')),
			el('div', { class: 'mypdc-hint' }, '列表里的能力值按这些条件计算，点表头排序。“队伍中HP”= 加入当前队伍后的HP（乘队长技倍率和全队HP觉醒，不含徽章）。选中宠物时，下方详细信息的加蛋也会按“满加蛋”设为 +891 或 +297。'),
		);
		panel.addEventListener('toggle', () => save('sort-cfg-open', panel.open));
		sortDiv.after(panel);
		refreshTeamSel();

		MyPDC.onTeamUpdate(() => {
			refreshTeamSel();
			teamCache = new Map();
			listeners.forEach(fn => fn());
		});
	}

	window.addEventListener('load', buildPanel);
	MyPDC.sort = { cfg, stats, teamHp, changed, onChange: fn => listeners.push(fn) };
})();
