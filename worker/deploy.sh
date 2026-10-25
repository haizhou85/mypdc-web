#!/usr/bin/env bash
# 部署队伍库后端：确保 D1 数据库和表存在、部署 Worker、设置管理密码；最后输出接口地址
# 需要环境变量：CLOUDFLARE_API_TOKEN、CLOUDFLARE_ACCOUNT_ID、ADMIN_KEY
set -euo pipefail
cd "$(dirname "$0")"
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ] || [ -z "${ADMIN_KEY:-}" ]; then
	echo "::warning title=队伍库后端::没有设置 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / ADMIN_KEY，跳过"
	exit 0
fi
API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID"
cf() { curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" "$@"; }
WRANGLER="npx --yes wrangler@4"

echo "==> D1 数据库"
DB_ID=$(cf "$API/d1/database?name=mypdc-teams" | jq -r '.result[]? | select(.name=="mypdc-teams") | .uuid' | head -1)
if [ -z "$DB_ID" ]; then
	DB_ID=$(cf -X POST "$API/d1/database" -d '{"name":"mypdc-teams"}' | jq -r '.result.uuid // empty')
	[ -n "$DB_ID" ] || { echo "创建 D1 数据库失败" >&2; exit 1; }
	echo "已创建数据库 $DB_ID"
fi
sed -i "s/__DB_ID__/$DB_ID/" wrangler.toml
$WRANGLER d1 execute mypdc-teams --remote --file schema.sql >/dev/null

echo "==> workers.dev 子域名"
SUB=$(cf "$API/workers/subdomain" | jq -r '.result.subdomain // empty')
if [ -z "$SUB" ]; then
	for name in lalapad lalapad-tools "lalapad-$(echo "$CLOUDFLARE_ACCOUNT_ID" | cut -c1-6)"; do
		SUB=$(cf -X PUT "$API/workers/subdomain" -d "{\"subdomain\":\"$name\"}" | jq -r '.result.subdomain // empty')
		[ -n "$SUB" ] && break
	done
	[ -n "$SUB" ] || { echo "无法设置 workers.dev 子域名" >&2; exit 1; }
	echo "已设置子域名 $SUB"
fi

echo "==> 部署 Worker"
$WRANGLER deploy
printf '%s' "$ADMIN_KEY" | $WRANGLER secret put ADMIN_KEY >/dev/null

URL="https://mypdc-teams.$SUB.workers.dev"
echo "接口地址：$URL"
# 检查接口是否可用（结果显示在 Actions 的注释里）
for i in 1 2 3 4 5 6; do
	CODE=$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/teams?limit=1" || true)
	[ "$CODE" = "200" ] && break
	sleep 5
done
echo "::notice title=队伍库后端::$URL （接口检查 HTTP $CODE）"
[ -n "${GITHUB_OUTPUT:-}" ] && echo "api=$URL" >> "$GITHUB_OUTPUT"
