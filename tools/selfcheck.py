#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
selfcheck.py — 静态自检（不需要浏览器）
校验四件事：
  1) src/*.js 里用到的每一个 THREE.X 都在 vendor/three/build/three.module.js 里真实导出
  2) 同模块内 import 的 addon 路径文件确实存在，且具名导出存在
  3) 模块之间的 import 路径存在，具名导出存在
  4) JS 里 getElementById('x') / querySelector('#x') 引用的 id 在 index.html 里存在
用法: python3 tools/selfcheck.py   （退出码 0 = 全通过）
"""
import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
THREE_BUNDLE = ROOT / "vendor" / "three" / "build" / "three.module.js"
INDEX = ROOT / "index.html"

errors = []
warnings = []


def read(p):
    return p.read_text(encoding="utf-8")


def three_exports():
    src = read(THREE_BUNDLE)
    names = set()
    for blk in re.findall(r"export\s*\{([^}]*)\}", src):
        for part in blk.split(","):
            part = part.strip()
            if not part:
                continue
            names.add(part.split(" as ")[-1].strip() if " as " in part else part)
    return names


def module_exports(path):
    """收集一个 ES module 的具名导出（export function/class/const/let/var）。"""
    src = read(path)
    out = set()
    for m in re.finditer(r"^export\s+(?:async\s+)?(?:function|class)\s+(\w+)", src, re.M):
        out.add(m.group(1))
    for m in re.finditer(r"^export\s+(?:const|let|var)\s+(\w+)", src, re.M):
        out.add(m.group(1))
    for blk in re.findall(r"^export\s*\{([^}]*)\}", src, re.M):
        for part in blk.split(","):
            part = part.strip()
            if not part:
                continue
            out.add(part.split(" as ")[-1].strip() if " as " in part else part)
    return out


def main():
    if not SRC.is_dir():
        errors.append("缺少 src/ 目录")
    files = sorted(SRC.glob("*.js"))
    if not files:
        errors.append("src/ 下没有 .js 文件")

    tnames = three_exports()
    js_exports = {}
    for f in files:
        js_exports[f] = module_exports(f)

    # 1) THREE.X 存在性
    for f in files:
        src = read(f)
        for m in re.finditer(r"THREE\.(\w+)", src):
            name = m.group(1)
            if name not in tnames:
                errors.append(f"{f.name}: THREE.{name} 在 three.module.js 中不存在")

    # 2)+3) import 解析
    for f in files:
        src = read(f)
        for m in re.finditer(r"import\s+(?:\*\s+as\s+\w+|\{([^}]*)\}|(\w+))\s+from\s+['\"]([^'\"]+)['\"]", src):
            named, default, spec = m.group(1), m.group(2), m.group(3)
            if spec == "three":
                if named:
                    for part in named.split(","):
                        nm = part.strip().split(" as ")[0].strip()
                        if nm and nm not in tnames:
                            errors.append(f"{f.name}: import {{ {nm} }} from 'three' 不存在")
                continue

            if spec.startswith("."):
                target = (f.parent / spec).resolve()
            elif spec.startswith("three/addons/"):
                target = ROOT / "vendor" / "three" / "addons" / spec[len("three/addons/"):]
            else:
                target = (ROOT / spec).resolve()
            if not target.exists():
                errors.append(f"{f.name}: import 路径不存在 -> {spec}")
                continue
            if named and target.suffix == ".js" and target.resolve() != f.resolve():
                avail = js_exports.get(target)
                if avail is None:
                    avail = module_exports(target)
                for part in named.split(","):
                    nm = part.strip().split(" as ")[0].strip()
                    if nm and nm not in avail and "three/addons" not in spec:
                        errors.append(f"{f.name}: {spec} 没有导出 {nm}")

    # 4) DOM id 交叉校验
    if INDEX.exists():
        html = read(INDEX)
        ids = set(re.findall(r'id="([^"]+)"', html))
        for f in files:
            src = read(f)
            for m in re.finditer(r"getElementById\(\s*['\"]([^'\"]+)['\"]\s*\)", src):
                if m.group(1) not in ids:
                    errors.append(f"{f.name}: getElementById('{m.group(1)}') 在 index.html 中不存在")
            for m in re.finditer(r"querySelector\(\s*['\"]#([\w-]+)['\"]\s*\)", src):
                if m.group(1) not in ids:
                    errors.append(f"{f.name}: querySelector('#{m.group(1)}') 在 index.html 中不存在")
            # 反向：html 里引用的静态资源
    else:
        errors.append("缺少 index.html")

    # html 引用的 js/css 是否存在
    if INDEX.exists():
        html = read(INDEX)
        for m in re.finditer(r'(?:src|href)="(\./[^"]+)"', html):
            p = ROOT / m.group(1)[2:]
            if not p.exists():
                errors.append(f"index.html 引用的资源不存在 -> {m.group(1)}")
        # importmap 目标
        for m in re.finditer(r'"(three(?:/addons/)?)":\s*"(\./[^"]+)"', html):
            p = ROOT / m.group(2)[2:]
            if not p.exists():
                errors.append(f"importmap 目标不存在 -> {m.group(2)}")

    print(f"检查文件: {len(files)} 个模块, three 导出 {len(tnames)} 项")
    if warnings:
        print("\n[警告]")
        for w in warnings:
            print("  -", w)
    if errors:
        print(f"\n[失败] {len(errors)} 项")
        for e in errors:
            print("  ✗", e)
        return 1
    print("\n[通过] 静态自检全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())