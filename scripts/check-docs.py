"""核对已跟踪文档，不读取本地缓存、凭据或产品运行数据。"""
from pathlib import Path
from urllib.parse import unquote, urlsplit
import json
import re
import subprocess


def main():
    root = Path(__file__).resolve().parents[1]
    output = subprocess.check_output(
        ["git", "-c", "core.quotepath=false", "ls-files", "-z"], cwd=root
    ).decode("utf-8")
    tracked = {name for name in output.split("\0") if name}
    documents = sorted(p for p in tracked if p.endswith(".md") and (p.startswith("docs/") or p in {"AGENTS.md", "CONTEXT.md"}))
    errors = []
    links = 0
    for name in documents:
        path = root / name
        raw = path.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf"):
            errors.append(f"{name}: UTF-8 不能带 BOM")
        text = raw.decode("utf-8")
        if re.search(r"(?i)(?:ctx7sk-|\bsk-)[a-z0-9_-]{16,}", text):
            errors.append(f"{name}: 存在疑似凭据，禁止输出原值")
        for value in re.findall(r"\]\(([^)]+)\)", text):
            url = urlsplit(value)
            if url.scheme in {"http", "https", "mailto"} or value.startswith("#"):
                continue
            if url.scheme:
                errors.append(f"{name}: 不可移植的本机链接")
                continue
            target = (path.parent / unquote(url.path)).resolve()
            if not target.is_relative_to(root):
                errors.append(f"{name}: 引用了仓库外文件")
                continue
            rel = target.relative_to(root).as_posix()
            if rel not in tracked:
                errors.append(f"{name}: 未入库引用 {rel}")
            elif not target.is_file():
                errors.append(f"{name}: 引用目标缺失 {rel}")
            links += 1
    prd = (root / "docs/prd/AgentX_Desktop_PRD.md").read_text(encoding="utf-8")
    if re.findall(r"^#### (\S+)（", prd, re.M) != ["app-shell", "workbench", "settings"]:
        errors.append("PRD: 页面标识或顺序不符合三页基线")
    if "### 状态策略" not in prd or prd.index("### 状态策略") > prd.index("### 页面清单"):
        errors.append("PRD: 缺少页面清单之前的状态策略")
    locators = re.findall(r"^#{3,5} ([A-Z][A-Z0-9-]+)(?: |$)", prd, re.M)
    if len(locators) != len(set(locators)):
        errors.append("PRD: 定位词重复")
    sources = []
    for line in prd.splitlines():
        cells = [s.strip() for s in line.split("|")[1:-1]]
        if len(cells) == 3 and re.fullmatch(r"M1-0[1-6]", cells[0]):
            sources.append((cells[0], cells[1]))
    if len(sources) != 72 or len(sources) != len(set(sources)):
        errors.append("PRD: M1 的 72 条场景检查缺失或重复")
    print(json.dumps({"文档": len(documents), "仓库内链接": links, "M1 场景": len(sources), "错误": errors}, ensure_ascii=False, indent=2))
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
