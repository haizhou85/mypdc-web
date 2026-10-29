'use strict';
// 我的 PDC：关卡伤害 —— 关卡数据存在服务器上（所有人可看，管理员可编辑），
// 按当前队伍（HP、队长技/徽章/觉醒/潜觉减伤、开技）计算每个技能的承受伤害和还差几个属性减伤潜觉。
(function () {
	const API = (window.MYPDC_API || '').replace(/\/+$/, '');
	const { el, load, save, leaderIds, cardName, fmt } = MyPDC;
	const ATTR = ['火', '水', '木', '光', '暗'];
	const TYPES = { normal: '普通', fixed: '无视减伤', gravity: '重力(当前HP%)' };
	// 技能附带效果的提示标签
	const TAGS = [
		['awokenBind', '封觉醒', 'red'], ['skillBind', '封技能', 'red'], ['assistBind', '封辅助', 'red'], ['leaderBind', '封队长', 'red'],
		['unmatchable', '封珠', 'purple'], ['lock', '锁珠', 'purple'], ['blind', '暗珠', 'purple'], ['jammer', '废珠', 'purple'],
		['poison', '毒珠', 'purple'], ['mortal', '猛毒', 'purple'], ['bomb', '炸弹', 'purple'], ['cloud', '云', 'purple'], ['tape', '封列', 'purple'],
		['roulette', '轮盘', 'purple'], ['board', '变板', 'purple'], ['noSkyfall', '天降减少', 'purple'],
		['timeDown', '减秒', 'orange'], ['rcvDown', '减回复', 'orange'], ['atkDown', '减攻击', 'orange'], ['leaderSwap', '换队长', 'orange'],
		['attrAbsorb', '属性吸收', 'blue'], ['comboAbsorb', '吸C', 'blue'], ['damageAbsorb', '伤害吸收', 'blue'], ['damageVoid', '伤害无效', 'blue'],
		['defUp', '加防', 'blue'], ['resolve', '根性', 'blue'], ['statusVoid', '状态无效', 'blue'], ['enrage', '攻击UP', 'blue'],
	];
	const TAG = Object.fromEntries(TAGS.map(t => [t[0], t]));
	// 属性减伤潜觉：普通 1%（id 6~10）、+版 2.5%（id 32~36）
	const LATENT = [[6, 7, 8, 9, 10], [32, 33, 34, 35, 36]];

	const state = Object.assign({ id: 0, teamIdx: 0, awokenBind: false, includeProb: false, startHp: 100, brokens: 0 }, load('dungeon-state', {}));
	const saveState = () => save('dungeon-state', Object.assign({}, state, { brokens: 0 }));

	let list = null;        // 关卡列表
	let cur = null;         // 当前关卡（完整数据）
	let editing = null;     // 编辑中的副本（管理员）
	let isAdmin = false;
	let panel, body, msg = '';

	async function api(path, opts = {}) {
		const headers = {};
		if (opts.body) headers['Content-Type'] = 'application/json';
		if (opts.admin) headers['X-Admin-Key'] = load('admin-key', '');
		const res = await fetch(API + path, { method: opts.method || 'GET', cache: 'no-store', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
		let data = null;
		try { data = await res.json(); } catch (e) { /* 空 */ }
		if (!res.ok) throw new Error(data?.error || `请求失败（${res.status}）`);
		return data;
	}

	// ---------- 队伍和减伤 ----------
	function badgeShield(badge) {
		if (teamsCount == 2 || ![104, 105, 108, 110, 111].includes(badge)) return null;
		return new ShieldReduce(0.05);
	}
	// 每个属性的觉醒 + 潜觉减伤（上游合在一起算，最多 100%）
	function attrShieldSum(team, attr) {
		if (!team || state.awokenBind) return 0;
		const s = getAttrShieldAwokenReduceScales(team).find(x => (x.attrs >> attr) & 1);
		return s ? s.scale : 0;
	}
	// 心L（L盾觉醒 59）：拉出心L时，每个觉醒减伤 5%
	function heartLCount(team) {
		if (state.awokenBind || typeof awokenCountInTeam !== 'function') return 0;
		try {
			return team ? awokenCountInTeam(team, 59, solo, teamsCount)
				: (formation?.teams || []).reduce((a, t) => a + awokenCountInTeam(t, 59, solo, teamsCount), 0);
		} catch (e) { return 0; }
	}
	// 熟成：按层数（5F 起 ×1.5、10F 起 ×2）重新计算队伍 HP，返回相对当前页面设置的倍率 [正常, 觉醒无效]
	function floorStage(fl) {
		if (fl.stage > 0) return fl.stage;
		const m = String(fl.name || '').match(/(\d+)\s*F/i);
		if (m) return +m[1];
		return /boss/i.test(fl.name || '') ? 99 : 1;
	}
	let stageCache = new Map();
	function stageRatio(ti, stage) {
		if (teamsCount === 2 || typeof countTeamHp !== 'function') return [1, 1];
		const brokens = state.brokens || 0;
		const benefit = cur?.data?.benefit || 0; // 阴阳加护：1 阳、2 阴（关卡资料里设定）
		const key = ti + ':' + stage + ':' + brokens + ':' + benefit;
		if (stageCache.has(key)) return stageCache.get(key);
		let res = [1, 1];
		const team = formation.teams[ti];
		const dge = formation.dungeonEnchance;
		const run = () => {
		if (team && dge) {
				const [l1, l2] = leaderIds(ti);
				const sum = (t, noAw) => countTeamHp(t, l1, l2, solo, noAw).reduce((a, b) => a + b, 0);
				const saved = dge.stage, savedB = dge.brokens, savedG = dge.benefit;
				try {
					dge.stage = stage;
					dge.benefit = benefit;
					dge.brokens = brokens; // 部位破坏数（面板里选择）
					const members = team[0].map((m, i) => {
						if (!m || !(m.id > 0)) return m;
						const ab = calculateAbility(m, team[1][i], solo, teamsCount);
						if (!ab) return m;
						const c = Object.assign(Object.create(Object.getPrototypeOf(m)), m);
						c.ability = ab.map(a => a[0]);
						c.abilityNoAwoken = ab.map(a => a[1]);
						return c;
					});
					const t2 = [members, ...team.slice(1)];
					dge.stage = saved; dge.brokens = savedB; dge.benefit = savedG;
					const b0 = sum(team, false), b1 = sum(team, true);
					res = [b0 > 0 ? sum(t2, false) / b0 : 1, b1 > 0 ? sum(t2, true) / b1 : 1];
				} catch (e) { console.error(e); } finally { dge.stage = saved; dge.brokens = savedB; dge.benefit = savedG; }
			}
		};
		if (MyPDC.skillUse?.withAttr) MyPDC.skillUse.withAttr(run); else run();
		stageCache.set(key, res);
		return res;
	}

	function teamInfo(stage) {
		const use = MyPDC.skillUse?.current?.(teamsCount === 2 ? 0 : state.teamIdx) || { shield: null, hpMul: 1 };
		if (teamsCount === 2) {
			const fs = MyPDC.formationStats;
			if (!fs.tHP) return null;
			const teams = formation.teams;
			const l1 = teams[0][0][teams[0][3] || 0]?.id ?? 0;
			const l2 = teams[1][0][teams[1][3] || 0]?.id ?? 0;
			const shields = [...getReduceScales(l1), ...getReduceScales(l2)].filter(s => s && s.scale > 0 && s.attrs);
			return { maxHp: Math.round((state.awokenBind ? fs.tHPNoAwoken : fs.tHP) * use.hpMul), shields, team: null, use };
		}
		const ti = Math.min(state.teamIdx, (formation?.teams?.length || 1) - 1);
		const stats = MyPDC.teamStats[ti];
		if (!stats || !stats.tHP) return null;
		const team = formation.teams[ti];
		const [l1, l2] = leaderIds(ti);
		const shields = [...getReduceScales(l1), ...getReduceScales(l2), badgeShield(team[2])].filter(s => s && s.scale > 0 && s.attrs);
		const ratio = stage ? stageRatio(ti, stage)[state.awokenBind ? 1 : 0] : 1;
		const base = state.awokenBind ? stats.tHPNoAwoken : stats.tHP;
		return { maxHp: Math.round(base * ratio * use.hpMul), shields, team, use, stage };
	}
	function keepAt(info, attr, hpPct, extraAttr) {
		let keep = 1;
		info.shields.forEach(s => {
			if (!((s.attrs >> attr) & 1)) return;
			if (s.probability < 1 && !state.includeProb) return;
			const { min, max } = s.hp;
			const on = (min === 99 && max === 100) ? hpPct >= 100 : hpPct >= min && hpPct <= max;
			if (on) keep *= 1 - s.scale;
		});
		keep *= 1 - Math.min(1, attrShieldSum(info.team, attr) + (extraAttr || 0));
		if (state.heartL) keep *= 1 - Math.min(1, 0.05 * heartLCount(info.team));
		const sk = info.use.shield;
		if (sk && (sk.mask >> attr) & 1 && (sk.prob >= 1 || state.includeProb)) keep *= 1 - sk.rate;
		return keep;
	}
	// 承受一个技能：返回 { taken, remain, survived }
	function hit(info, skill, attr, extraAttr) {
		const start = Math.floor(info.maxHp * state.startHp / 100);
		let hp = start, taken = 0;
		const hits = Math.max(1, skill.hits | 0);
		const total = Math.max(0, Number(skill.damage) || 0);
		const per = total / hits;
		for (let i = 0; i < hits && hp > 0; i++) {
			let d;
			if (skill.type === 'fixed') d = Math.floor(per);
			else if (skill.type === 'gravity') d = Math.floor(hp * total / 100);
			else d = Math.ceil(per * keepAt(info, attr, hp / info.maxHp * 100, extraAttr));
			hp -= d; taken += d;
		}
		return { taken, remain: hp, survived: hp > 0, start };
	}
	// 还要几个属性减伤潜觉才扛得住：[普通 1%, +版 2.5%]
	function latentNeed(info, skill, attr) {
		if (skill.type !== 'normal' || !(skill.damage > 0)) return null;
		if (hit(info, skill, attr, 0).survived) return [0, 0];
		return [0.01, 0.025].map(step => {
			for (let n = 1; n <= 100; n++) if (hit(info, skill, attr, n * step).survived) return n;
			return null;
		});
	}

	// ---------- 界面 ----------
	function headIcon(id, attr) {
		const wrap = el('span', { class: 'mypdc-dg-head' });
		if (id > 0 && typeof createCardA === 'function') {
			const dom = createCardA({ noBoxCount: true });
			dom.removeAttribute('href');
			dom.onclick = e => e.preventDefault();
			try { changeid({ id }, dom); } catch (e) { /* 没有这只 */ }
			wrap.append(dom);
		} else wrap.append(el('span', { class: `mypdc-dg-noicon mypdc-attr-${attr ?? 0}` }, ATTR[attr ?? 0] || '?'));
		return wrap;
	}
	function latentIcon(id) {
		return el('span', { class: 'mypdc-dg-latent' }, el('span', { class: 'latent-icon', 'data-latent-icon': id }));
	}
	const skillAttr = (sk, en) => (sk.attr >= 0 ? sk.attr : (en.attr ?? 0));

	let renderTimer = null;
	function render() {
		if (renderTimer) return;
		renderTimer = setTimeout(() => {
			renderTimer = null;
			if (!panel || panel.classList.contains('display-none')) return;
			const scroll = body.scrollTop;
			stageCache = new Map();
			body.innerHTML = '';
			body.append(renderBar());
			if (msg) body.append(el('div', { class: 'mypdc-team-msg' }, msg));
			if (editing) body.append(renderEditor());
			else {
				body.append(renderTeam());
				if (cur) body.append(renderDungeon(cur.data || {}));
			}
			body.scrollTop = scroll;
		});
	}

	function renderBar() {
		const sel = el('select', { class: 'mypdc-dg-select', onchange: e => openDungeon(+e.target.value) },
			el('option', { value: 0 }, list ? (list.length ? '— 选择关卡 —' : '还没有关卡') : '读取中…'),
			(list || []).map(d => el('option', { value: d.id, selected: d.id === state.id }, d.name)));
		const bar = el('div', { class: 'mypdc-row mypdc-dg-bar' }, sel);
		if (isAdmin && !editing) {
			bar.append(
				el('button', { type: 'button', onclick: () => { editing = { id: 0, name: '新关卡', server: 'ja', data: { note: '', floors: [newFloor()] } }; render(); } }, '＋新建'),
				cur ? el('button', { type: 'button', onclick: () => { editing = JSON.parse(JSON.stringify(cur)); render(); } }, '✏️ 编辑') : null);
		}
		return bar;
	}

	function renderTeam() {
		const info = teamInfo(1);
		const box = el('div', { class: 'mypdc-box mypdc-dg-team' });
		const set = (k, v) => { state[k] = v; saveState(); render(); };
		const n = formation?.teams?.length || 1;
		const toggle = (key, text, title) => el('label', { title },
			el('input', { type: 'checkbox', checked: state[key], onchange: e => set(key, e.target.checked) }), ' ' + text);
		box.append(el('div', { class: 'mypdc-row' },
			n > 1 && teamsCount !== 2 ? el('label', null, '队伍 ', el('select', { onchange: e => set('teamIdx', +e.target.value) },
				Array.from({ length: n }, (_, i) => el('option', { value: i, selected: state.teamIdx === i }, `队伍${i + 1}`)))) : null,
			toggle('awokenBind', '觉醒无效'),
			toggle('includeProb', '计入概率减伤', '例如“50%几率减伤”的队长技、概率盾'),
			el('label', { title: '拉出一个心L：每个 L盾觉醒减伤 5%' }, el('input', { type: 'checkbox', checked: !!state.heartL, onchange: e => set('heartL', e.target.checked) }),
				` 心L减伤（${heartLCount(teamsCount === 2 ? null : formation?.teams?.[Math.min(state.teamIdx, (formation?.teams?.length || 1) - 1)])}个）`),
			el('label', null, '受击前HP ', el('input', { type: 'number', min: 1, max: 100, value: state.startHp, style: 'width:3.5em',
				onchange: e => set('startHp', Math.min(100, Math.max(1, +e.target.value || 100))) }), '%')));
		if (!info) {
			box.append(el('div', null, '请先在页面上编好队伍。'));
			return box;
		}
		// 开技：盾 / HP上限（和编队上方的选择同步）
		const su = MyPDC.skillUse;
		const ti = teamsCount === 2 ? 0 : Math.min(state.teamIdx, (formation?.teams?.length || 1) - 1);
		const st = MyPDC.teamStats[ti];
		if (su?.teamSkills && st?.team) {
			const skills = su.teamSkills(st.team);
			const pick = su.getPick(ti);
			const sel = (kind, label, list) => el('label', { class: 'mypdc-dg-skillpick' }, label,
				el('select', { disabled: !list.length, onchange: e => { su.setPick(ti, kind, e.target.value); render(); } },
					el('option', { value: '' }, list.length ? '不开技' : '（队伍里没有）'),
					list.map(s => el('option', { value: s.key, selected: s.key === pick[kind] }, s.text))));
			box.append(el('div', { class: 'mypdc-row mypdc-dg-skills-row' },
				sel('shield', '🛡 盾 ', skills.shield), sel('hp', '❤ HP上限 ', skills.hp), sel('attr', '🎨 变属性 ', skills.attr || []),
				el('label', { title: '部位破坏觉醒：每破坏 1 个部位，HP 等 ×1.2' }, '部位破坏 ',
					el('select', { onchange: e => { state.brokens = +e.target.value; render(); } },
						Array.from({ length: 11 }, (_, i) => el('option', { value: i, selected: (state.brokens || 0) === i }, String(i))))), ' 个'));
		}
		box.append(el('div', { class: 'mypdc-row mypdc-dg-hp' },
			el('b', null, `HP ${fmt(info.maxHp)}`),
			el('span', { class: 'mypdc-dg-attrs' }, ATTR.map((a, i) => el('span', { class: `mypdc-attr-${i}` },
				`${a}${+((1 - keepAt(info, i, state.startHp, 0)) * 100).toFixed(1)}%`)))));
		return box;
	}

	function renderDungeon(data) {
		const base = teamInfo(1);
		const wrap = el('div', { class: 'mypdc-dg' });
		if (data.benefit) wrap.append(el('div', { class: 'mypdc-dg-benefit' },
			el('span', { class: 'awoken-icon', 'data-awoken-icon': data.benefit === 2 ? 129 : 128 }),
			data.benefit === 2 ? '陰の加護（阴之加护）' : '陽の加護（阳之加护）', el('span', { class: 'mypdc-dg-skill-note' }, '有这个觉醒的队员 HP ×2，已计入')));
		if (cur?.data?.note) wrap.append(el('div', { class: 'mypdc-dg-note' }, cur.data.note));
		(data.floors || []).forEach(fl => (fl.enemies || []).forEach(en => {
			const info = teamInfo(floorStage(fl));
			// 这一层的队伍 HP（含熟成、开技 HP 上限、受击前 HP%）
			const start = info ? Math.floor(info.maxHp * state.startHp / 100) : 0;
			const stageHp = info ? el('span', { class: 'mypdc-dg-stagehp' },
				(base && info.maxHp !== base.maxHp ? '熟成' : '') + `HP ${fmt(start)}`) : null;
			wrap.append(el('div', { class: 'mypdc-dg-enemy-title' }, el('span', null, `(${fl.name || '-'}) ${en.name || cardName(en.cardId) || '敌人'}`), stageHp));
			const rows = el('div', { class: 'mypdc-dg-skills' });
			(en.skills || []).forEach(sk => {
				const attr = skillAttr(sk, en);
				const r = info ? hit(info, sk, attr, 0) : null;
				const need = info ? latentNeed(info, sk, attr) : null;
				const dmgText = sk.type === 'gravity' ? `重力 ${sk.damage}%` : fmt(sk.damage) + (sk.hits > 1 ? ` (${sk.hits}段)` : '');
				rows.append(el('div', { class: 'mypdc-dg-skill' + (sk.pre ? ' mypdc-dg-pre' : '') },
					el('div', { class: 'mypdc-dg-skill-name' },
						sk.name || '技能', sk.pre ? el('span', { class: 'mypdc-dg-pretag' }, '先制') : null,
						sk.type === 'fixed' ? el('span', { class: 'mypdc-dg-tag mypdc-dg-tag-red' }, '无视减伤') : null,
						(sk.tags || []).map(t => TAG[t] ? el('span', { class: `mypdc-dg-tag mypdc-dg-tag-${TAG[t][2]}` }, TAG[t][1]) : null),
						sk.note ? el('span', { class: 'mypdc-dg-skill-note' }, sk.note) : null),
					el('div', { class: 'mypdc-dg-skill-row' },
						el('span', { class: `mypdc-dg-raw mypdc-attr-${attr}` }, ATTR[attr] + ' ' + dmgText),
						need ? el('span', { class: 'mypdc-dg-need', title: '还差几个属性减伤潜觉（1% / 2.5%）才扛得住' },
							latentIcon(LATENT[0][attr]), `×${need[0] ?? '-'}`, latentIcon(LATENT[1][attr]), `×${need[1] ?? '-'}`) : el('span', { class: 'mypdc-dg-need' }),
						r ? el('span', { class: 'mypdc-dg-taken ' + (r.survived ? 'ok' : 'dead'), title: r.survived ? `剩余 ${fmt(r.remain)}` : '扛不住' }, fmt(r.taken),
							el('span', { class: 'mypdc-dg-diff' }, r.survived ? `剩 ${fmt(r.remain)}` : `差 ${fmt(r.taken - r.start + 1)}`)) : null)));
			});
			wrap.append(el('div', { class: 'mypdc-dg-enemy' }, headIcon(en.cardId, en.attr), rows));
		}));
		if (!(data.floors || []).some(f => (f.enemies || []).length)) wrap.append(el('p', null, '这个关卡还没有录入敌人。'));
		return wrap;
	}

	// ---------- 管理员编辑 ----------
	function newSkill() { return { name: '', pre: false, damage: 0, hits: 1, attr: -1, type: 'normal', tags: [], note: '' }; }
	function newEnemy() { return { name: '', cardId: 0, attr: 0, skills: [newSkill()] }; }
	function newFloor() { return { name: '1F', enemies: [newEnemy()] }; }

	function renderEditor() {
		const d = editing;
		const data = d.data = d.data || { floors: [] };
		data.floors = data.floors || [];
		const box = el('div', { class: 'mypdc-dg-edit' });
		const inp = (obj, key, attrs = {}) => el('input', Object.assign({ type: 'text', value: obj[key] ?? '', oninput: e => { obj[key] = attrs.type === 'number' ? +e.target.value || 0 : e.target.value; } }, attrs));
		const btn = (text, fn, cls) => el('button', { type: 'button', class: cls, onclick: () => { fn(); render(); } }, text);
		const move = (arr, i, d2) => { const j = i + d2; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
		const attrSel = (obj, key, follow) => el('select', { onchange: e => { obj[key] = +e.target.value; render(); } },
			follow ? el('option', { value: -1, selected: obj[key] < 0 }, '跟随敌人') : null,
			ATTR.map((a, i) => el('option', { value: i, selected: obj[key] === i }, a)));

		box.append(el('div', { class: 'mypdc-row' },
			el('label', null, '关卡名 ', inp(d, 'name', { style: 'width:16em' })),
			el('label', null, '服务器 ', el('select', { onchange: e => { d.server = e.target.value; } },
				[['ja', '日服'], ['en', '美服'], ['ko', '韩服']].map(([v, t]) => el('option', { value: v, selected: d.server === v }, t)))),
			el('label', null, '加护 ', el('select', { onchange: e => { data.benefit = +e.target.value || 0; } },
				[[0, '无'], [1, '陽の加護'], [2, '陰の加護']].map(([v, t]) => el('option', { value: v, selected: (data.benefit || 0) === v }, t))))),
			el('label', { class: 'mypdc-dg-field' }, '关卡说明 ', el('textarea', { rows: 2, oninput: e => { data.note = e.target.value; } }, data.note || '')));

		data.floors.forEach((fl, fi) => {
			const fbox = el('div', { class: 'mypdc-dg-edit-floor' },
				el('div', { class: 'mypdc-row' },
					el('label', null, '层 ', inp(fl, 'name', { style: 'width:6em', placeholder: '1F / 乱入' })),
					el('label', { title: '计算熟成用的层数；不填时按名称里的数字（BOSS 当作最高层，乱入当作 1）' }, '熟成层数 ',
						el('input', { type: 'number', min: 0, value: fl.stage || '', placeholder: '自动', style: 'width:4em', oninput: e => { fl.stage = +e.target.value || 0; } })),
					btn('↑', () => move(data.floors, fi, -1)), btn('↓', () => move(data.floors, fi, 1)),
					btn('删除这层', () => { if (confirm(`删除“${fl.name}”整层？`)) data.floors.splice(fi, 1); }, 'mypdc-dg-danger')));
			(fl.enemies = fl.enemies || []).forEach((en, ei) => {
				const icon = headIcon(en.cardId, en.attr);
				const ebox = el('div', { class: 'mypdc-dg-edit-enemy' },
					el('div', { class: 'mypdc-row' }, icon,
						el('label', null, '宠物ID ', el('input', { type: 'number', value: en.cardId || '', style: 'width:6em', onchange: e => {
							en.cardId = +e.target.value || 0;
							const c = Cards?.[en.cardId];
							if (c) { if (!en.name) en.name = cardName(en.cardId); if (c.attrs?.[0] >= 0 && c.attrs[0] < 5) en.attr = c.attrs[0]; }
							render();
						} })),
						el('label', null, '名称 ', inp(en, 'name', { style: 'width:12em' })),
						el('label', null, '属性 ', attrSel(en, 'attr', false)),
						btn('↑', () => move(fl.enemies, ei, -1)), btn('↓', () => move(fl.enemies, ei, 1)),
						btn('删除敌人', () => { if (confirm('删除这个敌人？')) fl.enemies.splice(ei, 1); }, 'mypdc-dg-danger')));
				(en.skills = en.skills || []).forEach((sk, si) => {
					sk.tags = sk.tags || [];
					ebox.append(el('div', { class: 'mypdc-dg-edit-skill' },
						el('div', { class: 'mypdc-row' },
							inp(sk, 'name', { placeholder: '技能名', style: 'width:12em' }),
							el('label', null, el('input', { type: 'checkbox', checked: sk.pre, onchange: e => { sk.pre = e.target.checked; } }), '先制'),
							el('label', null, '伤害 ', inp(sk, 'damage', { type: 'number', style: 'width:8em', min: 0 })),
							el('label', null, '段数 ', inp(sk, 'hits', { type: 'number', style: 'width:3.5em', min: 1 })),
							el('label', null, attrSel(sk, 'attr', true)),
							el('select', { onchange: e => { sk.type = e.target.value; } }, Object.entries(TYPES).map(([v, t]) => el('option', { value: v, selected: sk.type === v }, t))),
							btn('↑', () => move(en.skills, si, -1)), btn('↓', () => move(en.skills, si, 1)),
							btn('复制', () => en.skills.splice(si + 1, 0, JSON.parse(JSON.stringify(sk)))),
							btn('×', () => en.skills.splice(si, 1), 'mypdc-dg-danger')),
						el('div', { class: 'mypdc-dg-edit-tags' }, TAGS.map(([k, label, color]) => el('button', {
							type: 'button', class: `mypdc-dg-tag mypdc-dg-tag-${color}` + (sk.tags.includes(k) ? ' on' : ''),
							onclick: () => { sk.tags = sk.tags.includes(k) ? sk.tags.filter(t => t !== k) : [...sk.tags, k]; render(); },
						}, label)), inp(sk, 'note', { placeholder: '备注（例如：攻击力1.3倍时）', style: 'width:14em' }))));
				});
				ebox.append(btn('＋技能', () => en.skills.push(newSkill())));
				fbox.append(ebox);
			});
			fbox.append(btn('＋敌人', () => fl.enemies.push(newEnemy())));
			box.append(fbox);
		});
		box.append(el('div', { class: 'mypdc-row' }, btn('＋层', () => data.floors.push(newFloor()))));

		// JSON 导入导出（方便整关复制）
		const jsonArea = el('textarea', { rows: 4, class: 'mypdc-dg-json', placeholder: '粘贴关卡 JSON 后点“从 JSON 载入”' });
		box.append(el('details', null, el('summary', null, 'JSON'),
			el('div', { class: 'mypdc-row' },
				btn('显示当前 JSON', () => { setTimeout(() => { jsonArea.value = JSON.stringify({ name: d.name, server: d.server, data }, null, 1); }); }),
				btn('从 JSON 载入', () => {
					try { const o = JSON.parse(jsonArea.value); Object.assign(d, { name: o.name || d.name, server: o.server || d.server, data: o.data || o }); msg = ''; } catch (e) { msg = 'JSON 格式不对'; }
				})),
			jsonArea));

		box.append(el('div', { class: 'mypdc-row mypdc-dg-edit-actions' },
			el('button', { type: 'button', class: 'mypdc-team-primary', onclick: saveEditing }, '💾 保存到服务器'),
			el('button', { type: 'button', onclick: () => { editing = null; msg = ''; render(); } }, '取消'),
			d.id ? el('button', { type: 'button', class: 'mypdc-dg-danger', onclick: deleteEditing }, '删除整个关卡') : null));
		return box;
	}

	async function saveEditing() {
		const d = editing;
		try {
			const r = d.id
				? await api(`/api/dungeons/${d.id}`, { method: 'PUT', admin: true, body: { name: d.name, server: d.server, data: d.data } })
				: await api('/api/dungeons', { method: 'POST', admin: true, body: { name: d.name, server: d.server, data: d.data } });
			editing = null; msg = '';
			await loadList();
			await openDungeon(r.id);
		} catch (e) { msg = e.message; render(); }
	}
	async function deleteEditing() {
		const d = editing;
		if (!confirm(`删除整个关卡“${d.name}”？删除后无法恢复。`)) return;
		try {
			await api(`/api/dungeons/${d.id}`, { method: 'DELETE', admin: true });
			editing = null; cur = null; state.id = 0; saveState();
			await loadList(); render();
		} catch (e) { msg = e.message; render(); }
	}

	async function loadList() {
		try { list = (await api('/api/dungeons')).items; msg = ''; } catch (e) { list = []; msg = '读取关卡列表失败：' + e.message; }
	}
	async function openDungeon(id) {
		state.id = id; saveState();
		cur = null; render();
		if (!id) return;
		try { cur = await api(`/api/dungeons/${id}`); msg = ''; } catch (e) { msg = e.message; }
		render();
	}
	async function checkAdmin() {
		if (!load('admin-key', '')) { isAdmin = false; return; }
		try { await api('/api/admin', { admin: true }); isAdmin = true; } catch (e) { isAdmin = false; }
	}

	async function open() {
		state.brokens = 0; // 部位破坏数每次打开都从 0 开始
		panel.classList.remove('display-none');
		document.body.classList.add('mypdc-panel-open');
		render();
		await Promise.all([loadList(), checkAdmin()]);
		if (state.id && !cur) await openDungeon(state.id); else render();
	}
	function close() {
		panel.classList.add('display-none');
		document.body.classList.remove('mypdc-panel-open');
	}

	function build() {
		if (!API) return;
		const openBtn = el('button', { type: 'button', class: 'mypdc-open-btn', onclick: open }, '关卡伤害模拟');
		panel = el('div', { class: 'mypdc-panel mypdc-dg-panel display-none' },
			el('div', { class: 'mypdc-panel-head' }, el('h2', null, '关卡伤害模拟'), el('button', { type: 'button', onclick: close }, '关闭')));
		body = el('div', { class: 'mypdc-panel-body' });
		panel.append(body);
		document.body.append(panel);
		const titleBox = document.querySelector('.formation-box .title-box');
		if (titleBox) { openBtn.classList.add('mypdc-open-inline'); titleBox.append(openBtn); }
		else document.body.append(openBtn);
		MyPDC.onTeamUpdate(() => { if (!editing) render(); });
	}
	window.addEventListener('load', build);
	MyPDC.dungeon = { open };
})();
