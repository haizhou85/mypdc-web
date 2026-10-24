'use strict';
// 我的 PDC：宠物详情显示
// 1) 随机技能里各子技能只差一项时，合并显示：共同效果列一次，不同的部分列成“随机其中一种”
// 2) 技能说明默认不显示图标（文字已能表达意思），可在条件面板里打开
(function () {
	const { load, save, el } = MyPDC;

	// ---------- 1) 随机技能合并 ----------
	// 返回 { commonIds, diffIds }，不符合条件返回 null
	function similarRandom(skill) {
		if (!skill || skill.type !== 118) return null;
		const subs = (skill.params || []).map(id => Skills[id]);
		if (subs.length < 2 || subs.some(s => !s || s.type !== 116)) return null;
		const len = subs[0].params.length;
		if (subs.some(s => s.params.length !== len)) return null;
		const diffPos = [];
		for (let i = 0; i < len; i++) if (new Set(subs.map(s => s.params[i])).size > 1) diffPos.push(i);
		if (diffPos.length !== 1) return null;
		const i = diffPos[0];
		return {
			commonIds: subs[0].params.filter((_, k) => k !== i),
			diffIds: subs.map(s => s.params[i]),
		};
	}

	// 各子技能只是“把敌人变成哪种属性”不同（例如官方数据把“变成火以外的属性”写成随机 4 选 1）：合成一句话
	function attrChoice(parts) {
		const one = parts.map(p => (p?.length === 1 && p[0].kind === SkillKinds.ActiveTurns && p[0].skills?.length === 1 &&
			p[0].skills[0].kind === SkillKinds.ChangeAttribute) ? p[0] : null);
		if (one.some(x => !x)) return null;
		const turns = one[0].turns, targets = JSON.stringify(one[0].skills[0].targets);
		if (one.some(x => x.turns !== turns || JSON.stringify(x.skills[0].targets) !== targets)) return null;
		const attrs = one.map(x => x.skills[0].attr ?? 0);
		return { kind: SkillKinds.RandomSkills, mypdcAttrChoice: true, turns, attrs, targets: one[0].skills[0].targets, skills: [] };
	}
	const ATTR_TEXT = ['火', '水', '木', '光', '暗'];

	if (typeof skillParser === 'function') {
		const origParser = skillParser;
		skillParser = function (skillId) { // eslint-disable-line no-global-assign
			const skill = Skills?.[skillId];
			const sim = similarRandom(skill);
			if (!sim) return origParser.apply(this, arguments);
			try {
				// 用一个临时的“组合技能”解析共同效果，这样同回合的效果会像平常一样合并显示
				const tmpId = Skills.length;
				Skills[tmpId] = Object.assign(Object.create(Object.getPrototypeOf(skill)), skill, { id: tmpId, type: 116, params: sim.commonIds });
				let common;
				try { common = origParser.call(this, tmpId); } finally { Skills.length = tmpId; }
				const parts = sim.diffIds.map(id => origParser.call(this, id));
				const random = attrChoice(parts) || {
					kind: SkillKinds.RandomSkills,
					skills: parts,
					params: sim.diffIds,
					mypdcInline: true,
				};
				return [...(common || []), random];
			} catch (e) {
				console.error(e);
				return origParser.apply(this, arguments);
			}
		};
	}

	if (typeof renderSkill === 'function') {
		const origRender = renderSkill;
		renderSkill = function (skill) { // eslint-disable-line no-global-assign
			if (skill?.mypdcAttrChoice) {
				const set = [...new Set(skill.attrs)].sort();
				const others = [0, 1, 2, 3, 4].filter(a => !set.includes(a));
				const who = skill.targets?.includes('enemy_all') ? '敌方全体' : '敌人';
				const what = others.length === 1
					? `${ATTR_TEXT[others[0]]}以外的属性（${set.map(a => ATTR_TEXT[a]).join('、')}随机一种）`
					: `${set.map(a => ATTR_TEXT[a]).join('、')}中随机一种属性`;
				return document.createTextNode(`${skill.turns} 回合内，将${who}变为${what}`);
			}
			if (!skill?.mypdcInline) return origRender.apply(this, arguments);
			const frg = document.createDocumentFragment();
			frg.append('随机发动以下其中一种：');
			const ul = el('ul', { class: 'mypdc-random-inline' });
			skill.skills.forEach(sub => ul.append(el('li', null, renderSkillEntry(sub))));
			frg.append(ul);
			return frg;
		};
	}

	// ---------- 2) 技能说明图标开关 ----------
	const state = { icons: !!load('skill-icons', false) };
	function apply() { document.body.classList.toggle('mypdc-skill-icons', state.icons); }
	window.addEventListener('load', () => setTimeout(() => {
		apply();
		const panel = document.querySelector('.mypdc-sort-cfg');
		if (!panel || panel.querySelector('.mypdc-icons-toggle')) return;
		const row = el('div', { class: 'mypdc-row' },
			el('span', { class: 'mypdc-label' }, '宠物详情：'),
			el('label', { class: 'mypdc-icons-toggle' },
				el('input', { type: 'checkbox', checked: state.icons, onchange: e => { state.icons = e.target.checked; save('skill-icons', state.icons); apply(); } }),
				' 技能说明显示图标'));
		panel.querySelector('.mypdc-hint')?.before(row);
	}));

	MyPDC.detail = { similarRandom };
})();
