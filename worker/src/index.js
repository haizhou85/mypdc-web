// LaLa个人使用的PAD工具：队伍库后端（Cloudflare Worker + D1）
// GET    /api/teams?q=&before=&limit=   列表（新的在前）
// GET    /api/teams/:id                 单个队伍（含编队数据）
// POST   /api/teams                     保存为新队伍（任何人，无需登录，有频率限制）
// DELETE /api/teams/:id                 删除（需要 X-Admin-Key）
// GET    /api/admin                     检查管理密码
const ALLOWED_ORIGINS = [
	'https://haizhou85.github.io',
	'https://lalapad.pages.dev',
	'http://localhost:8765',
	'http://localhost:8000',
];
const LIMITS = {
	title: 60, author: 30, note: 1000, data: 20000,
	perIpHour: 20, perDay: 1000, pageSize: 50,
};
const SERVERS = ['ja', 'en', 'ko'];
const PAGES = { 1: 'solo', 2: 'multi', 3: 'triple' };

function cors(req) {
	const origin = req.headers.get('Origin') || '';
	return {
		'Access-Control-Allow-Origin': (ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.lalapad\.pages\.dev$/.test(origin)) ? origin : ALLOWED_ORIGINS[0],
		'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
		'Access-Control-Max-Age': '86400',
		'Vary': 'Origin',
	};
}
function json(req, body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(req) },
	});
}
const fail = (req, msg, status = 400) => json(req, { error: msg }, status);

async function sha256(text) {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function isAdmin(req, env) {
	const key = req.headers.get('X-Admin-Key') || '';
	if (!env.ADMIN_KEY || !key) return false;
	// 比较哈希，避免按字符逐个比较泄露时间信息
	return (await sha256('k:' + key)) === (await sha256('k:' + env.ADMIN_KEY));
}

const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const memberId = m => {
	const id = Array.isArray(m) ? m[0] : (typeof m === 'number' ? m : 0);
	return Number.isInteger(id) && id > 0 && id < 1e6 ? id : 0;
};

function rowOut(r, full) {
	const o = {
		id: r.id, title: r.title, author: r.author, note: r.note, page: r.page,
		server: r.server, members: JSON.parse(r.members), created: r.created,
	};
	if (full) o.data = JSON.parse(r.data);
	return o;
}

async function list(req, env, url) {
	const q = cleanText(url.searchParams.get('q'), 60);
	const before = parseInt(url.searchParams.get('before'), 10) || 0;
	const limit = Math.min(LIMITS.pageSize, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 30));
	const where = [], args = [];
	if (before > 0) { where.push('id < ?'); args.push(before); }
	if (q) {
		const like = '%' + q.replace(/[\\%_]/g, c => '\\' + c) + '%';
		where.push("(title LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\')");
		args.push(like, like, like);
	}
	const sql = `SELECT id, title, author, note, page, server, members, created FROM teams
		${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
	const { results } = await env.DB.prepare(sql).bind(...args, limit + 1).all();
	const more = results.length > limit;
	return json(req, { items: results.slice(0, limit).map(r => rowOut(r, false)), more });
}

async function getOne(req, env, id) {
	const r = await env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(id).first();
	return r ? json(req, rowOut(r, true)) : fail(req, '找不到这个队伍', 404);
}

async function create(req, env) {
	let body;
	try {
		const text = await req.text();
		if (text.length > LIMITS.data + 4000) return fail(req, '数据太大', 413);
		body = JSON.parse(text);
	} catch (e) { return fail(req, '数据格式不对'); }

	const title = cleanText(body.title, LIMITS.title);
	if (!title) return fail(req, '请填写队伍名称');
	const author = cleanText(body.author, LIMITS.author);
	const note = cleanText(body.note, LIMITS.note);
	const server = SERVERS.includes(body.server) ? body.server : 'ja';
	const d = body.data;
	if (!d || typeof d !== 'object' || !Array.isArray(d.f) || !PAGES[d.f.length]) return fail(req, '编队数据不对');
	const dataStr = JSON.stringify(d);
	if (dataStr.length > LIMITS.data) return fail(req, '数据太大', 413);
	const members = d.f.map(t => (Array.isArray(t?.[0]) ? t[0] : []).slice(0, 6).map(memberId));
	if (!members.flat().some(id => id > 0)) return fail(req, '队伍是空的');

	const now = Date.now();
	const ip = (await sha256('ip:' + (req.headers.get('CF-Connecting-IP') || '') + (env.ADMIN_KEY || ''))).slice(0, 24);
	const admin = await isAdmin(req, env);
	if (!admin) {
		const perIp = await env.DB.prepare('SELECT COUNT(*) AS n FROM teams WHERE ip = ? AND created > ?').bind(ip, now - 3600e3).first();
		if (perIp.n >= LIMITS.perIpHour) return fail(req, '保存太频繁了，请稍后再试', 429);
		const perDay = await env.DB.prepare('SELECT COUNT(*) AS n FROM teams WHERE created > ?').bind(now - 86400e3).first();
		if (perDay.n >= LIMITS.perDay) return fail(req, '今天保存的队伍太多了，请明天再试', 429);
	}
	const r = await env.DB.prepare(`INSERT INTO teams (title, author, note, page, server, members, data, created, ip)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
		.bind(title, author, note, PAGES[d.f.length], server, JSON.stringify(members), dataStr, now, ip).first();
	return json(req, { id: r.id }, 201);
}

async function remove(req, env, id) {
	if (!(await isAdmin(req, env))) return fail(req, '没有删除权限', 403);
	const r = await env.DB.prepare('DELETE FROM teams WHERE id = ?').bind(id).run();
	return json(req, { deleted: r.meta?.changes || 0 });
}

export default {
	async fetch(req, env) {
		if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
		const url = new URL(req.url);
		const path = url.pathname.replace(/\/+$/, '');
		try {
			if (path === '/api/teams') {
				if (req.method === 'GET') return await list(req, env, url);
				if (req.method === 'POST') return await create(req, env);
			}
			const m = path.match(/^\/api\/teams\/(\d+)$/);
			if (m) {
				const id = parseInt(m[1], 10);
				if (req.method === 'GET') return await getOne(req, env, id);
				if (req.method === 'DELETE') return await remove(req, env, id);
			}
			if (path === '/api/admin' && req.method === 'GET') {
				return (await isAdmin(req, env)) ? json(req, { ok: true }) : fail(req, '密码不对', 403);
			}
			return fail(req, 'Not found', 404);
		} catch (e) {
			console.error(e);
			return fail(req, '服务器出错了', 500);
		}
	},
};
