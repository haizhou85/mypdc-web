#!/usr/bin/env bash
# 把上游 PADDashFormation 和本仓库的自定义功能合并成可部署的网站。
# 用法: ./build.sh <上游目录> [输出目录，默认 site]
set -euo pipefail

UPSTREAM="${1:?请指定上游 PADDashFormation 目录}"
OUT="${2:-site}"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> 复制上游文件"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -a "$UPSTREAM"/. "$OUT"/
rm -rf "$OUT/.git" "$OUT/.github" "$OUT/node_modules" "$OUT/monsters-info/official-API"

echo "==> 叠加自定义功能"
cp "$HERE"/src/* "$OUT"/
# 队伍库后端地址（由部署流程传入；本地构建不传则不显示队伍库功能）
printf 'window.MYPDC_API = %s;\n' "$(python3 -I -c 'import json,os; print(json.dumps(os.environ.get("MYPDC_API","")))')" > "$OUT/mypdc-config.js"

# 在页面里引入自定义脚本（放在 script.js 之后）
INJECT='<link href="mypdc.css" rel="stylesheet" type="text/css">\n<link href="mypdc-mobile.css" rel="stylesheet" type="text/css">\n<script type="text/javascript" src="mypdc-config.js"></script>\n<script type="text/javascript" src="mypdc-common.js"></script>\n<script type="text/javascript" src="mypdc-impart.js"></script>\n<script type="text/javascript" src="mypdc-detail.js"></script>\n<script type="text/javascript" src="mypdc-sort.js"></script>\n<script type="text/javascript" src="mypdc-list.js"></script>\n<script type="text/javascript" src="mypdc-reduce.js"></script>\n<script type="text/javascript" src="mypdc-skilluse.js"></script>\n<script type="text/javascript" src="mypdc-teams.js"></script>'
for page in solo.html multi.html triple.html; do
	if ! grep -q 'src="script.js"></script>' "$OUT/$page"; then
		echo "错误：$page 中找不到 script.js 引用，上游页面结构可能变了" >&2
		exit 1
	fi
	sed -i "s#\(<script type=\"text/javascript\" src=\"script.js\"></script>\)#\1\n$INJECT#" "$OUT/$page"
done

# 默认使用简体中文（上游按浏览器语言选择，英文系统会显示英语）；页面上仍可切换语言
patch() { # 文件 原文 替换
	if ! grep -qF "$2" "$OUT/$1"; then
		echo "错误：$1 中找不到“$2”，上游代码可能改了" >&2
		exit 1
	fi
	python3 -I -c 'import sys; p,a,b=sys.argv[1:]; s=open(p,encoding="utf-8").read(); open(p,"w",encoding="utf-8").write(s.replace(a,b,1))' "$OUT/$1" "$2" "$3"
}
# 手机：按设备实际宽度显示（上游固定 width=664，手机上整页缩小）
for page in solo.html multi.html triple.html; do
	vp=$(grep -o '<meta name="viewport" content="width=[0-9]*" />' "$OUT/$page" || true)
	if [ -z "$vp" ]; then echo "错误：$page 中找不到固定宽度的 viewport，上游可能改了" >&2; exit 1; fi
	patch "$page" "$vp" '<meta name="viewport" content="width=device-width, initial-scale=1" />'
done
# 类型筛选默认 OR（上游默认 AND）
for page in solo.html multi.html triple.html; do
	patch "$page" 'name="type-and-or" id="type-and-or" checked>' 'name="type-and-or" id="type-and-or">'
done
patch script.js 'const browser_i18n = navigator.language;' 'const browser_i18n = "zh-CN";'
patch index.html 'let browser_i18n = (navigator.language||navigator.userLanguage);' 'let browser_i18n = "zh-CN";'

# 网页名称
SITE_NAME='LaLa个人使用的PAD工具'
for page in index.html solo.html multi.html triple.html; do
	patch "$page" '<title>智龙急速阵型</title>' "<title>$SITE_NAME</title>"
done
patch index.html '<h1 class="title">智龙急速阵型<br>Puzzle & Dragons Dash Formation</h1>' "<h1 class=\"title\">$SITE_NAME</h1>"
for lang in "$OUT"/languages/*.js; do
	[ "$(basename "$lang")" = "language-list.js" ] && continue
	# 必须在语言文件调用 localisation() 之前改，否则标题已经按原名设置好了
	python3 -I -c 'import sys; p,n=sys.argv[1:]; s=open(p,encoding="utf-8").read(); k="localisation(localTranslating);"; assert k in s, p; open(p,"w",encoding="utf-8").write(s.replace(k, "localTranslating.webpage_title = \""+n+"\";\n"+k, 1))' "$lang" "$SITE_NAME"
done
python3 -I - "$OUT/manifest.webmanifest" "$SITE_NAME" <<'PY'
import json, sys
p, name = sys.argv[1], sys.argv[2]
m = json.load(open(p, encoding='utf-8-sig'))
m['name'] = name
m['short_name'] = 'LaLa PAD'
m['start_url'] = './solo.html'
open(p, 'w', encoding='utf-8').write(json.dumps(m, ensure_ascii=False, indent='\t'))
PY

# 离线缓存不处理其他网站的请求（队伍库接口必须每次联网读取，不能用缓存）
patch service-worker.js "	const url = new URL(event.request.url);
	const pathname = url.pathname;" "	const url = new URL(event.request.url);
	if (url.origin !== location.origin) return;
	// 页面和本站自定义的 mypdc-* 文件：联网优先（断网时才用缓存），网站更新后第一次打开就是新版本
	if (event.request.mode === \"navigate\" || /\\/mypdc-[^/]*$/.test(url.pathname)) {
		event.respondWith(fetch(url.href, {cache: \"no-cache\", credentials: \"same-origin\"}).then(res => {
			if (res.ok) { const copy = res.clone(); caches.open(cacheName).then(c => c.put(new URL(url.pathname, location.origin), copy)); }
			return res;
		}).catch(() => caches.match(new URL(url.pathname, location.origin), {ignoreSearch: true})));
		return;
	}
	const pathname = url.pathname;"

# 首页直接打开单人编队页面（保留网址后面的参数，例如 ?team=、#teams）
cat > "$OUT/index.html" <<HTML
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>$SITE_NAME</title>
<link rel="manifest" href="manifest.webmanifest">
<script>location.replace('solo.html' + location.search + location.hash);</script>
<meta http-equiv="refresh" content="0; url=solo.html">
</head>
<body><a href="solo.html">打开 $SITE_NAME</a></body>
</html>
HTML

echo "==> 重新生成离线缓存表"
(cd "$OUT" && npm install --no-audit --no-fund --silent && node update-service-worker.js >/dev/null && rm -rf node_modules package-lock.json)

touch "$OUT/.nojekyll"
echo "==> 完成：$OUT"
