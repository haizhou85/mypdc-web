'use strict';
// 我的 PDC：按“队伍中 HP / 指定觉醒条件下 HP”排序
(function () {
	const { el, load, save, leaderIds, fmt } = MyPDC;

	const cfg = Object.assign({
		level: 120,         // 按多少级计算（不能突破的按最高等级）
		superAwoken: true,  // 计入超觉醒（自动选 HP 最高的那个）
		selfAwoken: false,  // 视为无辅助（激活“自力觉醒”×3）
		useLeader: true,    // 乘以当前队伍队长技的 HP 倍率（仅“队伍中HP”）
		useTeamHp: true,    // 计入全队 HP 觉醒（仅“队伍中HP”）
		uniformBase: 0,     // >0 时：所有宠物假定同一基础 HP，只比较觉醒倍率效果
		teamIdx: 0,
	}, load('sort-cfg', {}));

	let cache = new Map();
	let cacheTeamStamp = '';
	function clearCache() { cache = new Map(); }

	// 生成一个“满级满加值满觉醒”的临时队员
	function makeTempMember(card, sawoken) {
		const level = card.limitBreakIncr ? Math.min(cfg.level, 120) : card.maxLevel;
		const stackable = card.stackable || (card.types[0] == 15 && card.types[1] == -1);
		return {
			id: card.id,
			level,
			plus: stackable ? [0, 0, 0] : [99, 99, 99],
			awoken: card.awakenings.length,
			sawoken: sawoken || 0,
			latent: [],
		};
	}

	// 统一基础值模式：所有宠物同一基础 HP，只体现觉醒效果
	function uniformHp(card, awokenList) {
		const X = cfg.uniformBase;
		const count = id => awokenList.filter(a => a === id).length;
		let prev = 1.1 ** count(63);
		let flat = count(1) * (isJP ? 3000 : 2000) - count(65) * 2500;
		let latter = 1.5 ** count(127) * 1.25 ** count(132) * 1.8 ** count(142)
			* 1.5 ** (count(145) + count(146) + count(147));
		if (!solo) latter *= 1.5 ** count(30);
		if (cfg.selfAwoken) latter *= 3 ** count(139);
		const plus = card.stackable ? 0 : 990;
		return Math.max(1, Math.floor((Math.round(X * prev) + plus + flat) * latter));
	}

	function awokenListOf(card, member) {
		const list = card.awakenings.slice(0, member.awoken);
		if ((solo || teamsCount === 3) && member.sawoken > 0) list.push(member.sawoken);
		return list;
	}

	// 宠物自身 HP（不含队伍效果）
	function selfHp(card, sawoken) {
		const m = makeTempMember(card, sawoken);
		if (cfg.uniformBase > 0) return { hp: uniformHp(card, awokenListOf(card, m)), member: m };
		const assist = cfg.selfAwoken ? { id: 0 } : null;
		const ab = calculateAbility(m, assist, solo, teamsCount);
		if (!ab) return { hp: 0, member: m };
		m.ability = ab.map(a => a[0]);
		m.abilityNoAwoken = ab.map(a => a[1]);
		return { hp: ab[0][0], member: m };
	}

	function bestSelfHp(card) {
		const options = [0];
		if (cfg.superAwoken && (solo || teamsCount === 3)) options.push(...(card.superAwakenings || []));
		let best = null;
		for (const sa of options) {
			const r = selfHp(card, sa);
			if (!best || r.hp > best.hp) best = r;
		}
		return best;
	}

	// 把宠物放进当前队伍后的 HP
	function teamHp(card) {
		const best = bestSelfHp(card);
		if (!best || best.hp <= 0) return 0;
		const team = formation.teams[cfg.teamIdx] || formation.teams[0];
		let hp = best.hp;
		if (cfg.useLeader && team) {
			const [l1, l2] = leaderIds(cfg.teamIdx);
			const m = Object.assign({}, best.member, {
				ability: [best.hp, 0, 0], abilityNoAwoken: [best.hp, 0, 0],
			});
			const members = [...team[0], m];
			const assists = [...team[1], { id: 0 }];
			const arr = countTeamHp([members, assists], l1, l2, solo);
			hp = arr[arr.length - 1] ?? hp;
		}
		if (cfg.useTeamHp && team) {
			const own = awokenListOf(card, best.member).filter(a => a === 46).length;
			const count = awokenCountInTeam(team, 46, solo, teamsCount) + own;
			hp *= 1 + 0.05 * count;
		}
		return Math.round(hp + 1e-12);
	}

	function teamStamp() {
		const team = formation?.teams?.[cfg.teamIdx];
		if (!team) return '';
		return JSON.stringify([team[0].map(m => [m.id, m.awoken, m.sawoken]), team[1].map(m => [m.id, m.awoken]), team[3], solo, teamsCount]);
	}

	function cached(kind, card, fn) {
		const stamp = kind === 'team' ? teamStamp() : '';
		if (kind === 'team' && stamp !== cacheTeamStamp) {
			cacheTeamStamp = stamp;
			for (const k of [...cache.keys()]) if (k.startsWith('team:')) cache.delete(k);
		}
		const key = kind + ':' + card.id;
		if (!cache.has(key)) cache.set(key, fn(card));
		return cache.get(key);
	}

	const valueFns = {
		mypdc_team_hp: card => cached('team', card, teamHp),
		mypdc_self_hp: card => cached('self', card, c => bestSelfHp(c)?.hp ?? 0),
	};

	sort_function_list.push(
		{ tag: 'mypdc_team_hp', name: '★队伍中HP（含队长技、全队HP觉醒）', function: (a, b) => valueFns.mypdc_team_hp(a) - valueFns.mypdc_team_hp(b) },
		{ tag: 'mypdc_self_hp', name: '★自身HP（按下方觉醒条件）', function: (a, b) => valueFns.mypdc_self_hp(a) - valueFns.mypdc_self_hp(b) },
	);

	function currentSortTag() {
		const list = document.querySelector('.search-box .sort-div .sort-list');
		return list?.selectedOptions?.[0]?.getAttribute('data-tag');
	}

	// 在搜索结果头像上显示当前排序用的数值
	function annotateResults() {
		const tag = currentSortTag();
		const fn = valueFns[tag];
		document.querySelectorAll('.search-mon-list > *').forEach(li => {
			let badge = li.querySelector('.mypdc-sortval');
			const card = li.card;
			if (!fn || !card) {
				badge?.remove();
				return;
			}
			if (!badge) {
				badge = el('span', { class: 'mypdc-sortval' });
				li.append(badge);
			}
			badge.textContent = fmt(fn(card));
		});
	}

	function resort() {
		clearCache();
		const list = document.querySelector('.search-box .sort-div .sort-list');
		list?.dispatchEvent(new Event('change'));
		annotateResults();
	}

	function buildPanel() {
		const sortDiv = document.querySelector('.search-box .sort-div');
		if (!sortDiv || document.querySelector('.mypdc-sort-cfg')) return;

		const onChange = (key, parse) => e => {
			cfg[key] = parse(e.target);
			save('sort-cfg', cfg);
			resort();
		};
		const bool = t => t.checked;
		const num = t => Math.max(0, parseInt(t.value, 10) || 0);

		const teamSel = el('select', { onchange: onChange('teamIdx', num) });
		const refreshTeamSel = () => {
			const n = formation?.teams?.length || 1;
			teamSel.innerHTML = '';
			for (let i = 0; i < n; i++) teamSel.add(new Option(`队伍${i + 1}`, i));
			if (cfg.teamIdx >= n) cfg.teamIdx = 0;
			teamSel.value = cfg.teamIdx;
			teamSel.parentElement.classList.toggle('display-none', n < 2);
		};

		const panel = el('details', { class: 'mypdc-sort-cfg', open: load('sort-cfg-open', true) },
			el('summary', null, '★排序计算条件'),
			el('div', { class: 'mypdc-row' },
				el('label', null, '等级 ',
					el('select', { onchange: onChange('level', num) },
						[99, 110, 120].map(l => el('option', { value: l, selected: cfg.level === l }, l === 99 ? '最高(不突破)' : 'Lv' + l)))),
				el('label', null, el('input', { type: 'checkbox', checked: cfg.superAwoken, onchange: onChange('superAwoken', bool) }), ' 计入超觉醒(取HP最高)'),
				el('label', null, el('input', { type: 'checkbox', checked: cfg.selfAwoken, onchange: onChange('selfAwoken', bool) }), ' 激活自力觉醒(无辅助)'),
			),
			el('div', { class: 'mypdc-row' },
				el('label', null, el('input', { type: 'checkbox', checked: cfg.useLeader, onchange: onChange('useLeader', bool) }), ' 队长技HP倍率'),
				el('label', null, el('input', { type: 'checkbox', checked: cfg.useTeamHp, onchange: onChange('useTeamHp', bool) }), ' 全队HP觉醒'),
				el('label', null, '参照 ', teamSel),
			),
			el('div', { class: 'mypdc-row' },
				el('label', { title: '填 0 关闭。填入数值后，所有宠物都按这个基础HP计算，只比较觉醒带来的倍率效果' }, '统一基础HP ',
					el('input', { type: 'number', min: 0, step: 1000, value: cfg.uniformBase, style: 'width:6em', onchange: onChange('uniformBase', num) }),
					' (0=关闭，只比觉醒倍率)')),
			el('div', { class: 'mypdc-hint' }, '选择排序方式里带 ★ 的两项使用这些条件。“队伍中HP”是把宠物加入当前队伍后的HP（乘队长技倍率和全队HP觉醒，不含徽章）。'),
		);
		panel.addEventListener('toggle', () => save('sort-cfg-open', panel.open));
		sortDiv.after(panel);
		refreshTeamSel();

		sortDiv.querySelector('.sort-list')?.addEventListener('change', () => setTimeout(annotateResults));
		const listEl = document.querySelector('.search-mon-list');
		if (listEl) new MutationObserver(() => {
			if (valueFns[currentSortTag()]) annotateResults();
		}).observe(listEl, { childList: true });

		MyPDC.onTeamUpdate(() => {
			refreshTeamSel();
			if (currentSortTag() === 'mypdc_team_hp') annotateResults();
		});
	}

	window.addEventListener('load', buildPanel);
	MyPDC.sort = { cfg, teamHp, bestSelfHp, resort };
})();
