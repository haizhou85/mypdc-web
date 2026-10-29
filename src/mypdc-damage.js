'use strict';
// 我的 PDC：队伍伤害模拟（放在“关卡伤害模拟”面板里，平时折叠）
// 输入：一个转珠盘（点珠子循环 火→水→木→光→暗→心），不转珠，按盘面直接消除（含落珠后的连锁，不含天降）。
// 计算：每个队员主属性、副属性两个攻击点的伤害 = 攻击力 × 消除 × 连击 × 觉醒 × 队长技 × 主动技倍率 × 克制 / 杀手。
(function () {
	const { el, load, save, fmt, leaderIds, cardName } = MyPDC;
	const ORB_NAMES = ['火', '水', '木', '光', '暗', '心'];
	const ATTR_NAMES = ['火', '水', '木', '光', '暗'];
	const BASE_CAP = 2147483647; // 每个攻击点的默认伤害上限（约 21.47 亿）

	const st = Object.assign({ open: false, target: '', useSkill: false, atkBuff: '', comboBuff: '', cap: true, capSkill: false, boards: {} }, load('dmg-state', {}));
	const saveSt = () => save('dmg-state', st);

	// ---------- 觉醒倍率（2024 年以后的数值） ----------
	const AW = {
		TPA: 27, L: 60, VDP: 48, CROSS: 78, T: 126, CONNECT12: 82,
		LEVITATE: 106, C7: 43, C10: 61, C15: 144, HP_HIGH: 57, HP_LOW: 58,
		COLOR3: 79, COLOR4: 80, COLOR5: 81, GUARD_BREAK: 44, HEART_L: 59, TEAM_RCV: 47,
		PAIRS: [[133, 0, 1], [134, 1, 2], [135, 2, 0]], // 火水、水木、木火同时攻击
		ROW: [22, 23, 24, 25, 26], ATTR_COMBO: [73, 74, 75, 76, 77], COLUMN: [149, 150, 151, 152, 153],
	};
	// 大觉醒按上游的等效表折算成小觉醒（例如 大U = 2 个 U、3火横 = 3 个火横）
	let EQ = null;
	function counter(list) {
		if (!EQ) EQ = new Map((typeof equivalent_awoken !== 'undefined' ? equivalent_awoken : []).map(e => [e.big, e]));
		const map = new Map();
		list.forEach(id => {
			map.set(id, (map.get(id) || 0) + 1);
			const e = EQ.get(id);
			if (e) map.set(e.small, (map.get(e.small) || 0) + e.times);
		});
		return id => map.get(id) || 0;
	}

	// ---------- 盘面 ----------
	function defaultBoard(W, H) { // 不会消除的排列
		const b = [];
		for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) b.push((c + 2 * r) % 6);
		return b;
	}
	function boardOf(W, H) {
		const key = W + 'x' + H;
		let b = st.boards[key];
		if (!Array.isArray(b) || b.length !== W * H) b = st.boards[key] = defaultBoard(W, H);
		return b;
	}

	// 找出所有消除（含落珠后的连锁）。返回 { combos, remain }
	function solve(board, W, H, minLen) {
		let g = board.slice();
		const combos = [];
		for (let wave = 0; wave < 20; wave++) {
			const mark = new Array(W * H).fill(false);
			for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
				const v = g[r * W + c];
				if (v < 0) continue;
				let k = c; while (k + 1 < W && g[r * W + k + 1] === v) k++;
				if (k - c + 1 >= 3) for (let x = c; x <= k; x++) mark[r * W + x] = true;
				k = r; while (k + 1 < H && g[(k + 1) * W + c] === v) k++;
				if (k - r + 1 >= 3) for (let y = r; y <= k; y++) mark[y * W + c] = true;
			}
			const seen = new Array(W * H).fill(false);
			const found = [];
			for (let i = 0; i < W * H; i++) {
				if (!mark[i] || seen[i]) continue;
				const color = g[i], cells = [], stack = [i];
				seen[i] = true;
				while (stack.length) {
					const j = stack.pop(); cells.push(j);
					const r = Math.floor(j / W), c = j % W;
					[[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].forEach(([y, x]) => {
						if (y < 0 || y >= H || x < 0 || x >= W) return;
						const n = y * W + x;
						if (!seen[n] && mark[n] && g[n] === color) { seen[n] = true; stack.push(n); }
					});
				}
				if (cells.length >= minLen) found.push(shapeOf(color, cells, W, H, wave));
			}
			if (!found.length) break;
			combos.push(...found);
			found.forEach(cb => cb.cells.forEach(j => { g[j] = -1; }));
			for (let c = 0; c < W; c++) { // 落珠
				const col = [];
				for (let r = H - 1; r >= 0; r--) if (g[r * W + c] >= 0) col.push(g[r * W + c]);
				for (let r = H - 1, k = 0; r >= 0; r--, k++) g[r * W + c] = k < col.length ? col[k] : -1;
			}
		}
		return { combos, remain: g.filter(v => v >= 0).length };
	}
	function shapeOf(color, cells, W, H, wave) {
		const pts = cells.map(j => [Math.floor(j / W), j % W]);
		const rows = new Map(), cols = new Map();
		pts.forEach(([r, c]) => { rows.set(r, (rows.get(r) || 0) + 1); cols.set(c, (cols.get(c) || 0) + 1); });
		const n = cells.length;
		const rowCount = [...rows.values()].filter(v => v === W).length; // 含完整横一列
		const colCount = [...cols.values()].filter(v => v === H).length; // 含完整竖一列
		const rs = pts.map(p => p[0]), cs = pts.map(p => p[1]);
		const r0 = Math.min(...rs), r1 = Math.max(...rs), c0 = Math.min(...cs), c1 = Math.max(...cs);
		const box3 = r1 - r0 === 2 && c1 - c0 === 2;
		const has = (r, c) => pts.some(p => p[0] === r && p[1] === c);
		let shape = '';
		if (n === 9 && box3) shape = 'box';
		else if (n === 5 && box3) {
			const midR = r0 + 1, midC = c0 + 1;
			const fullRow = r => [c0, midC, c1].every(c => has(r, c));
			const fullCol = c => [r0, midR, r1].every(r => has(r, c));
			if (fullRow(midR) && fullCol(midC)) shape = 'cross';
			else if ((fullRow(r0) || fullRow(r1)) && (fullCol(c0) || fullCol(c1))) shape = 'L';
			else if (((fullRow(r0) || fullRow(r1)) && fullCol(midC)) || ((fullCol(c0) || fullCol(c1)) && fullRow(midR))) shape = 'T';
		}
		return { color, cells, n, rowCount, colCount, shape, wave };
	}

	// ---------- 队伍资料 ----------
	function memberInfo(team, i, awokenBind) {
		const m = team[0][i], a = team[1][i];
		if (!m || !(m.id > 0) || !Cards[m.id]) return null;
		const card = Cards[m.id];
		let attrs = [...card.attrs], types = [...card.types];
		try { const at = m.getAttrsTypesWithWeapon(a); if (at) { attrs = at.attrs; types = at.types; } } catch (e) { /* 用卡片本身 */ }
		let awk = [];
		if (!awokenBind) { try { awk = m.effectiveAwokens(a) || []; } catch (e) { awk = card.awakenings.slice(0, m.awoken); } }
		const ab = calculateAbility(m, a, solo, teamsCount);
		const pick = awokenBind ? 1 : 0;
		return {
			idx: i, m, a, card, attrs, types, count: counter(awk), latent: m.latent || [],
			atk: ab ? ab[1][pick] : 0, rcv: ab ? ab[2][pick] : 0,
		};
	}

	// ---------- 队长技 ----------
	function leaderNodes(id) {
		const card = Cards[id];
		if (!card || !card.leaderSkillId) return [];
		let arr;
		try { arr = skillParser(card.leaderSkillId); } catch (e) { return []; }
		const out = [];
		const walk = n => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object' && n.kind) out.push(n); };
		walk(arr);
		return out;
	}
	const listOf = x => (Array.isArray(x) ? x : x == null ? [] : [x]);
	const isAll = x => x === 'all';
	function memberMatches(node, mem) {
		const attrs = isAll(node.attrs) ? [0, 1, 2, 3, 4] : listOf(node.attrs), types = listOf(node.types);
		if (!attrs.length && !types.length) return true;
		return attrs.some(x => mem.attrs.includes(x)) || types.some(t => mem.types.includes(t));
	}

	// 盘面统计
	function boardStats(combos, remain) {
		const by = [0, 1, 2, 3, 4, 5].map(c => combos.filter(cb => cb.color === c));
		const colors = new Set(combos.map(cb => cb.color));
		const attackColors = [0, 1, 2, 3, 4].filter(c => colors.has(c)).length;
		return { combos, remain, by, colors, attackColors, count: combos.length };
	}

	function scaleVal(v, n) {
		if (!(n >= v.min)) return null;
		const k = Math.min(n, v.max ?? v.min) - v.min;
		return { atk: (v.baseAtk ?? 1) + (v.bonusAtk || 0) * Math.max(0, k), rcv: (v.baseRcv ?? 1) + (v.bonusRcv || 0) * Math.max(0, k) };
	}

	// 某个觉醒在这一盘里有没有“发动”
	function activated(awkId, ctx) {
		const { bs, mems } = ctx;
		const own = (mem, test) => bs.combos.some(cb => cb.color < 5 && (cb.color === mem.attrs[0] || cb.color === mem.attrs[1]) && test(cb));
		const anyMem = test => mems.some(mem => mem && mem.count(awkId) > 0 && test(mem));
		switch (awkId) {
			case 27: return anyMem(mem => own(mem, cb => cb.n === 4));
			case 60: return anyMem(mem => own(mem, cb => cb.shape === 'L'));
			case 48: return anyMem(mem => own(mem, cb => cb.shape === 'box'));
			case 78: return anyMem(mem => own(mem, cb => cb.shape === 'cross'));
			case 126: return anyMem(mem => own(mem, cb => cb.shape === 'T'));
			case 82: return anyMem(mem => own(mem, cb => cb.n >= 12));
			case 79: return bs.attackColors >= 3 && anyMem(() => true);
			case 80: return bs.attackColors >= 4 && anyMem(() => true);
			case 81: return bs.attackColors >= 5 && anyMem(() => true);
			case 20: return bs.by[5].some(cb => cb.rowCount > 0) && anyMem(() => true);
			default: {
				let i = AW.ROW.indexOf(awkId);
				if (i >= 0) return bs.by[i].some(cb => cb.rowCount > 0) && anyMem(() => true);
				i = AW.ATTR_COMBO.indexOf(awkId);
				if (i >= 0) return bs.by[i].length >= 2 && anyMem(() => true);
				i = AW.COLUMN.indexOf(awkId);
				if (i >= 0) return bs.by[i].some(cb => cb.colCount > 0) && anyMem(() => true);
				const pair = AW.PAIRS.find(p => p[0] === awkId);
				if (pair) return bs.by[pair[1]].length > 0 && bs.by[pair[2]].length > 0 && anyMem(() => true);
				return null; // 不认识
			}
		}
	}

	// 判断条件。返回 true / false；判断不了的记到 ctx.unknown
	function condOK(cond, ctx, node) {
		if (!cond) return true;
		const { bs } = ctx;
		for (const [k, v] of Object.entries(cond)) {
			switch (k) {
				case 'hp': if (!(ctx.hpPct / 100 >= v.min - 1e-9 && ctx.hpPct / 100 <= v.max + 1e-9)) return false; break;
				case 'useSkill': if (!st.useSkill) return false; break;
				case 'multiplayer': if (teamsCount !== 2) return false; break;
				case 'prob': break; // 按发动计算
				case 'combos': if (!(bs.count >= v.min)) return false; break;
				case 'attrs': if (!(listOf(v.attrs).filter(a => bs.colors.has(a)).length >= v.min)) return false; break;
				case 'LShape': if (!bs.combos.some(cb => cb.shape === 'L' && listOf(v.attrs).includes(cb.color))) return false; break;
				case 'heal': if (ctx.heal == null) return false; if (!(ctx.heal >= v.min)) return false; break;
				case 'stage': if (!(ctx.stage >= (v.min || 0) && (!v.max || ctx.stage <= v.max))) return false; break;
				case 'enemyAttr': if (!ctx.enemy || !listOf(v.attrs).includes(ctx.enemy.attr)) return false; break;
				case 'exact': {
					if (v.type === 'combo') { if (bs.count !== v.value) return false; }
					else if (v.type === 'match-length') {
						if (v.attrs === 'enhanced') return false; // 不考虑强化珠
						const hit = bs.combos.filter(cb => cb.n === v.value && (isAll(v.attrs) || listOf(v.attrs).includes(cb.color)));
						if (!hit.length) return false;
						node.__times = hit.length;
					} else { ctx.unknown.add('条件 exact:' + v.type); return false; }
					break;
				}
				case 'compo': if (!compoOK(v, ctx)) return false; break;
				case 'awakeningActivated': {
					const res = listOf(v.awakenings).map(a => activated(a, ctx));
					if (res.some(r => r === null)) ctx.unknown.add('觉醒发动条件 ' + v.awakenings.join(','));
					if (!res.some(r => r)) return false;
					break;
				}
				default: ctx.unknown.add('条件 ' + k); return false;
			}
		}
		return true;
	}
	function compoOK(v, ctx) {
		const cards = ctx.team[0].map(m => (m && m.id > 0 ? Cards[m.id] : null)).filter(Boolean);
		switch (v.type) {
			case 'card': return listOf(v.ids).every(id => cards.some(c => c.id === id));
			case 'series': return cards.length > 0 && cards.every(c => listOf(v.ids).includes(c.collabId));
			case 'evolution': return cards.every(c => listOf(v.ids).some(t =>
				t === 'pixel-evo' ? c.evoMaterials?.includes(3826) : t === 'reincarnation-evo' ? (typeof isReincarnated === 'function' && isReincarnated(c)) : false));
			case 'team-total-rarity': return cards.reduce((s, c) => s + (c.rarity || 0), 0) <= v.ids;
			case 'team-same-rarity':
				if (v.ids > 0) return cards.every(c => c.rarity === v.ids);
				if (v.ids === -1) return new Set(cards.map(c => c.rarity)).size === cards.length;
				ctx.unknown.add('队伍稀有度条件'); return false;
			default: ctx.unknown.add('队伍组合条件 ' + v.type); return false;
		}
	}
	// 一个 power-up 对某个队员的倍率。返回 { atk, rcv, active }
	function powerUpFactor(node, mem, ctx) {
		const none = { atk: 1, rcv: 1, active: false };
		if (node.targets) return none; // “消除的那个属性”只出现在强化珠条件里
		if (mem && !memberMatches(node, mem)) return none;
		node.__times = 1;
		if (!condOK(node.condition, ctx, node)) return none;
		const v = node.value;
		const { bs } = ctx;
		let f = null;
		if (!v) f = { atk: 1, rcv: 1 };
		else switch (v.kind) {
			case 'mul': f = { atk: v.atk ?? 1, rcv: v.rcv ?? 1 }; break;
			case 'scale-attrs': f = scaleVal(v, listOf(v.attrs).filter(a => bs.colors.has(a)).length); break;
			case 'scale-combos': f = scaleVal(v, bs.count); break;
			case 'scale-match-len': {
				const longest = a => Math.max(0, ...bs.combos.filter(cb => cb.color === a).map(cb => cb.n));
				const ls = listOf(v.attrs).map(longest);
				f = scaleVal(v, v.matchAll ? Math.min(...ls) : Math.max(0, ...ls));
				break;
			}
			case 'scale-match-attrs': {
				const avail = bs.by.map(x => x.length);
				const slots = listOf(v.matches).map(listOf).sort((a, b) => a.length - b.length);
				let n = 0;
				slots.forEach(slot => {
					const c = slot.filter(x => avail[x] > 0).sort((a, b) => avail[b] - avail[a])[0];
					if (c !== undefined) { avail[c]--; n++; }
				});
				f = scaleVal(v, n);
				break;
			}
			case 'scale-cross': {
				let atk = 1, rcv = 1, any = false;
				listOf(v.crosses).forEach(cr => {
					const k = bs.combos.filter(cb => cb.shape === 'cross' && listOf(cr.attr).includes(cb.color)).length;
					if (!k) return;
					any = true;
					const times = cr.single ? 1 : k;
					atk *= (cr.atk ?? 1) ** times; rcv *= (cr.rcv ?? 1) ** times;
				});
				f = any ? { atk, rcv } : null;
				break;
			}
			case 'scale-remain-orbs': {
				if (bs.remain <= v.max) {
					const k = v.max - Math.max(bs.remain, v.min || 0);
					f = { atk: (v.baseAtk ?? 1) + (v.bonusAtk || 0) * k, rcv: (v.baseRcv ?? 1) + (v.bonusRcv || 0) * k };
				}
				break;
			}
			case 'scale-state-kind': {
				let n = 0;
				if (v.awakenings?.length) n = ctx.mems.reduce((s, mm) => s + (mm ? v.awakenings.reduce((t, a) => t + mm.count(a), 0) : 0), 0);
				else n = ctx.mems.filter(mm => mm && memberMatches({ attrs: v.attrs, types: v.types }, mm)).length;
				f = { atk: 1 + (v.value?.atk || 0) * n, rcv: 1 + (v.value?.rcv || 0) * n };
				break;
			}
			default: ctx.unknown.add('队长倍率 ' + v.kind); f = null;
		}
		if (!f) return none;
		const times = node.eachTime ? (node.__times || 1) : 1;
		return { atk: (f.atk || 1) ** times, rcv: (f.rcv || 1) ** times, active: true };
	}

	// ---------- 主动技的攻击力 buff（队员和武器的技能） ----------
	function atkBuffs(team) {
		const out = [];
		const members = team[0], leaderIdx = team[3] || 0, last = members.length - 1;
		const add = (card, j, isAssist) => {
			if (!card || !card.activeSkillId) return;
			let parsed;
			try { parsed = skillParser(card.activeSkillId); } catch (e) { return; }
			const walk = (n, turns) => {
				if (Array.isArray(n)) { n.forEach(x => walk(x, turns)); return; }
				if (!n || typeof n !== 'object') return;
				if (n.kind === SkillKinds.RandomSkills) return;
				if (n.kind === SkillKinds.ActiveTurns) { (n.skills || []).forEach(x => walk(x, n.turns)); return; }
				const onlyHeart = listOf(n.attrs).length > 0 && listOf(n.attrs).every(x => x === 5); // 回复力 buff
				if (turns && (n.kind === SkillKinds.PowerUp || n.kind === SkillKinds.SlotPowerUp) && !n.condition && !onlyHeart && n.value?.kind === 'mul' && (n.value.atk || 1) > 1) {
					let idx = null;
					if (n.targets) {
						idx = new Set();
						n.targets.forEach(t => {
							if (t === 'self') idx.add(j);
							else if (t === 'leader-self') idx.add(leaderIdx);
							else if (t === 'leader-helper') idx.add(last);
							else if (t === 'sub-members') members.forEach((_, k) => { if (k !== leaderIdx && k !== last) idx.add(k); });
							else if (t === 'left-neighbor' && j > 0) idx.add(j - 1);
							else if (t === 'right-neighbor' && j < last) idx.add(j + 1);
							else if (t === 'team') members.forEach((_, k) => idx.add(k));
						});
					}
					const TN = { self: '自己', 'left-neighbor': '左边', 'right-neighbor': '右边', 'leader-self': '队长', 'leader-helper': '好友队长', 'sub-members': '队员', team: '全队' };
					const who = n.targets ? n.targets.map(t => TN[t] || t).join('、') : (listOf(n.attrs).length || listOf(n.types).length ? '部分队员' : '全队');
					const text = `攻击×${+(n.value.atk).toFixed(2)} ${turns}回合${who ? ' ' + who : ''} · ${j + 1}号${isAssist ? '辅助' : ''} ${cardName(card.id)}`;
					if (!out.some(o => o.text === text)) out.push({ kind: 'atk', text, atk: n.value.atk, idx, attrs: n.attrs, types: n.types });
				}
				if (turns && n.kind === SkillKinds.AddCombo && n.value > 0) {
					const text = `+${n.value}连击 ${turns}回合 · ${j + 1}号${isAssist ? '辅助' : ''} ${cardName(card.id)}`;
					if (!out.some(o => o.text === text)) out.push({ kind: 'combo', text, combo: n.value });
				}
				for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v, turns);
			};
			walk(parsed, 0);
		};
		members.forEach((m, j) => {
			if (m?.id > 0) add(Cards[m.id], j, false);
			const a = team[1][j];
			if (a?.id > 0) add(Cards[a.id], j, true);
		});
		return out;
	}
	function buffFor(mem, ctx) {
		const b = ctx.buffs.find(x => x.kind === 'atk' && x.text === st.atkBuff);
		if (!b) return 1;
		if (b.idx) return b.idx.has(mem.idx) ? b.atk : 1;
		return memberMatches(b, mem) ? b.atk : 1;
	}

	// ---------- 计算 ----------
	function compute(ctxBase) {
		const { team, ti } = ctxBase;
		const D = MyPDC.dungeon;
		const dstate = D.state;
		const awokenBind = !!dstate.awokenBind;
		const mems = [0, 1, 2, 3, 4, 5].map(i => memberInfo(team, i, awokenBind));
		const [l1, l2] = leaderIds(ti);
		const leaders = [l1, l2].map(id => ({ id, nodes: leaderNodes(id) }));
		const allNodes = leaders.flatMap(l => l.nodes);
		const ctx = Object.assign({}, ctxBase, { mems, unknown: new Set(), hpPct: dstate.startHp || 100, buffs: atkBuffs(team) });

		const { W, H, minLen } = ctx;
		const res = solve(boardOf(W, H), W, H, minLen);
		const bs = ctx.bs = boardStats(res.combos, res.remain);
		const powerUps = allNodes.filter(n => n.kind === 'power-up');

		// 加 C（两个队长技条件满足时 + 加C技能）、固定追打
		let addCombo = 0, fixedFollow = 0;
		const comboFrom = [];
		ctx.heal = null;
		powerUps.forEach(n => {
			const f = powerUpFactor(n, null, ctx);
			if (!f.active) return;
			listOf(n.additional).forEach(a => {
				if (a?.kind === 'add-combo' && a.value) { addCombo += a.value; comboFrom.push(`队长+${a.value}`); }
				if (a?.kind === 'follow-attack-fixed') fixedFollow += a.value?.value || 0;
			});
		});
		const cb = ctx.buffs.find(x => x.kind === 'combo' && x.text === st.comboBuff);
		if (cb) { addCombo += cb.combo; comboFrom.push(`技能+${cb.combo}`); }
		const totalCombos = bs.count + addCombo;
		const comboMul = totalCombos > 0 ? 1 + 0.25 * (totalCombos - 1) : 0;

		// 回复量（用于“回复○万以上”这类条件）
		const leaderFor = (mem, field) => powerUps.reduce((p, n) => p * powerUpFactor(n, mem, ctx)[field], 1);
		const teamRcv = mems.reduce((s, mm) => s + (mm ? mm.count(AW.TEAM_RCV) : 0), 0);
		const heartBase = bs.by[5].reduce((s, cb) => s + 1 + 0.25 * (cb.n - 3), 0);
		let heal = 0;
		if (heartBase > 0) mems.forEach(mm => { if (mm) heal += Math.ceil(mm.rcv * heartBase * comboMul * (1 + 0.1 * teamRcv) * leaderFor(mm, 'rcv')); });
		ctx.heal = heal;

		// 横列 / 属性连击：全队按属性计算
		const teamCount = id => mems.reduce((s, mm) => s + (mm ? mm.count(id) : 0), 0);
		const rowMul = [0, 1, 2, 3, 4].map(c => 1 + 0.3 * teamCount(AW.ROW[c]) * bs.by[c].reduce((s, cb) => s + cb.rowCount, 0));
		const attrComboMul = [0, 1, 2, 3, 4].map(c => bs.by[c].length >= 2 ? 1 + 0.3 * teamCount(AW.ATTR_COMBO[c]) * (bs.by[c].length - 1) : 1);

		const enemy = ctx.enemy;
		const enemyTypes = enemy?.cardId && Cards[enemy.cardId] ? Cards[enemy.cardId].types : [];
		const killerTable = typeof typekiller_for_type !== 'undefined' ? typekiller_for_type : [];

		// 超重力：关卡攻击力倍率（<1）；有浮游觉醒的队员 ×50（最多回到 1 倍）
		const gRate = Number(MyPDC.dungeon.data?.atkRate) || 1;
		let skillCaps = [];
		try { skillCaps = MyPDC.avgCap?.teamCaps(team) || []; } catch (e) { /* 忽略 */ }
		const rows = mems.map(mem => {
			if (!mem) return null;
			const skCap = skillCaps[mem.idx]?.cap || 0;
			const cap = !st.cap ? Infinity : (st.capSkill && skCap > BASE_CAP ? skCap : BASE_CAP);
			const lead = leaderFor(mem, 'atk');
			const buff = buffFor(mem, ctx);
			const grav = gRate < 1 ? (mem.count(AW.LEVITATE) > 0 ? Math.min(1, gRate * 50) : gRate) : 1;
			// 攻击点：主属、附属、三属（附属：和主属同色 10%、不同色 33%；三属固定 5%）
			const pts = [0, 1, 2].map(k => {
				const attr = mem.attrs[k];
				if (!(attr >= 0 && attr <= 4)) return null;
				let base = 0, shapeMul = 1;
				bs.by[attr].forEach(cb => {
					let d = Math.ceil(mem.atk * (1 + 0.25 * (cb.n - 3)));
					if (k === 1) d = Math.ceil(d / (attr === mem.attrs[0] ? 10 : 3));
					if (k === 2) d = Math.ceil(d * 0.05);
					let m = 1;
					if (cb.n === 4) m *= 2.2 ** mem.count(AW.TPA);
					if (cb.shape === 'L') m *= 2.2 ** mem.count(AW.L);
					if (cb.shape === 'box') m *= 3.5 ** mem.count(AW.VDP);
					if (cb.shape === 'cross') m *= 3 ** mem.count(AW.CROSS);
					if (cb.shape === 'T') m *= 8 ** mem.count(AW.T);
					if (cb.n >= 12) m *= 12 ** mem.count(AW.CONNECT12);
					base += d * m;
					shapeMul = Math.max(shapeMul, m);
				});
				if (!base) return { attr, dmg: 0 };
				let awk = 1;
				const pw = (id, x) => { const n = mem.count(id); if (n) awk *= x ** n; };
				if (totalCombos >= 7) pw(AW.C7, totalCombos >= 14 ? 2.5 : 2);
				if (totalCombos >= 10) pw(AW.C10, 5);
				if (totalCombos >= 15) pw(AW.C15, 100);
				if (ctx.hpPct >= 50) pw(AW.HP_HIGH, 2.5);
				if (ctx.hpPct <= 50) pw(AW.HP_LOW, 2.5);
				if (bs.attackColors >= 3) pw(AW.COLOR3, 3);
				if (bs.attackColors >= 4) pw(AW.COLOR4, 4);
				if (bs.attackColors >= 5) { pw(AW.COLOR5, 5); pw(AW.GUARD_BREAK, 3); }
				let pairOn = false;
				AW.PAIRS.forEach(([id, a, b]) => { if (bs.by[a].length && bs.by[b].length && mem.count(id)) { pw(id, 50); pairOn = true; } });
				if (bs.by[5].some(cb => cb.shape === 'L')) pw(AW.HEART_L, 3);
				const team = rowMul[attr] * attrComboMul[attr];
				// 杀手（觉醒 5 倍 / 特殊类型 3 倍，潜觉 1.5 倍）
				let killer = 1;
				if (enemyTypes.length) killerTable.forEach(t => {
					if (!enemyTypes.includes(t.type)) return;
					if (t.awoken) killer *= ([39, 40, 41, 42].includes(t.awoken) ? 3 : 5) ** mem.count(t.awoken);
					if (t.latent) killer *= 1.5 ** mem.latent.filter(l => l === t.latent).length;
				});
				// 属性克制
				let eff = 1;
				if (enemy && enemy.attr >= 0 && enemy.attr <= 4) {
					const strong = { 0: 2, 1: 0, 2: 1, 3: 4, 4: 3 };
					const weak = { 0: 1, 1: 2, 2: 0 };
					if (strong[attr] === enemy.attr) eff = 2;
					else if (weak[attr] === enemy.attr && !pairOn) eff = 0.5;
				}
				const active = buff;
				const raw = base * comboMul * awk * team * lead * active * grav;
				const full = Math.round(raw * killer * eff);
				return {
					attr, raw: Math.round(raw), full, dmg: Math.min(full, cap), capped: full > cap, cap,
					parts: { base: Math.round(base), combo: comboMul, awk, team, lead, active, grav, killer, eff },
				};
			});
			return { mem, lead, pts };
		});

		// 判断不了的队长技
		allNodes.forEach(n => {
			if (n.kind === 'follow-attack') ctx.unknown.add('攻击后追打（按攻击力倍数）');
			if (n.kind === 'impart-awakenings') ctx.unknown.add('队长技赋予觉醒');
		});
		return { bs, res, rows, addCombo, comboFrom, totalCombos, comboMul, fixedFollow, heal, unknown: [...ctx.unknown], leaders };
	}

	// ---------- 界面 ----------
	let boxEl = null, inner = null;
	function box() {
		if (!boxEl) {
			boxEl = el('details', { class: 'mypdc-box mypdc-dmg' });
			boxEl.open = !!st.open;
			boxEl.append(el('summary', null, '⚔ 队伍伤害模拟', el('span', { class: 'mypdc-dmg-hint' }, '（点击展开：按盘面计算每个队员的伤害）')));
			inner = el('div', { class: 'mypdc-dmg-inner' });
			boxEl.append(inner);
			boxEl.addEventListener('toggle', () => { st.open = boxEl.open; saveSt(); if (boxEl.open) update(); });
		}
		update();
		return boxEl;
	}

	function targets() {
		const D = MyPDC.dungeon, data = D.data;
		const list = [];
		(data?.floors || []).forEach((fl, fi) => (fl.enemies || []).forEach((en, ei) => {
			list.push({ key: fi + ':' + ei, text: `(${fl.name || '-'}) ${en.name || cardName(en.cardId) || '敌人'}`, stage: D.floorStage(fl), enemy: en });
		}));
		return list;
	}

	function boardSize(nodes) {
		let W = 6, H = 5, minLen = 3, noSkyfall = false;
		nodes.forEach(n => {
			if (n.kind === 'board-size-change' && n.width) { W = n.width; H = n.height; }
			if (n.kind === 'min-match-len') minLen = Math.max(minLen, n.value || 3);
			if (n.kind === 'no-skyfall') noSkyfall = true;
		});
		return { W, H, minLen, noSkyfall };
	}

	function update() {
		if (!inner || !boxEl.open) return;
		const D = MyPDC.dungeon;
		inner.innerHTML = '';
		if (teamsCount === 2) { inner.append(el('p', null, '协力（2 人）模式暂不支持伤害模拟。')); return; }
		const ti = D.teamIndex();
		const team = formation?.teams?.[ti];
		if (!team || !team[0].some(m => m && m.id > 0)) { inner.append(el('p', null, '请先在页面上编好队伍。')); return; }

		const [l1, l2] = leaderIds(ti);
		const size = boardSize([...leaderNodes(l1), ...leaderNodes(l2)]);
		const { W, H } = size;
		const board = boardOf(W, H);

		// 目标敌人（决定层数 → 熟成、属性克制、杀手）
		const tl = targets();
		let tgt = tl.find(t => t.key === st.target) || null;
		const stage = tgt ? tgt.stage : Math.max(1, ...tl.map(t => t.stage));
		const sel = el('select', { onchange: e => { st.target = e.target.value; saveSt(); update(); } },
			el('option', { value: '' }, tl.length ? `不指定敌人（按 ${stage >= 99 ? 'BOSS' : stage + 'F'} 层计算）` : '不指定敌人'),
			tl.map(t => el('option', { value: t.key, selected: t.key === st.target }, t.text)));
		inner.append(el('div', { class: 'mypdc-row mypdc-dmg-opts' },
			el('label', null, '目标 ', sel),
			el('label', null, el('input', { type: 'checkbox', checked: st.useSkill, onchange: e => { st.useSkill = e.target.checked; saveSt(); update(); } }), ' 已使用技能'),
			el('label', { title: '每个攻击点默认上限约 21.47 亿' }, el('input', { type: 'checkbox', checked: st.cap, onchange: e => { st.cap = e.target.checked; saveSt(); update(); } }), ' 计入伤害上限'),
			st.cap ? el('label', { title: '按队伍里的上限突破技能（和“平均伤害上限”的分配相同）' }, el('input', { type: 'checkbox', checked: st.capSkill, onchange: e => { st.capSkill = e.target.checked; saveSt(); update(); } }), ' 已开上限突破技能') : null,
			(() => {
				const all = atkBuffs(team);
				const pick = (kind, key, label) => {
					const buffs = all.filter(b => b.kind === kind);
					if (st[key] && !buffs.some(b => b.text === st[key])) st[key] = '';
					return el('label', { class: 'mypdc-dg-skillpick' }, label,
						el('select', { disabled: !buffs.length, onchange: e => { st[key] = e.target.value; saveSt(); update(); } },
							el('option', { value: '' }, buffs.length ? '不开技' : '（队伍里没有）'),
							buffs.map(b => el('option', { value: b.text, selected: b.text === st[key] }, b.text))));
				};
				return [pick('atk', 'atkBuff', '⚔ 攻击buff '), pick('combo', 'comboBuff', '➕ 加C技能 ')];
			})()));

		// 盘面
		let result = null;
		const run = () => D.withDge(stage, () => compute({ team, ti, W, H, minLen: size.minLen, stage, enemy: tgt?.enemy || null }));
		try { result = MyPDC.skillUse?.withAttr ? MyPDC.skillUse.withAttr(run) : run(); } catch (e) { console.error(e); }
		const matched = new Map();
		(result?.res.combos || []).filter(cb => cb.wave === 0).forEach((cb, i) => cb.cells.forEach(j => matched.set(j, i)));
		const grid = el('div', { class: 'mypdc-dmg-board', style: `grid-template-columns: repeat(${W}, 1fr)` });
		board.forEach((v, j) => {
			const b = el('button', { type: 'button', class: 'mypdc-dmg-orb' + (matched.has(j) ? ' on' : ''), 'data-orb': v, title: ORB_NAMES[v] });
			b.onclick = () => { board[j] = (board[j] + 1) % 6; saveSt(); update(); };
			b.oncontextmenu = e => { e.preventDefault(); board[j] = (board[j] + 5) % 6; saveSt(); update(); };
			grid.append(b);
		});
		const tools = el('div', { class: 'mypdc-row mypdc-dmg-tools' },
			el('button', { type: 'button', onclick: () => { st.boards[W + 'x' + H] = defaultBoard(W, H); saveSt(); update(); } }, '重置'),
			el('button', { type: 'button', onclick: () => { st.boards[W + 'x' + H] = Array.from({ length: W * H }, () => Math.floor(Math.random() * 6)); saveSt(); update(); } }, '随机'),
			[0, 1, 2, 3, 4, 5].map(c => el('button', { type: 'button', class: 'mypdc-dmg-fill', 'data-orb': c, title: '整盘换成' + ORB_NAMES[c],
				onclick: () => { st.boards[W + 'x' + H] = new Array(W * H).fill(c); saveSt(); update(); } })),
			el('span', { class: 'mypdc-dmg-size' }, `${W}×${H}` + (size.minLen > 3 ? `，${size.minLen}个以上才能消除` : '') + (size.noSkyfall ? '，无天降' : '')));
		inner.append(el('div', { class: 'mypdc-dmg-boardwrap' }, grid, tools,
			el('div', { class: 'mypdc-dmg-tip' }, '点珠子切换颜色（火→水→木→光→暗→心），电脑上右键反向。亮的是第一轮消除的珠子，落珠后的连锁也会计算。')));
		if (!result) { inner.append(el('p', null, '计算出错。')); return; }

		// 消除统计
		const { bs } = result;
		const shapeName = { L: 'L字', cross: '十字', T: 'T字', box: '方块' };
		const chips = bs.combos.map(cb => el('span', { class: `mypdc-dmg-chip mypdc-attr-${cb.color}` },
			ORB_NAMES[cb.color] + cb.n + (cb.rowCount ? ' 横列' : '') + (cb.colCount ? ' 竖列' : '') + (shapeName[cb.shape] ? ' ' + shapeName[cb.shape] : '') + (cb.wave ? ' 连锁' : '')));
		inner.append(el('div', { class: 'mypdc-dmg-sum' },
			el('b', null, `${bs.count} 连击` + (result.addCombo ? ` +${result.addCombo}（${result.comboFrom.join('、')}）` : '') + `（×${+result.comboMul.toFixed(2)}）`),
			(Number(MyPDC.dungeon.data?.atkRate) < 1 ? ` · 超重力 攻击×${MyPDC.dungeon.data.atkRate}（浮游 ×50）` : '') +
			` · ${bs.attackColors} 色 · 剩余 ${bs.remain} 珠` + (result.heal ? ` · 回复 ${fmt(result.heal)}` : ''),
			el('div', { class: 'mypdc-dmg-chips' }, chips.length ? chips : '（没有消除）')));

		// 每个队员
		const D2 = MyPDC.dungeon;
		const table = el('div', { class: 'mypdc-dmg-table' });
		let total = 0;
		result.rows.forEach((row, i) => {
			if (!row) return;
			const head = D2.headIcon(row.mem.card.id, row.mem.attrs[0]);
			const cells = row.pts.map((pt, k) => {
				if (!pt) return el('div', { class: 'mypdc-dmg-pt mypdc-dmg-none' }, ['-', '无附属', '无三属'][k]);
				total += pt.dmg || 0;
				const p = pt.parts;
				const tip = p ? `基础 ${fmt(p.base)} × 连击 ${+p.combo.toFixed(2)} × 觉醒 ${+p.awk.toFixed(2)} × 横列/属性连击 ${+p.team.toFixed(2)} × 队长 ${+p.lead.toFixed(2)}` +
					(p.active !== 1 ? ` × 攻击buff ${p.active}` : '') + (p.grav !== 1 ? ` × 超重力 ${p.grav}` : '') + (p.killer !== 1 ? ` × 杀手 ${+p.killer.toFixed(2)}` : '') + (p.eff !== 1 ? ` × 克制 ${p.eff}` : '') : '';
				return el('div', { class: `mypdc-dmg-pt mypdc-attr-${pt.attr}`, title: tip },
					el('span', { class: 'mypdc-dmg-ptattr' }, ['主属', '附属', '三属'][k] + ATTR_NAMES[pt.attr]),
					el('b', { title: fmt(pt.dmg) }, big(pt.dmg)),
					pt.capped ? el('span', { class: 'mypdc-dmg-capped', title: '超过伤害上限，括号里是不封顶时的数值' }, `封顶（${big(pt.full)}）`) : null,
					p ? el('span', { class: 'mypdc-dmg-parts' }, [
						`觉醒×${short(p.awk * p.team)}`, `队长×${short(p.lead)}`,
						p.active !== 1 ? `buff×${short(p.active)}` : null, p.grav !== 1 ? `重力×${+p.grav.toPrecision(3)}` : null, p.killer !== 1 ? `杀×${short(p.killer)}` : null, p.eff !== 1 ? `克×${p.eff}` : null,
					].filter(Boolean).map(t => el('span', null, t))) : null);
			});
			table.append(el('div', { class: 'mypdc-dmg-member' }, head, el('div', { class: 'mypdc-dmg-pts' }, cells)));
		});
		inner.append(table);
		inner.append(el('div', { class: 'mypdc-dmg-total' }, el('b', { title: fmt(total) }, `合计 ${big(total)}`),
			result.fixedFollow ? ` ＋ 固定追打 ${fmt(result.fixedFollow)}` : '',
			tgt ? el('span', { class: 'mypdc-dmg-skill-note' }, ` 对 ${tgt.text}（已计入属性克制和杀手）`) : ''));
		const notes = ['敌人防御、强化珠、超追加攻击、潜觉上限解放等暂未计入；鼠标停在数字上可以看每一步的倍率。'];
		if (result.unknown.length) notes.unshift('有判断不了的队长技条件（按未满足计算）：' + result.unknown.join('、'));
		inner.append(el('div', { class: 'mypdc-dmg-note' }, notes.join(' ')));
	}
	function big(x) { // 1 亿以上用“亿 / 万亿”显示
		if (!(x >= 1e8)) return fmt(Math.round(x || 0));
		if (x >= 1e12) return `${+(x / 1e12).toFixed(2)}万亿`;
		return `${+(x / 1e8).toFixed(2)}亿`;
	}
	function short(x) {
		if (x >= 1e4) return fmt(Math.round(x));
		return String(+x.toFixed(x >= 100 ? 0 : 2));
	}

	MyPDC.damage = { box, update, solve, compute };
})();
