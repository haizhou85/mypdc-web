'use strict';
// 我的 PDC：编队里选择要开的增强技能（盾、HP上限提升），计算开技后的 HP、减伤和等效HP
(function () {
	const { el, fmt, teamStats, cardName } = MyPDC;
	const ATTR = ['火', '水', '木', '光', '暗', '心'];
	const picks = []; // 每个队伍选中的技能 { shield: key, hp: key }

	// 技能解析结果里的限时效果（不看随机技能，结果不确定）；多段进化技能记下是第几段
	function timedEffects(skillId) {
		const out = [];
		const walk = (n, turns, stage) => {
			if (Array.isArray(n)) { n.forEach(x => walk(x, turns, stage)); return; }
			if (!n || typeof n !== 'object') return;
			if (n.kind === SkillKinds.RandomSkills) return;
			if (n.kind === SkillKinds.EvolvedSkills) {
				(n.skills || []).forEach((sk, i) => walk(sk, turns, (n.skills.length > 1 ? i + 1 : 0)));
				return;
			}
			if (n.kind === SkillKinds.ActiveTurns) { (n.skills || []).forEach(x => walk(x, n.turns, stage)); return; }
			if (turns && n.kind === SkillKinds.ReduceDamage) out.push({ type: 'shield', turns, stage, node: n });
			if (turns && n.kind === SkillKinds.PowerUp && !n.attrs?.length && !n.types?.length && !n.targets && !n.condition &&
				n.value?.kind === SkillPowerUpKind.Multiplier && n.value.hp > 1) out.push({ type: 'hp', turns, stage, node: n });
			for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v, turns, stage);
		};
		try { walk(skillParser(skillId), 0, 0); } catch (e) { /* 解析失败当作没有 */ }
		return out;
	}

	function shieldInfo(node) {
		const pct = Number(node.percent?.value) || 0;
		const prob = Number(node.prob?.value ?? node.prob) || 1;
		const attrs = node.attrs === 'all' || !Array.isArray(node.attrs) ? null : node.attrs.filter(a => a >= 0 && a <= 5);
		const all = !attrs || attrs.length >= 5;
		return { pct, prob, attrText: all ? '' : attrs.map(a => ATTR[a]).join('') + '属性' };
	}

	// 队伍里能用的盾 / HP上限技能（队员本身和辅助的主动技能）
	function teamSkills(team) {
		const [members, assists] = team;
		const res = { shield: [], hp: [] };
		const seen = new Set();
		members.forEach((m, i) => {
			[[m, ''], [assists?.[i], '辅助']].forEach(([mem, tag]) => {
				const card = mem?.id > 0 ? Cards[mem.id] : null;
				if (!card?.activeSkillId) return;
				timedEffects(card.activeSkillId).forEach((e, k) => {
					const key = `${i}-${tag ? 'a' : 'm'}-${card.id}-${k}`;
					if (seen.has(key)) return;
					seen.add(key);
					const who = `${i + 1}号${tag ? '辅助' : ''} ${cardName(card.id)}${e.stage ? `（第${e.stage}段）` : ''}`;
					if (e.type === 'shield') {
						const s = shieldInfo(e.node);
						if (!(s.pct > 0)) return;
						res.shield.push({
							key, rate: s.pct, prob: s.prob,
							text: `${s.attrText}减伤${Math.round(s.pct * 100)}%${s.prob < 1 ? `（${Math.round(s.prob * 100)}%几率）` : ''} ${e.turns}回合 · ${who}`,
						});
					} else {
						const mul = e.node.value.hp;
						res.hp.push({ key, rate: mul, text: `HP上限×${+mul.toFixed(2)} ${e.turns}回合 · ${who}` });
					}
				});
			});
		});
		res.shield.sort((a, b) => b.rate - a.rate);
		res.hp.sort((a, b) => b.rate - a.rate);
		return res;
	}

	function render(teamIdx) {
		const box = (typeof teamBigBoxs !== 'undefined' ? teamBigBoxs[teamIdx] : null)?.querySelector('.team-total-info');
		const st = teamStats[teamIdx];
		if (!box || !st?.team || typeof Skills === 'undefined' || Skills.length < 1000) return;
		let row = box.parentElement.querySelector(`.mypdc-skilluse[data-team="${teamIdx}"]`);
		if (!row) {
			row = el('div', { class: 'mypdc-skilluse', 'data-team': teamIdx });
			box.after(row);
		}
		const skills = teamSkills(st.team);
		const pick = picks[teamIdx] = picks[teamIdx] || { shield: '', hp: '' };
		if (!skills.shield.some(s => s.key === pick.shield)) pick.shield = '';
		if (!skills.hp.some(s => s.key === pick.hp)) pick.hp = '';

		const select = (kind, label, list) => {
			const sel = el('select', { onchange: e => { pick[kind] = e.target.value; render(teamIdx); } },
				el('option', { value: '' }, list.length ? '不开技' : '（队伍里没有）'),
				list.map(s => el('option', { value: s.key, selected: s.key === pick[kind] }, s.text)));
			sel.disabled = !list.length;
			return el('label', { class: 'mypdc-skilluse-pick' }, el('span', null, label), sel);
		};

		row.innerHTML = '';
		row.append(select('shield', '🛡 盾', skills.shield), select('hp', '❤ HP上限', skills.hp));

		const shield = skills.shield.find(s => s.key === pick.shield);
		const hpUp = skills.hp.find(s => s.key === pick.hp);
		if ((shield || hpUp) && st.tHP > 0) {
			const leader = st.totalReduce || 0;
			const hp = Math.round(st.tHP * (hpUp ? hpUp.rate : 1));
			const reduce = 1 - (1 - leader) * (1 - (shield ? shield.rate : 0));
			const ehp = Math.floor(hp / (1 - reduce));
			row.append(el('div', { class: 'mypdc-skilluse-result' },
				'开技后：HP ', el('b', null, fmt(hp)),
				' · 减伤 ', el('b', null, (reduce * 100).toFixed(2) + '%'),
				reduce >= 1 ? ' · 无敌' : [' · 等效HP ', el('b', null, fmt(ehp))],
				el('span', { class: 'mypdc-skilluse-base' }, `（不开技：等效HP ${fmt(st.tReduceHP || st.tHP)}）`),
				shield?.prob < 1 ? el('div', { class: 'mypdc-skilluse-note' }, '按概率盾发动时计算') : null));
		}
	}

	MyPDC.onTeamUpdate(teamIdx => { if (teamIdx >= 0) render(teamIdx); });
	// 技能数据比队伍晚读取完时补一次
	const timer = setInterval(() => {
		if (typeof Skills !== 'undefined' && Skills.length > 1000) {
			clearInterval(timer);
			teamStats.forEach((st, i) => st && render(i));
		}
	}, 500);

	MyPDC.skillUse = { teamSkills, render };
})();
