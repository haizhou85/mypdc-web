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

# 在页面里引入自定义脚本（放在 script.js 之后）
INJECT='<link href="mypdc.css" rel="stylesheet" type="text/css">\n<link href="mypdc-mobile.css" rel="stylesheet" type="text/css">\n<script type="text/javascript" src="mypdc-common.js"></script>\n<script type="text/javascript" src="mypdc-impart.js"></script>\n<script type="text/javascript" src="mypdc-detail.js"></script>\n<script type="text/javascript" src="mypdc-sort.js"></script>\n<script type="text/javascript" src="mypdc-list.js"></script>\n<script type="text/javascript" src="mypdc-reduce.js"></script>'
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
patch script.js 'const browser_i18n = navigator.language;' 'const browser_i18n = "zh-CN";'
patch index.html 'let browser_i18n = (navigator.language||navigator.userLanguage);' 'let browser_i18n = "zh-CN";'

echo "==> 重新生成离线缓存表"
(cd "$OUT" && npm install --no-audit --no-fund --silent && node update-service-worker.js >/dev/null && rm -rf node_modules package-lock.json)

touch "$OUT/.nojekyll"
echo "==> 完成：$OUT"
