'use strict';
// 我的 PDC：电脑 / 横屏宽屏布局（横屏且 ≥860px）。手机和竖屏保持原样。
// 左栏：队伍（固定在屏幕上）；右栏：搜索条件 → 结果列表（8 条）→ 正在编辑的宠物信息。
(function () {
	const MIN = 860; // 横屏平板、折叠屏展开横屏也用电脑布局（900~1199 时左栏缩小）
	// 只有横屏（宽大于高）才用两栏；竖屏（包括折叠屏展开竖屏、平板竖屏）一律单栏
	const isDesk = () => window.innerWidth >= MIN && window.innerWidth > window.innerHeight;
	let moved = null; // 移到右栏的节点和原来的位置
	let placeholder;

	function searchBox() { return document.querySelector('.edit-box .search-box'); }

	function enter() {
		document.body.classList.add('mypdc-desk');
		document.body.classList.remove('side-mode');
		const sb = searchBox();
		if (sb) sb.open = true;
		document.querySelectorAll('.mypdc-skill-filter, .mypdc-sort-cfg').forEach(d => { d.open = true; });
		// 结果列表移到搜索栏里，和条件放在一起
		if (!moved && sb) {
			const nodes = ['.mypdc-sort-bar', '.mypdc-list-wrap', '.edit-box .search-mon-list'].map(s => document.querySelector(s)).filter(Boolean);
			moved = nodes.map(n => ({ n, parent: n.parentNode, next: n.nextSibling }));
			const box = MyPDC.el('div', { class: 'mypdc-desk-results' }, nodes);
			sb.append(box);
			document.querySelector('.mypdc-icon-more') && box.append(document.querySelector('.mypdc-icon-more'));
		}
		if (!placeholder) {
			placeholder = MyPDC.el('div', { class: 'mypdc-desk-empty' }, '👈 点左边队伍里的队员（头像、潜觉或觉醒），在这里编辑；右边随时可以搜索宠物。');
			searchBox()?.closest('.edit-box')?.after(placeholder);
		}
		sizeHead();
	}
	function leave() {
		document.body.classList.remove('mypdc-desk');
		if (moved) {
			moved.slice().reverse().forEach(({ n, parent, next }) => parent.insertBefore(n, next && next.parentNode === parent ? next : null));
			document.querySelector('.mypdc-desk-results')?.remove();
			moved = null;
		}
	}
	function sizeHead() {
		const h = document.querySelector('.control-box')?.getBoundingClientRect().height || 0;
		document.documentElement.style.setProperty('--mypdc-head', Math.ceil(h) + 'px');
	}
	function apply() { if (isDesk()) enter(); else leave(); requestAnimationFrame(() => limitRows?.()); }

	// 结果列表只显示 8 条的高度
	function limitRows() {
		const wrap = document.querySelector('.mypdc-desk-results .mypdc-list-wrap');
		if (!wrap) return;
		if (!document.body.classList.contains('mypdc-desk')) { wrap.style.maxHeight = ''; return; }
		const rows = wrap.querySelectorAll('.mypdc-list-table tbody');
		if (rows.length > 8) {
			const top = wrap.getBoundingClientRect().top - wrap.scrollTop;
			const h = Math.ceil(rows[7].getBoundingClientRect().bottom - top) + 2;
			if (h > 100) wrap.style.maxHeight = h + 'px';
		} else wrap.style.maxHeight = 'none';
	}
	window.addEventListener('load', () => setTimeout(() => {
		const wrap = document.querySelector('.mypdc-list-wrap');
		if (wrap) new MutationObserver(() => requestAnimationFrame(limitRows)).observe(wrap, { childList: true });
	}, 400));

	// 上游打开编辑框时会加 side-mode（它自己的左右分栏），电脑布局下不用
	window.addEventListener('load', () => setTimeout(() => {
		new MutationObserver(() => {
			if (document.body.classList.contains('mypdc-desk') && document.body.classList.contains('side-mode')) document.body.classList.remove('side-mode');
		}).observe(document.body, { attributes: true, attributeFilter: ['class'] });
		apply();
		// 编辑框打开时，搜索栏保持展开
		const box = document.querySelector('.edit-box');
		// 关闭编辑（确认/取消）后回到队伍
		let wasOpen = box && !box.classList.contains('display-none');
		if (box) new MutationObserver(() => {
			if (!isDesk()) return;
			const sb = searchBox(); if (sb && !sb.open) sb.open = true;
			const open = !box.classList.contains('display-none');
			if (wasOpen && !open && !MyPDC.noAutoScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
			if (open !== wasOpen) document.body.classList.remove('mypdc-browse');
			wasOpen = open;
		})
			.observe(box, { attributes: true, attributeFilter: ['class'] });
		searchBox()?.addEventListener('toggle', () => { const sb = searchBox(); if (isDesk() && !sb.open) sb.open = true; });
	}, 300));
	let t;
	window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { apply(); sizeHead(); }, 150); });
	window.addEventListener('orientationchange', () => setTimeout(() => { apply(); sizeHead(); }, 400));

	// 没有在编辑队员时，点结果列表里的宠物：只显示宠物信息（没有留空格子 / 取消 / 保存）
	document.addEventListener('click', e => {
		if (!document.body.classList.contains('mypdc-desk')) return;
		if (!e.target.closest?.('.mypdc-desk-results .mypdc-list-table tbody, .mypdc-desk-results .search-mon-list .monster')) return;
		const box = document.querySelector('.edit-box');
		if (box?.classList.contains('display-none')) document.body.classList.add('mypdc-browse');
	}, true);

	MyPDC.desk = { isDesk };
})();

// 点队员的觉醒（本体或辅助那一列）：打开这个队员的编辑（手机和电脑都适用）
(function () {
	document.addEventListener('click', e => {
		const li = e.target.closest?.('.team-member-awoken .member-awoken, .team-assist-awoken .member-awoken');
		if (!li) return;
		const big = li.closest('.team-bigbox');
		const ti = typeof teamBigBoxs !== 'undefined' ? teamBigBoxs.indexOf(big) : -1;
		const idx = parseInt(li.dataset.index, 10);
		const isAssist = li.closest('.team-assist-awoken') ? 1 : 0;
		if (ti < 0 || !(idx >= 0) || !(formation.teams[ti]?.[isAssist]?.[idx]?.id > 0)) return;
		e.preventDefault(); e.stopPropagation();
		editMember(ti, isAssist, idx);
	}, true);
})();

// 电脑布局：从搜索结果列表（或图标）直接拖到队伍里的位置。手机不变（列表不能拖）。
// 放下时按“打开编辑 → 选这只宠物 → 保存修改”的流程处理，等级、觉醒、加蛋等和手动选择时一样。
(function () {
	const isDesk = () => document.body.classList.contains('mypdc-desk');
	let dragId = 0;

	function markRows() {
		document.querySelectorAll('.mypdc-desk-results .mypdc-list-table tbody').forEach(tb => {
			if (isDesk()) tb.setAttribute('draggable', 'true'); else tb.removeAttribute('draggable');
		});
	}
	window.addEventListener('load', () => setTimeout(() => {
		const wrap = document.querySelector('.mypdc-list-wrap');
		if (wrap) new MutationObserver(markRows).observe(wrap, { childList: true, subtree: true });
		markRows();
	}, 500));

	// 列表行：开始拖动
	document.addEventListener('dragstart', e => {
		if (!isDesk()) return;
		const tb = e.target.closest?.('.mypdc-list-table tbody');
		const head = e.target.closest?.('.search-mon-list .monster');
		let id = 0;
		if (tb) id = parseInt(tb.querySelector('td:nth-child(2)')?.textContent, 10) || parseInt(tb.dataset.id, 10) || 0;
		else if (head) id = parseInt(head.dataset.cardid, 10) || 0;
		if (!(id > 0)) return;
		dragId = id;
		e.dataTransfer.setData('card-id', String(id));
		e.dataTransfer.setData('text/plain', String(id));
		e.dataTransfer.effectAllowed = 'copy';
		document.body.classList.add('mypdc-dragging');
	}, true);
	document.addEventListener('dragend', () => { dragId = 0; document.body.classList.remove('mypdc-dragging'); clearHover(); }, true);

	const slotOf = el => el?.closest?.('.formation-box .team-members .monster[data-team], .formation-box .team-assist .monster[data-team]');
	let hover = null;
	function clearHover() { hover?.classList.remove('mypdc-drop-target'); hover = null; }
	document.addEventListener('dragover', e => {
		if (!dragId) return;
		const slot = slotOf(e.target);
		if (!slot) { clearHover(); return; }
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
		if (hover !== slot) { clearHover(); hover = slot; slot.classList.add('mypdc-drop-target'); }
	}, true);

	document.addEventListener('drop', e => {
		if (!dragId) return;
		const slot = slotOf(e.target);
		if (!slot) return;
		e.preventDefault(); e.stopImmediatePropagation();
		const id = dragId; dragId = 0; clearHover();
		document.body.classList.remove('mypdc-dragging');
		place(+slot.dataset.team, +slot.dataset.assist, +slot.dataset.index, id);
	}, true);

	function place(ti, isAssist, idx, id) {
		const card = Cards[id];
		if (!card) return;
		if (isAssist && !card.canAssist) { flash(`${MyPDC.cardName(id)} 不能当辅助`); return; }
		const box = document.querySelector('.edit-box');
		const wasOpen = box && !box.classList.contains('display-none');
		const prev = wasOpen ? editBox.memberIdx?.slice() : null;
		const y = window.scrollY;
		MyPDC.noAutoScroll = true;
		try {
			editBox.editMon(ti, isAssist, idx);
			const input = document.getElementById('card-id');
			input.value = id;
			document.getElementById('form-id-search').onchange?.();
			box.querySelector('.button-box .button-done')?.onclick?.();
			if (prev && !(prev[0] === ti && prev[1] === isAssist && prev[2] === idx)) editBox.editMon(prev[0], prev[1], prev[2]);
		} catch (err) { console.error(err); }
		window.scrollTo({ top: y, behavior: 'instant' });
		setTimeout(() => { window.scrollTo({ top: y, behavior: 'instant' }); MyPDC.noAutoScroll = false; }, 1400);
	}
	function flash(text) {
		const n = MyPDC.el('div', { class: 'mypdc-toast' }, text);
		document.body.append(n);
		setTimeout(() => n.remove(), 2200);
	}
})();
