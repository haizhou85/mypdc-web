'use strict';
// 我的 PDC：编队里选择要开的增强技能（盾、HP上限提升），计算开技后的 HP、减伤和等效HP
(function () {
	const { el, fmt, teamStats, cardName } = MyPDC;
	const ATTR = ['火', '水', '木', '光', '暗', '心'];
	const picks = []; // 每个队伍选中的技能 { shield: key, hp: key, attr: key }
	const TARGET_TEXT = { self: '自己', 'leader-self': '队长', 'leader-helper': '好友队长', 'sub-members': '队员', 'left-neighbor': '左边', 'right-neighbor': '右边' };

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
			if (turns && n.kind === SkillKinds.ChangeAttribute && (n.targets || []).length && !(n.targets || []).some(t => String(t).startsWith('enemy')))
				out.push({ type: 'attr', turns, stage, node: n });
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
		const mask = all ? 0b11111 : attrs.reduce((m, a) => m | (1 << a), 0);
		return { pct, prob, mask, attrText: all ? '' : attrs.map(a => ATTR[a]).join('') + '属性' };
	}

	// 队伍里能用的盾 / HP上限技能（队员本身和辅助的主动技能）
	function teamSkills(team) {
		const [members, assists] = team;
		const res = { shield: [], hp: [], attr: [] };
		const leaderIdx = team[3] || 0;
		const last = members.length - 1;
		const seen = new Set();
		members.forEach((m, i) => {
			// 本体、辅助，以及变身宠物变身前各形态的技能（例如变身时让右边变属性）
			const sources = [];
			const addSrc = (id, tag, pre) => { const c = id > 0 ? Cards[id] : null; if (c?.activeSkillId) sources.push([c, tag, pre]); };
			addSrc(m?.id, '', false);
			const seenForm = new Set([m?.id]);
			let froms = [...(Cards[m?.id]?.henshinFrom || [])];
			while (froms.length && seenForm.size < 8) {
				const id = froms.shift();
				if (seenForm.has(id)) continue;
				seenForm.add(id);
				addSrc(id, '', true);
				froms.push(...(Cards[id]?.henshinFrom || []));
			}
			addSrc(assists?.[i]?.id, '辅助', false);
			sources.forEach(([card, tag, pre]) => {
				timedEffects(card.activeSkillId).forEach((e, k) => {
					const key = `${i}-${tag ? 'a' : 'm'}-${card.id}-${k}`;
					if (seen.has(key)) return;
					seen.add(key);
					const who = `${i + 1}号${tag ? '辅助' : ''} ${cardName(card.id)}${pre ? '（变身前）' : ''}${e.stage ? `（第${e.stage}段）` : ''}`;
					if (e.type === 'shield') {
						const s = shieldInfo(e.node);
						if (!(s.pct > 0)) return;
						res.shield.push({
							key, rate: s.pct, prob: s.prob, mask: s.mask,
							text: `${s.attrText}减伤${Math.round(s.pct * 100)}%${s.prob < 1 ? `（${Math.round(s.prob * 100)}%几率）` : ''} ${e.turns}回合 · ${who}`,
						});
					} else if (e.type === 'attr') {
						// 变属性：只改宠物本身的属性，武器（辅助）的属性不变，所以会影响武装共鸣、同属性加成和队长技倍率
						const attr = e.node.attr ?? 0;
						const idx = new Set();
						(e.node.targets || []).forEach(t => {
							if (t === 'self') idx.add(i);
							else if (t === 'leader-self') idx.add(leaderIdx);
							else if (t === 'leader-helper' && teamsCount !== 2) idx.add(last);
							else if (t === 'sub-members') members.forEach((_, j) => { if (j !== leaderIdx && j !== last) idx.add(j); });
							else if (t === 'left-neighbor' && i > 0) idx.add(i - 1);
							else if (t === 'right-neighbor' && i < last) idx.add(i + 1);
						});
						const who2 = (e.node.targets || []).map(t => TARGET_TEXT[t] || t).join('、');
						res.attr.push({ key, attr, idx: [...idx], text: `${who2}变为${ATTR[attr] || '?'}属性 ${e.turns}回合 · ${who}` });
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
		const pick = picks[teamIdx] = picks[teamIdx] || { shield: '', hp: '', attr: '' };
		if (!skills.shield.some(s => s.key === pick.shield)) pick.shield = '';
		if (!skills.hp.some(s => s.key === pick.hp)) pick.hp = '';
		if (pick.attr && !skills.attr.some(s => s.key === pick.attr)) { pick.attr = ''; setTimeout(() => refreshAll?.(formation)); }

		// 不用原生下拉框：iPhone Safari 上放在缩放过的编队区里，重绘后文字会变大
		const select = (kind, label, list) => {
			const none = list.length ? '不开技' : '（队伍里没有）';
			const cur = list.find(s => s.key === pick[kind]);
			const dd = el('details', { class: 'mypdc-dd' + (list.length ? '' : ' mypdc-dd-disabled') + (cur ? ' mypdc-dd-on' : '') },
				el('summary', null, cur ? cur.text : none));
			if (list.length) {
				const choose = key => { dd.open = false; setPick(teamIdx, kind, key); };
				dd.append(el('div', { class: 'mypdc-dd-list' },
					[{ key: '', text: '不开技' }, ...list].map(s => el('button', {
						type: 'button', class: s.key === (pick[kind] || '') ? 'mypdc-dd-cur' : null,
						onclick: () => choose(s.key),
					}, s.text))));
				// 点外面关闭
				dd.addEventListener('toggle', () => {
					if (!dd.open) return;
					const close = e => { if (!dd.contains(e.target)) { dd.open = false; document.removeEventListener('click', close, true); } };
					setTimeout(() => document.addEventListener('click', close, true));
				});
			} else dd.addEventListener('click', e => e.preventDefault());
			return el('div', { class: 'mypdc-skilluse-pick' }, el('span', null, label), dd);
		};

		row.innerHTML = '';
		row.append(select('shield', '🛡 盾', skills.shield), select('hp', '❤ HP上限', skills.hp), select('attr', '🎨 变属性', skills.attr));

		const shield = skills.shield.find(s => s.key === pick.shield);
		const hpUp = skills.hp.find(s => s.key === pick.hp);
		applyToTotals(box, st, shield, hpUp);
	}

	// 开技后直接改写徽章旁边的 HP / 减伤 / 等效HP（上游每次刷新会重写，所以刷新后再套用一次）
	function applyToTotals(box, st, shield, hpUp) {
		const hpDom = box.querySelector('.tIf-total-hp');
		if (!hpDom) return;
		const on = !!(shield || hpUp) && st.tHP > 0;
		hpDom.classList.toggle('mypdc-skill-on', on);
		if (!on && !hpDom.dataset.mypdcChanged) return; // 不开技且没改过：保持上游的显示
		if (on) hpDom.dataset.mypdcChanged = '1'; else delete hpDom.dataset.mypdcChanged;
		const mul = hpUp ? hpUp.rate : 1;
		const reduce = 1 - (1 - (st.totalReduce || 0)) * (1 - (shield ? shield.rate : 0));
		const hp = Math.round(st.tHP * mul);
		const hpNo = Math.round((st.tHPNoAwoken || 0) * mul);
		const ehp = v => (reduce >= 1 ? Infinity : Math.floor(v / (1 - reduce)));
		const show = (dom, v) => {
			if (!dom) return;
			const text = Number.isFinite(v) ? v.bigNumberToString({ sub: true }) : '∞';
			if (typeof setTextContentAndAttribute === 'function') setTextContentAndAttribute(dom, text);
			else dom.textContent = typeof text === 'string' ? text : String(v);
		};
		show(hpDom.querySelector(':scope > .general'), hp);
		show(hpDom.querySelector(':scope > .awoken-bind'), hpNo);
		const r = hpDom.querySelector('.reduce');
		if (r) {
			r.classList.toggle('no-reduce', reduce === 0);
			const scale = r.querySelector('.reduce-scale');
			if (scale) {
				if (typeof setTextContentAndAttribute === 'function') setTextContentAndAttribute(scale, (reduce * 100).toFixed(2));
				else scale.textContent = (reduce * 100).toFixed(2);
			}
			show(r.querySelector('.general'), ehp(hp));
			show(r.querySelector('.awoken-bind'), ehp(hpNo));
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

	// 当前队伍选中的开技效果（关卡伤害计算用）：{ shield: { rate, mask } | null, hpMul }
	function current(teamIdx) {
		const st = teamStats[teamIdx];
		const pick = picks[teamIdx];
		if (!st?.team || !pick) return { shield: null, hpMul: 1 };
		const skills = teamSkills(st.team);
		const shield = skills.shield.find(s => s.key === pick.shield) || null;
		const hp = skills.hp.find(s => s.key === pick.hp);
		return { shield, hpMul: hp ? hp.rate : 1 };
	}

	// 关卡伤害面板里也可以选（和编队上方的选择同步）
	function getPick(teamIdx) { return picks[teamIdx] || { shield: '', hp: '', attr: '' }; }
	function setPick(teamIdx, kind, key) {
		picks[teamIdx] = picks[teamIdx] || { shield: '', hp: '', attr: '' };
		picks[teamIdx][kind] = key;
		// 变属性会改变能力值、队长技倍率：整体重算；盾和 HP 上限只改合计
		if (kind === 'attr' && typeof refreshAll === 'function') refreshAll(formation);
		else render(teamIdx);
	}

	// ---------- 变属性：计算时临时把宠物的主属性改掉（武器属性不变），算完恢复 ----------
	let depth = 0, undoList = null;
	function applyAttr() {
		const undo = [];
		(formation?.teams || []).forEach((team, ti) => {
			const key = picks[ti]?.attr;
			if (!key) return;
			const sk = teamSkills(team).attr.find(s => s.key === key);
			if (!sk) return;
			sk.idx.forEach(j => {
				const card = Cards[team[0][j]?.id];
				if (!card || !(card.id > 0) || !Array.isArray(card.attrs)) return;
				undo.push([card, card.attrs]);
				card.attrs = [sk.attr, ...card.attrs.slice(1)];
			});
		});
		return undo;
	}
	function withAttr(fn, self, args) {
		if (depth === 0) undoList = applyAttr();
		depth++;
		try { return fn.apply(self, args); } finally {
			depth--;
			if (depth === 0 && undoList) { for (let k = undoList.length - 1; k >= 0; k--) undoList[k][0].attrs = undoList[k][1]; undoList = null; }
		}
	}
	function hasAttr() { return picks.some(p => p?.attr); }
	function hook(name) {
		const orig = window[name] ?? (typeof globalThis[name] === 'function' ? globalThis[name] : null);
		if (typeof orig !== 'function' || orig.__mypdcAttr) return;
		const wrapped = function () { return hasAttr() ? withAttr(orig, this, arguments) : orig.apply(this, arguments); };
		wrapped.__mypdcAttr = true;
		return wrapped;
	}
	window.addEventListener('load', () => setTimeout(() => {
		if (typeof refreshAll === 'function') { const w = hook('refreshAll'); if (w) refreshAll = w; } // eslint-disable-line no-global-assign
		if (typeof refreshTeamTotalHP === 'function') { const w = hook('refreshTeamTotalHP'); if (w) refreshTeamTotalHP = w; } // eslint-disable-line no-global-assign
		if (typeof refreshFormationTotalHP === 'function') { const w = hook('refreshFormationTotalHP'); if (w) refreshFormationTotalHP = w; } // eslint-disable-line no-global-assign
		if (typeof refreshAbility === 'function') { const w = hook('refreshAbility'); if (w) refreshAbility = w; } // eslint-disable-line no-global-assign
	}));

	MyPDC.skillUse = { teamSkills, render, current, getPick, setPick, withAttr: fn => (hasAttr() ? withAttr(fn, null, []) : fn()) };
})();
