'use strict';
// 我的 PDC：电脑宽屏布局（≥1200px）。手机和窄窗口保持原样。
// 左栏：队伍 + 正在编辑的队员详情；右栏：搜索条件和结果列表一直展开（独立滚动）。
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
			document.querySelector('.formation-box')?.after(placeholder);
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
	function apply() { if (isDesk()) enter(); else leave(); }

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
			if (wasOpen && !open) window.scrollTo({ top: 0, behavior: 'smooth' });
			wasOpen = open;
		})
			.observe(box, { attributes: true, attributeFilter: ['class'] });
		searchBox()?.addEventListener('toggle', () => { const sb = searchBox(); if (isDesk() && !sb.open) sb.open = true; });
	}, 300));
	let t;
	window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { apply(); sizeHead(); }, 150); });
	window.addEventListener('orientationchange', () => setTimeout(() => { apply(); sizeHead(); }, 400));

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
