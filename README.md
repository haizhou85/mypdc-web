# 我的 PDC（mypdc-web）

自用的智龙迷城（Puzzle & Dragons）组队 / 伤害减伤计算网页，参考 PDC ダメージ計算 的功能。

基于 [Mapaler/PADDashFormation](https://github.com/Mapaler/PADDashFormation)（智龙急速阵型）。本仓库**只存放我加的功能**，
网站由 GitHub Actions 每天自动拉取上游最新代码和怪物数据（日服、美服、韩服），叠加这些功能后发布到 GitHub Pages，
所以游戏更新后数据会自动同步。

## 功能

上游已有：组队（单人 / 2人 / 3人）、宠物搜索和筛选、中文技能说明、队伍 HP 与减伤统计、按编号等多种排序。

本仓库新增：

- **默认简体中文界面**（仍可在页面上切换语言）
- **排序：★队伍中HP** —— 把宠物加入当前队伍后的 HP（乘队长技 HP 倍率、全队 HP 觉醒），排序结果头像上直接显示数值
- **排序：★自身HP** —— 可选等级（110/120）、是否计入超觉醒、是否激活自力觉醒
- **统一基础HP** —— 假定所有宠物基础 HP 相同，只比较觉醒带来的倍率效果
- **激活条件觉醒** —— 计算 HP/攻击/回复时可选择激活：自力、武装（武器同色）、协力、熟成（5/10层）、阴阳加护、部位破坏
- **列表显示搜索结果** —— 表格列出 HP、攻击、回复、队伍中HP、最短CD、觉醒和超觉醒，点表头排序，点行选中宠物
- **★主动技能筛选** —— PDC 式按钮：破吸、解封、各种 buff、威吓、破防、转珠、产珠等，可 AND/OR 组合，可限制最短CD
- **🛡 减伤模拟**（页面右下角按钮）
  - 自动读取队伍 HP、队长技减伤（含血线条件）、属性减伤觉醒和潜觉、徽章
  - 可加技能减伤、技能属性减伤、觉醒无效、概率减伤
  - 录入敌人攻击（属性、单段伤害、段数、普通 / 无视减伤 / 重力），显示每一击的减伤、剩余血量、能否存活、所需减伤
  - 连续承受模式：按顺序扣血，可设每回合回复
  - **关卡库**：保存在浏览器本地，可导入 / 导出 JSON

## 关卡数据

官方接口没有“关卡里有哪些敌人、打多少伤害”的数据，所以关卡需要自己录入（数值可参考 game8、kamigame 等攻略站或游戏内）。

- 自己录入的关卡保存在当前浏览器里，换设备时用“导出 / 导入”转移
- 想让所有设备都能直接用的关卡，可以把导出的 JSON 合并进 `src/mypdc-dungeons.json`，提交后会作为“内置关卡”出现

## 目录

```
src/
  mypdc-common.js     公共工具、接入上游的队伍刷新
  mypdc-sort.js       能力值计算（条件觉醒）和排序
  mypdc-list.js       列表显示、主动技能筛选
  mypdc-reduce.js     减伤模拟和关卡库
  mypdc.css           样式
  mypdc-dungeons.json 内置关卡
build.sh              合并上游 + 本仓库，生成 site/
.github/workflows/    每日自动构建发布
```

## 本地运行

```bash
git clone --depth 1 https://github.com/Mapaler/PADDashFormation.git upstream
./build.sh upstream site
cd site && python3 -m http.server 8000   # 打开 http://localhost:8000/solo.html
```

## 许可

上游项目使用 GPL-3.0，本仓库同样使用 GPL-3.0。游戏图片和怪物资料版权属于 GungHo Online Entertainment。
