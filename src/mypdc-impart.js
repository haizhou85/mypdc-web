'use strict';
// 我的 PDC：觉醒赋予（使用武器技能后，武器被移除、觉醒赋予给装备它的宠物）
(function () {
	const { el, load, save } = MyPDC;

	const state = { on: !!load('impart-on', false) };

	// 卡片主动技能赋予的觉醒（没有则 null）
	const cache = new Map();
	const skillsReady = () => typeof Skills !== 'undefined' && Skills.length > 1000;
	function impartOf(card) {
		if (!card || !card.activeSkillId) return null;
		if (!skillsReady()) return null; // 技能数据还没读完：不缓存，稍后再查
		if (cache.has(card.id)) return cache.get(card.id);
		let found = null;
		const walk = n => {
			if (found) return;
			if (Array.isArray(n)) { n.forEach(walk); return; }
			if (!n || typeof n !== 'object') return;
			if (n.kind === SkillKinds.ImpartAwakenings && Array.isArray(n.awakenings) && n.target) {
				found = n.awakenings.filter(a => a > 0);
				return;
			}
			for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v);
		};
		try { walk(skillParser(card.activeSkillId)); } catch (e) { /* 解析失败当作没有 */ }
		cache.set(card.id, found && found.length ? found : null);
		return cache.get(card.id);
	}
	// 队伍里这个辅助位当前是否按“已赋予”计算
	function activeImpart(assist) {
		if (!state.on || !assist || !(assist.id > 0)) return null;
		return impartOf(Cards[assist.id]);
	}

	// ---- 接入上游的计算 ----
	// 1) 队员的有效觉醒
	const origEffective = Member.prototype.effectiveAwokens;
	Member.prototype.effectiveAwokens = function (assist) {
		const imp = activeImpart(assist);
		if (!imp || this.id <= 0) return origEffective.call(this, assist);
		return [...origEffective.call(this, undefined), ...imp];
	};

	// 2) 属性 / 类型（赋予的觉醒里可能有追加类型）
	const origAttrsTypes = Member.prototype.getAttrsTypesWithWeapon;
	Member.prototype.getAttrsTypesWithWeapon = function (assist, impartAwakenings) {
		const imp = activeImpart(assist);
		if (!imp) return origAttrsTypes.call(this, assist, impartAwakenings);
		return origAttrsTypes.call(this, undefined, [...(impartAwakenings || []), ...imp]);
	};

	// 3) 全队某个觉醒的个数
	if (typeof awokenCountInTeam === 'function') {
		const origCount = awokenCountInTeam;
		awokenCountInTeam = function (team, awokenIndex, soloArg, teamsCountArg) { // eslint-disable-line no-global-assign
			let n = origCount.apply(this, arguments);
			if (!state.on) return n;
			const [members, assists] = team;
			members.forEach((m, i) => {
				const a = assists[i];
				const imp = activeImpart(a);
				if (!imp || !(m?.id > 0) || !Cards[m.id]?.enabled) return;
				const aCard = Cards[a.id];
				if (aCard?.enabled && aCard.awakenings.includes(49)) { // 武器被移除，减去武器的觉醒
					n -= aCard.awakenings.slice(0, a.awoken).filter(x => x == awokenIndex).length;
				}
				n += imp.filter(x => x == awokenIndex).length;
			});
			return n;
		};
	}

	// 4) 队员能力值：武器移除（无辅助加成，自力生效），赋予的觉醒计入
	if (typeof calculateAbility === 'function') {
		const origCalc = calculateAbility;
		calculateAbility = function (member, assist, soloArg, teamsCountArg) { // eslint-disable-line no-global-assign
			const imp = activeImpart(assist);
			const card = member && Cards[member.id];
			if (!imp || !card || !card.enabled) return origCalc.apply(this, arguments);
			const own = card.awakenings.slice(0, member.awoken);
			const clone = Object.assign(Object.create(Object.getPrototypeOf(card)), card, { awakenings: [...own, ...imp] });
			const tempMember = Object.assign(Object.create(Object.getPrototypeOf(member)), member, { awoken: own.length + imp.length });
			Cards[member.id] = clone;
			try {
				return origCalc.call(this, tempMember, { id: 0 }, soloArg, teamsCountArg);
			} finally {
				Cards[member.id] = card;
			}
		};
	}

	// 5) 队员下方的觉醒图标：赋予的觉醒并入本体（标记出来），武器的觉醒清空
	if (typeof refreshMemberAwoken === 'function') {
		const origRefresh = refreshMemberAwoken;
		refreshMemberAwoken = function (memberAwokenDom, assistAwokenDom, team, idx) { // eslint-disable-line no-global-assign
			const out = origRefresh.apply(this, arguments);
			const imp = activeImpart(team?.[1]?.[idx]);
			if (!imp || !memberAwokenDom || !(team[0][idx]?.id > 0)) return out;
			const memberUl = memberAwokenDom.querySelector(`.member-awoken[data-index="${idx}"] .awoken-ul`);
			const assistUl = assistAwokenDom?.querySelector(`.member-awoken[data-index="${idx}"] .awoken-ul`);
			if (assistUl) assistUl.innerHTML = '';
			const counts = new Map();
			imp.forEach(a => {
				const eak = equivalent_awoken.find(e => e.big === a);
				const key = eak ? eak.small : a;
				counts.set(key, (counts.get(key) || 0) + (eak ? eak.times : 1));
			});
			counts.forEach((num, ak) => {
				const icon = memberUl.querySelector(`.awoken-icon[data-awoken-icon="${ak}"]`);
				if (icon) {
					icon.setAttribute('data-awoken-count', (parseInt(icon.getAttribute('data-awoken-count'), 10) || 0) + num);
					icon.classList.add('mypdc-imparted');
				} else {
					const li = memberUl.appendChild(document.createElement('li'));
					const i = li.appendChild(document.createElement('icon'));
					i.className = 'awoken-icon mypdc-imparted';
					i.setAttribute('data-awoken-icon', ak);
					i.setAttribute('data-awoken-count', num);
				}
			});
			return out;
		};
	}

	// ---- 开关 ----
	function buildToggle() {
		const bar = document.querySelector('.formation-control');
		if (!bar || document.querySelector('.mypdc-impart-toggle')) return;
		const label = el('label', { class: 'mypdc-impart-toggle', title: '按“已使用觉醒赋予武器的技能”的状态计算：武器被移除，觉醒赋予给本体（影响觉醒统计、HP 等能力值、自力觉醒）' },
			el('input', { type: 'checkbox', checked: state.on, onchange: e => {
				state.on = e.target.checked;
				save('impart-on', state.on);
				document.body.classList.toggle('mypdc-impart-on', state.on);
				if (typeof refreshAll === 'function') refreshAll(formation);
			} }),
			' 觉醒赋予后');
		bar.append(label);
		document.body.classList.toggle('mypdc-impart-on', state.on);
	}
	window.addEventListener('load', buildToggle);
	// 技能数据读完后，如果开关是开着的，重新计算一次队伍
	const waitSkills = setInterval(() => {
		if (!skillsReady()) return;
		clearInterval(waitSkills);
		if (state.on && typeof refreshAll === 'function' && typeof formation !== 'undefined') refreshAll(formation);
	}, 300);

	MyPDC.impart = { state, impartOf };
})();
