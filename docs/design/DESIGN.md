# 设计系统文档：AgentX

> UI 模式：`mockup-driven`（图稿驱动 UI，行为仍以 PRD 为准）
> 版本：v0.2 / V1 视觉基线；2026-09-07。用户已确认品牌方向与 v0.3 采用图，三个默认参考见 references；尚无实际界面验证。

## 1. 概览与创意北极星

### 创意北极星：「清晰的工作现场」

AgentX 的视觉应安静、清晰、可长时间阅读。以中性表面承载内容，仅用少量蓝色表达主要动作、焦点与选中，避免大片渐变和仪表盘卡片堆叠。

以留白、文字层级和按需展开建立秩序。信息密度可以高，但主要内容、辅助信息和可交互元素必须能快速区分；不依赖装饰表达专业感。页面功能与状态由 PRD 定义，本文件只管理全产品通用视觉。

---

## 2. 色彩与表面架构

主色为蓝，辅色为低饱和青绿，第三色为少量紫色，中性色承担绝大多数面积。默认跟随系统深浅主题，也允许用户显式固定。主题改变不影响业务状态。

### 色板（品牌板须可视化）

色阶统一命名为角色加 50、100、200、300、400、500、600、700、800、900。以下为固定十阶，不在组件里临时发明色值。

| 角色 | 主色 HEX | 色阶（浅→深，8–10 阶，附 HEX） |
| --- | --- | --- |
| 主色 primary | #2563EB | #EFF6FF、#DBEAFE、#BFDBFE、#93C5FD、#60A5FA、#3B82F6、#2563EB、#1D4ED8、#1E40AF、#1E3A8A |
| 辅色 secondary | #0F766E | #F0FDFA、#CCFBF1、#99F6E4、#5EEAD4、#2DD4BF、#14B8A6、#0D9488、#0F766E、#115E59、#134E4A |
| 第三色 tertiary | #7C3AED | #F5F3FF、#EDE9FE、#DDD6FE、#C4B5FD、#A78BFA、#8B5CF6、#7C3AED、#6D28D9、#5B21B6、#4C1D95 |
| 中性色 neutral | #4B5563 | #F9FAFB、#F3F4F6、#E5E7EB、#D1D5DB、#9CA3AF、#6B7280、#4B5563、#374151、#1F2937、#111827 |

### 语义色（品牌板须可视化）

| 角色 | Token | 浅色 HEX / 深色 HEX | 来源 |
| --- | --- | --- | --- |
| 错误 | semantic-error | #B91C1C / #FCA5A5 | 独立色 |
| 成功 | semantic-success | #166534 / #86EFAC | 独立色 |
| 警告 | semantic-warning | #92400E / #FCD34D | 独立色 |
| 信息 | semantic-info | #1D4ED8 / #93C5FD | 主色衍生 |

语义色只定义通用意义，不在这里映射业务状态。文字和图标共同传达含义。

### 克制的布局边界

优先用表面色与间距分区，不给每个区块加边框。输入、数据网格和需要明确边缘的容器允许使用 border-default；键盘焦点必须使用 focus-ring。所有可点击控件都要有可观察的悬停、按下或选中反馈。

### 表面层级与嵌套

| Token | 浅色 HEX | 深色 HEX | 用途 |
| --- | --- | --- | --- |
| surface-base | #FFFFFF | #111827 | 基础表面 |
| surface-subtle | #F9FAFB | #0B1220 | 次级分区 |
| surface-card | #FFFFFF | #1F2937 | 局部容器 |
| surface-overlay | #FFFFFF | #1F2937 | 浮层 |
| text-primary | #111827 | #F9FAFB | 主内容 |
| text-secondary | #4B5563 | #D1D5DB | 辅助内容 |
| text-muted | #6B7280 | #9CA3AF | 弱化内容 |
| text-inverse | #FFFFFF | #111827 | 反色内容 |
| border-default | #D1D5DB | #4B5563 | 必要边界 |
| focus-ring | #2563EB | #93C5FD | 焦点指示 |
| action-primary | #2563EB | #93C5FD | 主交互背景 |
| action-primary-hover | #1D4ED8 | #BFDBFE | 主交互悬停 |
| action-primary-pressed | #1E40AF | #60A5FA | 主交互按下 |
| text-on-primary | #FFFFFF | #111827 | 主交互文字 |

不超过三级局部容器嵌套；超过时改用标题和间距，不无限套卡片。

### 玻璃与渐变规则

首版不使用毛玻璃、大面积渐变或背景纹理；此项明确跳过。模态遮罩采用 overlay-scrim：浅色 rgba(17,24,39,0.36)，深色 rgba(0,0,0,0.56)，其为覆盖层而非可复用底色。

---

## 3. 字体：面向长时间阅读

标题、正文与标签使用一致的系统字体栈，通过字号与字重区分，避免为装饰引入网络字体。等宽内容使用独立字体栈，保留原始空白与可选择复制能力。

### 字号阶梯（品牌板须可视化）

| 角色 | 字体族 | 用途 | 样例层级 |
| --- | --- | --- | --- |
| 标题 | Segoe UI Variable、Segoe UI、Microsoft YaHei UI、sans-serif | 标题层级 | text-headline-lg 24/32，text-headline-md 20/28，text-headline-sm 16/24；字重 600；样例“清晰的层次” |
| 正文 | 同标题字体栈 | 连续正文与导航 | text-body 14/22，text-body-lg 16/26；字重 400；样例“内容保持自然可读。” |
| 标签 | 同标题字体栈 | 标签与辅助说明 | text-label 12/18，字重 500；样例“辅助信息” |
| 等宽补充 | Cascadia Code、Consolas、monospace | 代码与结构化文本 | text-code 13/20，字重 400；样例“result = 42” |

### 信息层级

字号数值按 CSS 像素表达，斜杠后为行高。正文不小于 14；12 仅用于短标签。标题不全大写，不滥用粗体；段落间距 12，区块间距 24，紧密关联元素间距 8。常规文字与背景对比度目标不低于 4.5:1，焦点和关键图形不低于 3:1；实际渲染仍需验收。

### 字体实现约束（受限运行时须填写）

| 触点 | 稿面字体 | 实现字体 / fallback 栈 | 加载策略 |
| --- | --- | --- | --- |
| Windows 桌面 | 系统字体外观参考；栅格稿不保证精确字体 | Segoe UI Variable、Segoe UI、Microsoft YaHei UI、sans-serif | 系统可用字体依次回退，不联网下载 |
| 等宽内容 | 系统字体外观参考；栅格稿不保证精确字体 | Cascadia Code、Consolas、monospace | 缺失时系统回退 |

需检查 Windows 缩放 100%、125%、150% 与界面缩放；中文回退不能造成按钮裁字。没有移动端字体加载要求。

---

## 4. 层级与深度

层级主要通过表面和间距建立；浮动元素才使用明显阴影。

* **叠层原则：** 容器采用 surface-card，浮层采用 surface-overlay；交互底色统一引用下表主题别名。
* **环境阴影：** shadow-overlay 为浅色 0 12px 32px rgba(17,24,39,0.16)，深色 0 12px 32px rgba(0,0,0,0.32)；静态卡片默认无阴影。
* **幽灵描边兜底：** 首版不使用半透明描边，统一 border-default 1px；焦点采用 focus-ring 2px 并外偏 2px，不靠阴影代替焦点。

### 叠色对照表（品牌板须可视化）

| Token | 基准色与底色 | 不透明度 | 预计算 HEX | 用途 |
| --- | --- | --- | --- | --- |
| interaction-hover-light | #2563EB 覆盖 #FFFFFF | 8% | #EEF3FD | 浅色悬停 |
| interaction-selected-light | #2563EB 覆盖 #FFFFFF | 14% | #E0E9FC | 浅色选中 |
| interaction-hover-dark | #93C5FD 覆盖 #111827 | 10% | #1E293C | 深色悬停 |
| interaction-selected-dark | #93C5FD 覆盖 #111827 | 16% | #263449 | 深色选中 |
| semantic-error-surface-light | #B91C1C 覆盖 #FFFFFF | 10% | #F8E8E8 | 浅色错误底 |
| semantic-error-surface-dark | #FCA5A5 覆盖 #111827 | 12% | #2D2936 | 深色错误底 |

interaction-hover、interaction-selected、semantic-error-surface 分别随主题映射到对应行；组件使用这些不透明 HEX，不能在不同底色上重新混合。禁用态不再叠加整体透明度，而使用 text-muted、surface-subtle 和明确的禁用语义。

---

## 5. 组件

以下仅定义通用原语。交互控件统一支持键盘操作与可访问名称；默认圆角 8，紧密元素 6，浮层 12。焦点规则适用于所有可交互原语。

### 按钮与交互（品牌板须可视化）

* **主按钮：** 高 36、水平内边距 14；action-primary 与 text-on-primary；悬停和按下分别使用对应 action-primary Token。
* **次按钮：** surface-subtle 与 text-primary；悬停 interaction-hover，按下 interaction-selected。
* **描边按钮：** surface-base、border-default、text-primary；悬停和按下同次按钮。
* **文字按钮：** 透明背景与 semantic-info；悬停 interaction-hover，按下 interaction-selected。
* **反色按钮：** 深底使用 #FFFFFF 背景、#111827 文字，悬停 #F3F4F6、按下 #E5E7EB；始终保持反色，不随背景猜测颜色。

五种按钮均圆角 8。禁用统一 surface-subtle 与 text-muted，不接受点击；提交中保留文案、增加 16px spinner 并阻止重复提交。可切换按钮采用 interaction-selected 与 aria-pressed，不把普通操作按钮伪装为切换按钮。

### 输入与表单

* 高度不低于 36，多行输入最小 88；内边距 10×12，surface-base、text-primary、border-default 1px。悬停维持布局，仅边界加强；聚焦显示 focus-ring。
* 错误边框与说明引用 semantic-error，说明置于控件下方并关联描述；禁用使用 surface-subtle 和 text-muted；只读仍允许选择复制，与禁用区别。
* 标签与辅助文字不得只由 placeholder 承担。选中文本使用 interaction-selected 和 text-primary；不把密码类输入默认显示为明文。

* 多选使用复选框，二元启停使用开关；标签、选择值与实际健康提示分开，不能用开关代替多选。
* 密码类输入默认隐藏；显隐图标有可访问名称与按下状态，关闭或离开安全上下文后清理临时明文。掩码不是输入值，不自动写回。
* 配置保存、正在验证与验证结果使用不同提示，显示就近错误与修复动作，不靠页面顶部笼统成功消息覆盖失败。

### 浮层、菜单与页签

* 菜单复用列表与浮层原语，打开后焦点进入；上下键导航、Enter 激活、Escape 关闭并回到触发处。图标操作在悬停及键盘聚焦时同等可达，不能只支持鼠标。
* 对话框采用明确标题、关闭动作与单一主操作，焦点限制在弹层；关闭回到原控件，保留未提交草稿或明确提示丢弃。
* 页签选中、键盘焦点与关闭按钮独立。关闭视图不默认终止背后工作；具体生命周期由 PRD 决定。
* 分隔条可拖动也有键盘调整方法；内容区设合理最小宽度，窄窗口采用按需抽屉，不裁掉主要操作。

### 卡片容器

* card-default：surface-card，圆角 8，内边距 16；card-inset：surface-subtle，内边距 12；card-elevated：surface-overlay，圆角 12，内边距 16，shadow-overlay。
* 静态容器无悬停态；可交互容器才使用 interaction-hover、interaction-selected 和键盘焦点。禁用不屏蔽内容可读性。

### 列表行

* 最小行高 40，水平内边距 12，行距 4；默认透明，悬停 interaction-hover，选中 interaction-selected，文字 text-primary。
* 必须同时用标记或字重表达选中；长文本省略时提供可访问完整内容。禁用项 text-muted、不可激活，焦点仍可按实际语义访问说明。

### 导航

* 采用侧向列表导航与简洁顶栏原语；选中项使用 interaction-selected、semantic-info 和字重 600，未选中 text-secondary，悬停 interaction-hover。
* 图标 18，图标与标签间距 8；折叠时保留可访问名称及提示。首版无底栏 Tab 原语需求，明确跳过底栏样式；具体位置和尺寸由 PRD 规定。

### 搜索框

* 复用输入与表单原语，左侧 16px 图标，右侧可有清除图标按钮；聚焦、错误、禁用同输入。
* 下拉结果使用 card-elevated 与列表行，最大高 320；键盘上下选择、Enter 激活、Escape 收起；无结果复用空状态。不定义业务占位文案。

### 状态徽章

* 行内高度 22，内边距 2×8，圆角 6，text-label；默认 surface-subtle 与 text-secondary，可配 12px 图标。
* 通用错误样例：semantic-error-surface 底色、semantic-error 文字，标签“错误”。非交互徽章没有悬停或选中态；需要交互时必须改用按钮原语，不伪装为徽章。

### 图标按钮

* 32×32，图标 18、描边 1.5；默认透明底与 text-secondary，悬停 interaction-hover，选中 interaction-selected 与 semantic-info，按下同选中底。
* 禁用使用 text-muted；焦点使用统一 focus-ring；必须有可访问名称，提示不能成为唯一命名来源。

### 空状态

* 默认 40px 中性图标，标题 text-headline-sm、text-primary，说明 text-body、text-secondary，最大文字宽 420；不使用装饰性大插画。
* 可选 CTA 复用主或次按钮，间距 16；容器自身无悬停、禁用或选中态，按钮沿用其完整状态。

### Loading（若适用）

* spinner 16 或 24，使用 semantic-info；骨架屏使用 surface-subtle，不模拟真实业务内容。加载指示带可访问说明。
* 尊重 prefers-reduced-motion：减少或停止旋转，以静态图标加文字保持可观察；不无限闪烁。加载组件本身无选中或点击态。

---

## 6. 宜忌

### 应当：
* **应当** 使用文字、图标和颜色共同说明含义。
* **应当** 保留自然阅读宽度和可预测的焦点顺序。
* **应当** 复用既有 Token 与原语处理空、错误和加载状态。
* **应当** 在深浅主题及 Windows 缩放下验证对比度、裁切和键盘操作。

### 禁止：
* **禁止** 用装饰卡片、毛玻璃或大面积渐变压过内容。
* **禁止** 为悬停改变尺寸造成界面跳动。
* **禁止** 用重复头像、密集状态胶囊或多层卡片把连续工作记录变成聊天装饰墙。
* **禁止** 将功能页面布局或业务状态映射写入本文件。
* **禁止** 仅用浅灰和整体透明度表示不可用，也禁止隐藏失败信息。
