'use strict';
// 我的 PDC：减伤模拟 + 关卡库
(function () {
	const { el, load, save, leaderIds, cardName, fmt, ATTR_NAMES } = MyPDC;

	const TYPES = {
		normal: '普通攻击',
		fixed: '无视减伤',
		gravity: '重力(当前HP%)',
	};

	const state = Object.assign({
		key: null,          // 当前关卡：'b:<id>' 内置，'m:<id>' 我的
		teamIdx: 0,
		awokenBind: false,  // 觉醒无效
		includeProb: false, // 计入概率触发的减伤
		skillShield: 0,     // 技能减伤（全属性）%
		attrShieldAttr: -1, // 技能属性减伤：属性
		attrShieldPct: 0,   //              百分比
		startHp: 100,       // 每次攻击前的HP%
		chain: false,       // 连续承受
		heal: 0,            // 连续模式下每回合回复量
	}, load('reduce-state', {}));

	let builtin = [];
	let mine = load('dungeons', null);
	if (!Array.isArray(mine) || mine.length === 0) {
		mine = [newDungeon('我的关卡')];
		save('dungeons', mine);
	}

	function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
	function newAttack() {
		return { stage: '', enemyId: 0, skill: '', attr: 0, damage: 0, hits: 1, type: 'normal', note: '' };
	}
	function newDungeon(name) {
		return { id: uid(), name, server: '', note: '', attacks: [newAttack()] };
	}
	function saveMine() { save('dungeons', mine); }
	function saveState() { save('reduce-state', state); }

	function currentDungeon() {
		if (!state.key) return null;
		const [kind, id] = [state.key.slice(0, 1), state.key.slice(2)];
		const list = kind === 'b' ? builtin : mine;
		return list.find(d => d.id === id) || null;
	}
	function isEditable() { return state.key?.startsWith('m:'); }

	// ---------- 计算 ----------
	function badgeShield(badge) {
		if (teamsCount == 2) return null;
		if ([104, 105, 108, 110, 111].includes(badge)) {
			const r = new ShieldReduce(0.05);
			return r;
		}
		return null;
	}

	function teamShields(teamIdx) {
		const team = formation.teams[teamIdx];
		if (!team) return [];
		const [l1, l2] = leaderIds(teamIdx);
		const list = [...getReduceScales(l1), ...getReduceScales(l2)];
		const b = badgeShield(team[2]);
		if (b) list.push(b);
		if (!state.awokenBind) list.push(...getAttrShieldAwokenReduceScales(team));
		return list.filter(s => s && s.scale > 0 && s.attrs);
	}

	function shieldActive(s, attr, hpPct) {
		if (!((s.attrs >> attr) & 1)) return false;
		if (s.probability < 1 && !state.includeProb) return false;
		const { min, max } = s.hp;
		if (min === 99 && max === 100) return hpPct >= 100;
		return hpPct >= min && hpPct <= max;
	}

	function reduceAt(shields, attr, hpPct) {
		let keep = 1;
		shields.forEach(s => { if (shieldActive(s, attr, hpPct)) keep *= 1 - s.scale; });
		keep *= 1 - Math.min(100, state.skillShield || 0) / 100;
		if (state.attrShieldAttr === attr) keep *= 1 - Math.min(100, state.attrShieldPct || 0) / 100;
		return 1 - keep;
	}

	function teamInfo() {
		if (teamsCount === 2) { // 2人协力：共用血量，减伤只算双方队长技（与上游一致）
			const fs = MyPDC.formationStats;
			if (!fs.tHP) return null;
			const teams = formation.teams;
			const l1 = teams[0][0][teams[0][3] || 0]?.id ?? 0;
			const l2 = teams[1][0][teams[1][3] || 0]?.id ?? 0;
			const shields = [...getReduceScales(l1), ...getReduceScales(l2)].filter(s => s && s.scale > 0 && s.attrs);
			return { ti: 0, maxHp: state.awokenBind ? fs.tHPNoAwoken : fs.tHP, shields, leaders: [l1, l2] };
		}
		const ti = Math.min(state.teamIdx, (formation?.teams?.length || 1) - 1);
		const stats = MyPDC.teamStats[ti];
		if (!stats || !stats.tHP) return null;
		const maxHp = state.awokenBind ? stats.tHPNoAwoken : stats.tHP;
		return { ti, maxHp, shields: teamShields(ti), leaders: leaderIds(ti) };
	}

	function simulate(info, attacks) {
		const { maxHp, shields } = info;
		let cur = maxHp;
		let dead = false;
		return attacks.map(atk => {
			if (state.chain && dead) return { skipped: true };
			const start = state.chain ? cur : Math.floor(maxHp * state.startHp / 100);
			let hp = start;
			let total = 0;
			const used = new Set();
			const hits = Math.max(1, atk.hits | 0);
			const D = Math.max(0, Number(atk.damage) || 0);
			for (let i = 0; i < hits && hp > 0; i++) {
				let dmg;
				if (atk.type === 'fixed') dmg = D;
				else if (atk.type === 'gravity') dmg = Math.floor(hp * D / 100);
				else {
					const r = reduceAt(shields, atk.attr, hp / maxHp * 100);
					used.add(Math.round(r * 10000) / 100);
					dmg = Math.ceil(D * (1 - r));
				}
				hp -= dmg;
				total += dmg;
			}
			const survived = hp > 0;
			let required = null;
			if (atk.type === 'normal' && D > 0) {
				required = Math.max(0, 1 - (start - 1) / (D * hits));
			}
			if (state.chain) {
				if (survived) cur = Math.min(maxHp, hp + (Number(state.heal) || 0));
				else dead = true;
			}
			return { start, total, remain: hp, survived, reductions: [...used], required };
		});
	}

	// ---------- 界面 ----------
	let panel, body;

	let renderTimer = null;
	// 延迟到事件结束后再重绘，并恢复焦点（方便用 Tab 连续录入）
	function render() {
		if (renderTimer) return;
		renderTimer = setTimeout(() => {
			renderTimer = null;
			if (!panel || panel.classList.contains('display-none')) return;
			const focusKey = document.activeElement?.closest?.('.mypdc-panel') ? focusKeyOf(document.activeElement) : null;
			const scroll = body.scrollTop;
			body.innerHTML = '';
			body.append(renderTeamBox(), renderDungeonBar(), renderAttackTable());
			body.scrollTop = scroll;
			if (focusKey) {
				const target = [...body.querySelectorAll('input,select,textarea,button')].find(n => focusKeyOf(n) === focusKey);
				target?.focus();
			}
		});
	}
	function focusKeyOf(node) {
		const row = node.closest('tr');
		const cell = node.closest('td,label,div');
		const rows = row ? [...row.parentElement.children].indexOf(row) : -1;
		const cells = cell?.parentElement ? [...cell.parentElement.children].indexOf(cell) : -1;
		return `${node.closest('.mypdc-box') ? [...body.children].indexOf(node.closest('.mypdc-box')) : -1}:${rows}:${cells}:${node.tagName}`;
	}

	function numInput(value, onchange, attrs = {}) {
		return el('input', Object.assign({ type: 'number', value, onchange: e => onchange(Number(e.target.value) || 0) }, attrs));
	}

	function renderTeamBox() {
		const n = formation?.teams?.length || 1;
		const info = teamInfo();
		const box = el('div', { class: 'mypdc-box' });

		const set = (k, v) => { state[k] = v; saveState(); render(); };
		const opts = el('div', { class: 'mypdc-row' },
			n > 1 && teamsCount !== 2 ? el('label', null, '队伍 ', el('select', { onchange: e => set('teamIdx', +e.target.value) },
				Array.from({ length: n }, (_, i) => el('option', { value: i, selected: state.teamIdx === i }, `队伍${i + 1}`)))) : null,
			el('label', null, el('input', { type: 'checkbox', checked: state.awokenBind, onchange: e => set('awokenBind', e.target.checked) }), ' 觉醒无效'),
			el('label', { title: '例如“50%几率减伤”的队长技' }, el('input', { type: 'checkbox', checked: state.includeProb, onchange: e => set('includeProb', e.target.checked) }), ' 计入概率减伤'),
			el('label', null, '技能减伤 ', numInput(state.skillShield, v => set('skillShield', v), { min: 0, max: 100, style: 'width:4em' }), '%'),
			el('label', null, '属性减伤 ',
				el('select', { onchange: e => set('attrShieldAttr', +e.target.value) },
					el('option', { value: -1 }, '无'),
					ATTR_NAMES.map((a, i) => el('option', { value: i, selected: state.attrShieldAttr === i }, a))),
				numInput(state.attrShieldPct, v => set('attrShieldPct', v), { min: 0, max: 100, style: 'width:4em' }), '%'),
		);
		const opts2 = el('div', { class: 'mypdc-row' },
			el('label', null, el('input', { type: 'checkbox', checked: state.chain, onchange: e => set('chain', e.target.checked) }), ' 连续承受（按顺序扣血）'),
			state.chain
				? el('label', null, '每回合回复 ', numInput(state.heal, v => set('heal', v), { min: 0, step: 1000, style: 'width:7em' }))
				: el('label', null, '每次攻击前HP ', numInput(state.startHp, v => set('startHp', Math.min(100, Math.max(1, v))), { min: 1, max: 100, style: 'width:4em' }), '%'),
		);
		box.append(opts, opts2);

		if (!info) {
			box.append(el('div', { class: 'mypdc-warn' }, '还没有队伍数据：请先在页面上编好队伍（并确认“显示队伍合计信息”已开启）。'));
			return box;
		}
		const [l1, l2] = info.leaders;
		box.append(el('div', { class: 'mypdc-row mypdc-summary' },
			el('span', null, `${teamsCount === 2 ? '两队合计' : ''}HP：${fmt(info.maxHp)}`),
			el('span', null, `队长：${cardName(l1) || '-'} ／ ${cardName(l2) || '-'}`),
		));
		// 各属性满血 / 50%血时的减伤和单击承受上限
		const table = el('table', { class: 'mypdc-table mypdc-attr-table' },
			el('tr', null, el('th', null, '属性'), el('th', null, '满血减伤'), el('th', null, '满血可承受单击'), el('th', null, 'HP50%减伤'), el('th', null, 'HP50%可承受')));
		ATTR_NAMES.forEach((name, attr) => {
			const r100 = reduceAt(info.shields, attr, 100);
			const r50 = reduceAt(info.shields, attr, 50);
			const half = Math.floor(info.maxHp / 2);
			table.append(el('tr', null,
				el('td', { class: `mypdc-attr mypdc-attr-${attr}` }, name),
				el('td', null, (r100 * 100).toFixed(2) + '%'),
				el('td', null, r100 >= 1 ? '∞' : fmt(Math.floor((info.maxHp - 1) / (1 - r100)))),
				el('td', null, (r50 * 100).toFixed(2) + '%'),
				el('td', null, r50 >= 1 ? '∞' : fmt(Math.floor((half - 1) / (1 - r50)))),
			));
		});
		box.append(el('div', { class: 'mypdc-table-wrap' }, table));
		return box;
	}

	function renderDungeonBar() {
		const sel = el('select', { onchange: e => { state.key = e.target.value || null; saveState(); render(); } },
			el('option', { value: '' }, '— 选择关卡 —'),
			builtin.length ? el('optgroup', { label: '内置关卡' }, builtin.map(d => el('option', { value: 'b:' + d.id, selected: state.key === 'b:' + d.id }, d.name))) : null,
			el('optgroup', { label: '我的关卡' }, mine.map(d => el('option', { value: 'm:' + d.id, selected: state.key === 'm:' + d.id }, d.name))),
		);
		const d = currentDungeon();
		const btn = (text, fn, attrs) => el('button', Object.assign({ type: 'button', onclick: fn }, attrs), text);

		const bar = el('div', { class: 'mypdc-row mypdc-dungeon-bar' }, '关卡 ', sel,
			btn('新建', () => {
				const name = prompt('关卡名称', '新关卡');
				if (!name) return;
				const nd = newDungeon(name);
				mine.push(nd); saveMine();
				state.key = 'm:' + nd.id; saveState(); render();
			}),
			d ? btn(isEditable() ? '复制' : '复制到我的关卡', () => {
				const copy = JSON.parse(JSON.stringify(d));
				copy.id = uid();
				copy.name = d.name + (isEditable() ? ' 副本' : '');
				mine.push(copy); saveMine();
				state.key = 'm:' + copy.id; saveState(); render();
			}) : null,
			d && isEditable() ? btn('改名', () => {
				const name = prompt('关卡名称', d.name);
				if (!name) return;
				d.name = name; saveMine(); render();
			}) : null,
			d && isEditable() ? btn('删除', () => {
				if (!confirm(`删除关卡“${d.name}”？`)) return;
				mine = mine.filter(x => x !== d); saveMine();
				state.key = null; saveState(); render();
			}) : null,
			btn('导出', () => exportJson(d ? [d] : mine, d ? d.name : '我的关卡')),
			btn('导入', importJson),
		);
		if (d) {
			const note = el('textarea', { class: 'mypdc-note', rows: 1, placeholder: '备注（例如：关卡链接、打法要点）', disabled: !isEditable(), onchange: e => { d.note = e.target.value; saveMine(); } });
			note.value = d.note || '';
			return el('div', { class: 'mypdc-box' }, bar, note);
		}
		return el('div', { class: 'mypdc-box' }, bar);
	}

	function renderAttackTable() {
		const d = currentDungeon();
		const box = el('div', { class: 'mypdc-box' });
		if (!d) {
			box.append(el('div', { class: 'mypdc-hint' }, '选择或新建一个关卡，然后逐条录入敌人的攻击（属性、单段伤害、段数）。'));
			return box;
		}
		const info = teamInfo();
		const results = info ? simulate(info, d.attacks) : [];
		const editable = isEditable();
		const change = (atk, key, cast) => e => {
			atk[key] = cast(e.target);
			saveMine();
			render();
		};
		const str = t => t.value;
		const int = t => Math.max(0, parseInt(t.value, 10) || 0);
		const num = t => Math.max(0, Number(t.value) || 0);

		const HEADERS = ['层/敌人', '敌人ID', '技能', '属性', '伤害(单段)', '段数', '类型', '减伤', '总伤害', '剩余HP', '结果', '所需减伤', ''];
		const table = el('table', { class: 'mypdc-table mypdc-attack-table' },
			el('tr', null, HEADERS.map(h => el('th', null, h))));

		d.attacks.forEach((atk, i) => {
			const r = results[i];
			const dis = !editable;
			const enemyName = atk.enemyId ? cardName(atk.enemyId) : '';
			let resultCell, remainCell = '-', totalCell = '-', reduceCell = '-', requiredCell = '-';
			if (!r) resultCell = el('td', null, '-');
			else if (r.skipped) resultCell = el('td', { class: 'mypdc-dead' }, '前面已阵亡');
			else {
				resultCell = el('td', { class: r.survived ? 'mypdc-ok' : 'mypdc-dead' }, r.survived ? '✓ 存活' : '✗ 阵亡');
				remainCell = r.survived ? `${fmt(r.remain)} (${(r.remain / info.maxHp * 100).toFixed(1)}%)` : `差 ${fmt(1 - r.remain)}`;
				totalCell = fmt(r.total);
				reduceCell = atk.type === 'normal' ? r.reductions.map(x => x + '%').join(' → ') : '-';
				requiredCell = r.required === null ? '-' : (r.required <= 0 ? '无需' : (r.required >= 1 ? '无法' : '≥' + (Math.ceil(r.required * 10000) / 100).toFixed(2) + '%'));
			}
			const row = el('tr', { class: r && !r.skipped && !r.survived ? 'mypdc-row-dead' : null },
				el('td', null, el('input', { value: atk.stage, disabled: dis, placeholder: 'B1', style: 'width:5em', onchange: change(atk, 'stage', str) })),
				el('td', null, el('input', { type: 'number', value: atk.enemyId || '', disabled: dis, min: 0, style: 'width:5em', title: enemyName,
					onchange: e => {
						atk.enemyId = int(e.target);
						const c = Cards?.[atk.enemyId];
						if (c && c.attrs[0] >= 0 && c.attrs[0] <= 4) atk.attr = c.attrs[0];
						saveMine(); render();
					} }), enemyName ? el('div', { class: 'mypdc-enemy-name' }, enemyName) : null),
				el('td', null, el('input', { value: atk.skill, disabled: dis, placeholder: '技能名', style: 'width:7em', onchange: change(atk, 'skill', str) })),
				el('td', null, el('select', { class: `mypdc-attr-sel mypdc-attr-${atk.attr}`, disabled: dis, onchange: change(atk, 'attr', int) },
					ATTR_NAMES.map((a, k) => el('option', { value: k, selected: atk.attr === k }, a)))),
				el('td', null, el('input', { type: 'number', value: atk.damage, disabled: dis, min: 0, step: 1000, style: 'width:8em', onchange: change(atk, 'damage', num) })),
				el('td', null, el('input', { type: 'number', value: atk.hits, disabled: dis, min: 1, style: 'width:3.5em', onchange: change(atk, 'hits', t => Math.max(1, int(t))) })),
				el('td', null, el('select', { disabled: dis, onchange: change(atk, 'type', str) },
					Object.entries(TYPES).map(([k, v]) => el('option', { value: k, selected: atk.type === k }, v)))),
				el('td', null, reduceCell),
				el('td', null, totalCell),
				el('td', null, remainCell),
				resultCell,
				el('td', null, requiredCell),
				el('td', null, editable ? el('button', { type: 'button', title: '删除这条', onclick: () => { d.attacks.splice(i, 1); saveMine(); render(); } }, '×') : null),
			);
			[...row.children].forEach((td, k) => td.setAttribute('data-label', HEADERS[k]));
			table.append(row);
		});
		box.append(el('div', { class: 'mypdc-table-wrap' }, table));
		if (editable) {
			box.append(el('div', { class: 'mypdc-row' },
				el('button', { type: 'button', onclick: () => { d.attacks.push(newAttack()); saveMine(); render(); } }, '+ 添加攻击'),
				d.attacks.length ? el('button', { type: 'button', onclick: () => { d.attacks.push(Object.assign({}, d.attacks[d.attacks.length - 1])); saveMine(); render(); } }, '+ 复制上一条') : null,
			));
		}
		box.append(el('div', { class: 'mypdc-hint' },
			'伤害填敌人攻击的单段数值（攻略站或游戏内看到的数字），多段攻击填段数。“所需减伤”按满足当前血量存活计算。',
			'队长技中需要消珠条件触发的减伤视为已触发；概率减伤默认不计入。伤害按向上取整计算，结果偏保守。'));
		return box;
	}

	function exportJson(list, name) {
		const blob = new Blob([JSON.stringify(list, null, '\t')], { type: 'application/json' });
		const a = el('a', { href: URL.createObjectURL(blob), download: `${name}.json` });
		document.body.append(a);
		a.click();
		setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
	}

	function importJson() {
		const input = el('input', { type: 'file', accept: '.json,application/json' });
		input.onchange = async () => {
			const file = input.files[0];
			if (!file) return;
			try {
				let data = JSON.parse(await file.text());
				if (!Array.isArray(data)) data = [data];
				let count = 0;
				data.forEach(d => {
					if (!d || !Array.isArray(d.attacks)) return;
					mine.push(Object.assign(newDungeon(d.name || '导入的关卡'), d, { id: uid() }));
					count++;
				});
				saveMine();
				alert(`已导入 ${count} 个关卡`);
				render();
			} catch (e) {
				alert('导入失败：文件不是有效的关卡 JSON');
			}
		};
		input.click();
	}

	function buildPanel() {
		const openBtn = el('button', { type: 'button', class: 'mypdc-open-btn', onclick: () => {
			panel.classList.remove('display-none');
			document.body.classList.add('mypdc-panel-open');
			render();
		} }, '🛡 减伤模拟');
		panel = el('div', { class: 'mypdc-panel display-none' },
			el('div', { class: 'mypdc-panel-head' },
				el('h2', null, '减伤模拟'),
				el('button', { type: 'button', class: 'mypdc-close', onclick: () => {
					panel.classList.add('display-none');
					document.body.classList.remove('mypdc-panel-open');
				} }, '关闭')),
		);
		body = el('div', { class: 'mypdc-panel-body' });
		panel.append(body);
		document.body.append(panel);
		// 固定放在队伍标题右边（不再悬浮在右下角）
		const titleBox = document.querySelector('.formation-box .title-box');
		if (titleBox) { openBtn.classList.add('mypdc-open-inline'); titleBox.append(openBtn); }
		else document.body.append(openBtn);

		MyPDC.onTeamUpdate(() => render());

		fetch('mypdc-dungeons.json', { cache: 'no-cache' })
			.then(r => r.ok ? r.json() : [])
			.then(list => { builtin = Array.isArray(list) ? list : []; render(); })
			.catch(() => {});
	}

	window.addEventListener('load', buildPanel);
	MyPDC.reduce = { state, simulate, reduceAt, teamInfo, render };
})();
