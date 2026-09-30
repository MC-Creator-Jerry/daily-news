# -*- coding: utf-8 -*-
"""
generate-news.py  (CLOUD / FREE edition)
========================================
Daily global-news generator that runs in GitHub Actions (or any cloud runner)
and costs NOTHING:

  * LLM backend : Cloudflare Workers AI (OpenAI-compatible /ai/v1/chat/completions)
                  default model @cf/meta/llama-4-scout-17b-16e-instruct  (FREE tier)
                  auth via env CF_API_TOKEN (GitHub Actions secret) or config api_key.
  * Real news   : Google News RSS (keyless, free) per section -> fed to the model as
                  "today's real signals" with the genuine outlet name as the source.
                  RSS is fetched at runtime; if it is unreachable we fall back to the
                  model's own knowledge (clearly the weakest path) instead of failing.
  * Runtime     : GitHub Actions cron (daily 09:00 Beijing). PC-independent.
  * Output      : writes YYYY-MM-DD.html + updates index.html "gotoNews" link +
                  dates.json, all in the repo root. The workflow commits & pushes.

Reuses the 13-section layout, template-fill and source/disclaimer logic from the
original generate-news-boot.py, but drops DeepSeek (paid) and the local deploy step.

Stdlib only (no pip installs) so it runs in the managed Python / GitHub Actions runner.
"""
import io, os, re, sys, json, html, datetime, urllib.request, urllib.error, urllib.parse

BASE = os.path.dirname(os.path.abspath(__file__))
TPL = os.path.join(BASE, "template.html")
CONFIG = os.path.join(BASE, "news-llm-cloud.json")
OUT_PREFIX = "每日全球要闻_"

# (zh, en, icon, img_slug|None)  -- order MUST match generate-news-boot.py SECTION_DEFS
# and the template's SECTION_KIND index order. 13 sections, 上热搜 first, 新产品发布 last.
SECTION_DEFS = [
    ("上热搜",       "Trending",                 "\U0001F525", None),
    ("军事",         "Military",                 "\U0001F396\uFE0F", "sec-military"),
    ("财经",         "Finance & Markets",        "\U0001F4B5", "sec-finance"),
    ("AI",           "Artificial Intelligence",  "\U0001F916", "sec-ai"),
    ("科技",         "Technology",               "\U0001F4BB", "sec-industry"),
    ("国际政治",     "International Politics",     "\U0001F30D", "sec-politics"),
    ("产业商业",     "Industry & Business",       "\U0001F3ED", "sec-industry"),
    ("能源与气候",   "Energy & Climate",          "\u26A1", "sec-energy"),
    ("医疗健康",     "Health & Medicine",         "\U0001F3E5", "sec-health"),
    ("半导体与硬件", "Semiconductors & Hardware", "\U00002699\uFE0F", "sec-semiconductor"),
    ("航天与空间",   "Space & Aerospace",        "\U0001F680", "sec-space"),
    ("新产品发布",   "New Product Launch",        "\U0001F4E6", None),
    ("社会与舆情",   "Society & Public Opinion",  "\U0001F4F1", "sec-society"),
]

# Google News RSS search queries per section (zh + en). These pull REAL, current
# headlines that we hand to the model as grounding so the digest reflects today's news.
SECTION_RSS = {
    "上热搜":     ["全球 热议", "trending news today"],
    "军事":       ["军事 冲突 演习", "military news"],
    "财经":       ["全球 财经 市场", "global markets economy"],
    "AI":         ["人工智能 AI 发布", "artificial intelligence news"],
    "科技":       ["科技 新品 突破", "technology news"],
    "国际政治":   ["国际 外交 政治", "world politics"],
    "产业商业":   ["产业 企业 商业", "industry business"],
    "能源与气候": ["能源 气候 碳中和", "energy climate"],
    "医疗健康":   ["医疗 健康 科研", "health medicine"],
    "半导体与硬件":["半导体 芯片", "semiconductor chip"],
    "航天与空间": ["航天 火箭 卫星", "space aerospace launch"],
    "新产品发布": ["新产品 发布", "new product launch"],
    "社会与舆情": ["社会 舆情", "society news"],
}

ITEM_NOTE_ZH = ("以上内容根据公开报道整理，仅供快速了解事件脉络。"
               "建议结合多家权威媒体与官方通报交叉核实，以获取更完整、准确的信息。"
               "我们将持续关注事态进展，并在后续更新中补充关键变化与影响。"
               "本条信息仅供参考，不构成任何投资、决策或行动建议，请以权威发布为准。")
ITEM_NOTE_EN = ("The above is compiled from public reports to help you quickly grasp the event context. "
               "We recommend cross-checking with multiple authoritative media and official statements for completeness and accuracy. "
               "We will keep monitoring developments and add key changes and impacts in later updates. "
               "This information is for reference only and does not constitute investment, decision, or action advice; please rely on authoritative releases.")

WEEKDAYS_ZH = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


def log(msg):
    print("[%s] %s" % (datetime.datetime.now().strftime("%H:%M:%S"), msg), flush=True)


def esc_attr(s):
    return (s.replace("&", "&amp;").replace('"', "&quot;")
             .replace("<", "&lt;").replace(">", "&gt;"))


def esc_text(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


DEFAULT_SOURCE_ZH = "出处：综合外电报道"
DEFAULT_SOURCE_EN = "Source: multiple wire reports"


# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
def load_config():
    if not os.path.exists(CONFIG):
        log("ERROR: config not found: %s" % CONFIG)
        return None
    try:
        with io.open(CONFIG, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception as e:
        log("ERROR: cannot parse config: %s" % e)
        return None
    # Token precedence: env CF_API_TOKEN -> config api_key.
    env_key = os.environ.get("CF_API_TOKEN", "").strip()
    if env_key:
        cfg["api_key"] = env_key
    for k in ("api_base", "api_key", "model"):
        if not cfg.get(k):
            log("ERROR: config missing required field: %s" % k)
            return None
    cfg.setdefault("timeout", 120)
    cfg.setdefault("max_items", 4)
    cfg.setdefault("min_items", 3)
    cfg.setdefault("body_min_chars", 700)
    cfg.setdefault("body_max_chars", 900)
    cfg.setdefault("max_tokens", 6000)
    cfg.setdefault("section_retries", 2)
    return cfg


# --------------------------------------------------------------------------- #
# LLM (Cloudflare Workers AI, OpenAI-compatible)
# --------------------------------------------------------------------------- #
def call_llm(cfg, system, user):
    url = cfg["api_base"].rstrip("/") + "/chat/completions"
    body = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.7,
        "max_tokens": cfg.get("max_tokens", 6000),
    }
    # Ask for strict JSON when the endpoint supports it; we also parse robustly.
    body["response_format"] = {"type": "json_object"}
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer %s" % cfg["api_key"])

    log("Calling CF Workers AI %s ..." % cfg["model"])
    try:
        with urllib.request.urlopen(req, timeout=cfg["timeout"]) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        log("ERROR: HTTP %s from LLM API: %s" % (e.code, e.read().decode("utf-8", "ignore")[:400]))
        return None
    except Exception as e:
        log("ERROR: LLM request failed: %s" % e)
        return None
    try:
        j = json.loads(raw)
        return j["choices"][0]["message"]["content"]
    except Exception as e:
        log("ERROR: cannot parse LLM envelope: %s" % e)
        return None


def extract_json(text):
    if not text:
        return None
    text = text.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if m:
        text = m.group(1).strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    s = text.find("{")
    e = text.rfind("}")
    if s != -1 and e != -1 and e > s:
        try:
            return json.loads(text[s:e + 1])
        except Exception:
            return None
    return None


# --------------------------------------------------------------------------- #
# Real-news grounding via Google News RSS (keyless, free)
# --------------------------------------------------------------------------- #
def fetch_rss(zh_query, en_query, max_items=4):
    """Return a list of {title, source, snippet} from Google News RSS for the
    given queries. Returns [] on any failure (caller falls back to model knowledge)."""
    signals = []
    seen = set()
    for q in (zh_query, en_query):
        if len(signals) >= max_items:
            break
        u = ("https://news.google.com/rss/search?q=" + urllib.parse.quote(q) +
             "&hl=zh-CN&gl=CN&ceid=CN:zh-Hans")
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=20) as r:
                data = r.read().decode("utf-8", "ignore")
        except Exception as e:
            log("  RSS fetch failed for %r: %s" % (q, e))
            continue
        # crude RSS parse (no external deps)
        for item in re.findall(r"<item>(.*?)</item>", data, re.S):
            title = re.search(r"<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>", item, re.S)
            src = re.search(r"<source[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</source>", item, re.S)
            desc = re.search(r"<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</description>", item, re.S)
            t = title.group(1).strip() if title else ""
            if not t or t in seen:
                continue
            seen.add(t)
            s = src.group(1).strip() if src else ""
            d = re.sub(r"<[^>]+>", "", desc.group(1)).strip() if desc else ""
            signals.append({"title": t, "source": s, "snippet": d[:240]})
            if len(signals) >= max_items:
                break
    return signals


# --------------------------------------------------------------------------- #
# Prompt builders
# --------------------------------------------------------------------------- #
def build_section_system():
    return ("你是一位专业的双语（中文/英文）全球新闻编辑，擅长把真实线索写成有深度、"
            "结构清晰、事实可核实的长篇报道。你必须只返回一个合法的 JSON 对象，不要任何多余文字。")


def build_section_user(zh, en, min_items, max_items, body_min, body_max, signals):
    sig_block = ""
    if signals:
        sig_block = ("\n以下是「今日真实信号」（来自 Google News RSS，来源已标注，仅作事实素材，"
                     "请勿照搬原文，用你自己的话深度展开）：\n")
        for i, s in enumerate(signals, 1):
            sig_block += ("  %d) [%s] %s\n     摘要：%s\n" %
                          (i, s.get("source") or "未知来源", s.get("title", ""),
                           s.get("snippet", "")))
    else:
        sig_block = ("\n（未能取到 RSS 实时信号，请基于你掌握的最新可靠信息撰写，并在不确定处措辞谨慎。）\n")
    return (
        "为「%s (%s)」领域撰写今日（%s）的深度新闻条目，数量 %d-%d 条，按重要性排序。\n"
        "%s\n"
        "每条是一个迷你深度报道（不是短讯）。每条提供：\n"
        "  - t_zh / t_en：简洁双语标题（zh 不超过约 40 字）。\n"
        "  - b_zh：中文深度正文 %d-%d 字，自然流畅、逻辑递进（可分段，像一篇完整报道，避免四段割裂模板）。\n"
        "  - b_en：对应英文深度正文，同等深度。\n"
        "  - s_zh / s_en：本条真实来源（媒体/机构名，多个用「、」分隔，如 新华社、央视新闻 / Reuters, AP）。"
        "必须来自上面的真实信号或你确知的可核实来源；查不到具体来源的写「综合外电报道」/「multiple wire reports」，禁止编造来源。\n"
        "  - imgs：固定为 []（图片由生成器统一挂载已审核实拍图，不要填外部链接）。\n"
        "只返回严格 JSON：{\"items\":[{\"t_zh\":\"...\",\"t_en\":\"...\",\"b_zh\":\"...\",\"b_en\":\"...\",\"s_zh\":\"...\",\"s_en\":\"...\",\"imgs\":[]}]}。\n"
        "信息须真实可核实、优先当日或近周高价值事件，禁止编造；不确定处措辞谨慎。"
    ) % (zh, en, "今日", min_items, max_items, sig_block, body_min, body_max)


def build_overview_system():
    return ("你是专业双语新闻编辑，产出简洁的双语每日综述与结尾。只返回合法 JSON 对象。")


def build_overview_user(top_titles):
    bullets = "\n".join("  - %s / %s" % (tz, te) for tz, te in top_titles)
    return ("今日要闻各领域的头条如下：\n%s\n"
            "写一段双语核心综述（summary_zh / summary_en，2-3 段，综合当日主题）和一句中性双语结尾"
            "（closing_zh / closing_en）。只返回严格 JSON："
            '{"summary_zh":"...","summary_en":"...","closing_zh":"...","closing_en":"..."}。'
            "不要编造具体事件，只用上面标题在主题层综合。" ) % bullets


# --------------------------------------------------------------------------- #
# HTML build (reuses original structure)
# --------------------------------------------------------------------------- #
def generate_section(cfg, zh, en, img_slug):
    sys_p = build_section_system()
    # RSS grounding (one combined call for the section's zh+en queries)
    queries = SECTION_RSS.get(zh, [zh, en])
    signals = []
    if queries:
        signals = fetch_rss(queries[0], queries[-1])
        if signals:
            log("  RSS signals for %s: %d" % (zh, len(signals)))
    usr_p = build_section_user(zh, en, cfg["min_items"], cfg["max_items"],
                               cfg["body_min_chars"], cfg["body_max_chars"], signals)
    for attempt in range(1 + int(cfg.get("section_retries", 1))):
        content = call_llm(cfg, sys_p, usr_p)
        if not content:
            log("WARN: section %s no content (attempt %d)." % (zh, attempt + 1))
            continue
        data = extract_json(content)
        items = data.get("items") if isinstance(data, dict) else None
        if not items:
            log("WARN: section %s no items (attempt %d)." % (zh, attempt + 1))
            continue
        # auto-attach the pre-approved section photo (real CC scenery, no AI/fake images)
        for it in items:
            if img_slug and not it.get("imgs"):
                it["imgs"] = ["img/%s.jpg" % img_slug]
        return {"zh": zh, "en": en, "items": items}
    log("ERROR: section %s failed after retries." % zh)
    return None


def build_sections_html(sections_json):
    out = []
    for idx, (zh, en, icon, img_slug) in enumerate(SECTION_DEFS):
        block = sections_json[idx] if idx < len(sections_json) else None
        items = block.get("items", []) if isinstance(block, dict) else []
        sid = "sec%d" % idx
        out.append('  <div class="section-card" id="%s">' % sid)
        out.append('    <div class="section-header" onclick="toggleSection(\'%s\')">' % sid)
        out.append('      <img src="" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.style.display=\'none\'">')
        out.append('      <div class="section-titlebar">')
        out.append('        <span class="section-title" data-zh="%s" data-en="%s"><span class="section-icon">%s</span>%s</span>'
                   % (esc_attr(zh), esc_attr(en), icon, esc_text(zh)))
        out.append('        <span class="section-actions">')
        out.append('          <button class="fold-btn" onclick="event.stopPropagation();toggleSection(\'%s\')" id="fold-%s">\u25BC</button>' % (sid, sid))
        out.append('          <button class="fold-btn" onclick="event.stopPropagation();expandSectionItems(\'%s\')" title="展开具体内容">\U0001F4D6</button>' % sid)
        out.append('          <button class="tts-btn" onclick="event.stopPropagation();speakSection(\'%s\')" title="\u8BFB\u8070\u672C\u8282">\U0001F50A</button>' % sid)
        out.append('        </span>')
        out.append('      </div>')
        out.append('    </div>')
        out.append('    <div class="section-body" id="body-%s">' % sid)
        for i, it in enumerate(items):
            iid = "item-%s-%d" % (sid, i)
            tzh = "%d. %s" % (i + 1, it.get("t_zh", ""))
            ten = "%d. %s" % (i + 1, it.get("t_en", ""))
            bzh = it.get("b_zh", "")
            ben = it.get("b_en", "")
            out.append('      <div class="item" id="%s">' % iid)
            out.append('        <div class="item-title" onclick="toggleItem(\'%s\')">' % iid)
            out.append('          <strong data-zh="%s" data-en="%s">%s</strong>'
                       % (esc_attr(tzh), esc_attr(ten), esc_text(tzh)))
            out.append('          <span class="item-actions">')
            out.append('            <button class="fold-btn" id="fold-%s" onclick="event.stopPropagation();toggleItem(\'%s\')">\u25BC</button>' % (iid, iid))
            out.append('            <button class="zoom-btn" id="zoom-%s" onclick="event.stopPropagation();toggleZoomItem(\'%s\')" title="\u653E\u5927/\u7F29\u5C0F\u5B57\u4F53">\u25A1</button>' % (iid, iid))
            out.append('            <button class="fs-btn" id="fs-%s" onclick="event.stopPropagation();toggleFsItem(\'%s\')" title="\u653E\u5927\u8BE5\u5185\u5BB9\u81F3\u7F51\u9875\u5168\u5C4F">\u26F6</button>' % (iid, iid))
            out.append('          </span>')
            out.append('        </div>')
            out.append('        <div class="item-body" data-zh="%s" data-en="%s">%s</div>'
                       % (esc_attr(bzh), esc_attr(ben), esc_text(bzh)))
            imgs = it.get("imgs") or []
            if isinstance(imgs, str):
                imgs = [imgs]
            figs = []
            for u in imgs[:2]:
                u = (u or "").strip()
                if not u:
                    continue
                alt = (it.get("t_zh") or "").split(".", 1)[-1].strip()
                figs.append('          <img class="item-figure" src="%s" alt="%s" loading="lazy" decoding="async" onerror="this.onerror=null;this.style.display=\'none\'">'
                            % (esc_attr(u), esc_attr(alt)))
            if figs:
                out.append('        <div class="item-figs">')
                out.extend(figs)
                out.append('        </div>')
            szh = (it.get("s_zh") or "").strip()
            sen = (it.get("s_en") or "").strip()
            if not szh:
                szh = DEFAULT_SOURCE_ZH
            elif not szh.startswith("出处"):
                szh = "出处：" + szh
            if not sen:
                sen = DEFAULT_SOURCE_EN
            elif not sen.lower().startswith("source"):
                sen = "Source: " + sen
            out.append('        <div class="item-source" data-zh="%s" data-en="%s">%s</div>'
                       % (esc_attr(szh), esc_attr(sen), esc_text(szh)))
            out.append('      </div>')
        out.append('    </div>')
        out.append('  </div>')
    return "\n".join(out)


def fill_template(sections_html, date_str, weekday_zh, summary_zh, summary_en, closing_zh, closing_en):
    with io.open(TPL, "r", encoding="utf-8") as f:
        tpl = f.read()
    new_summary = '    <p id="summaryBody" data-zh="%s" data-en="%s">%s</p>' % (
        esc_attr(summary_zh), esc_attr(summary_en), esc_text(summary_zh))
    old_re = re.compile(r'^[ \t]*<p id="summaryBody">\{ \{SUMMARY_BODY\}\}</p>[ \t]*$', re.M)
    # tolerate both spaced and unspaced placeholder forms
    old_re = re.compile(r'^[ \t]*<p id="summaryBody">\{\{SUMMARY_BODY\}\}</p>[ \t]*$', re.M)
    if not old_re.search(tpl):
        log("ERROR: summaryBody placeholder not found in template")
        return None
    tpl = old_re.sub(lambda m: new_summary, tpl, count=1)
    tpl = tpl.replace('<div class="closing" id="closingText">{{CLOSING_TEXT}}</div>',
                      '<div class="closing" id="closingText" data-zh="%s" data-en="%s">%s</div>'
                      % (esc_attr(closing_zh), esc_attr(closing_en), esc_text(closing_zh)))
    tpl = tpl.replace("{{SECTIONS_HTML}}", sections_html)
    tpl = tpl.replace("{{DATE}}", date_str)
    tpl = tpl.replace("{{WEEKDAY}}", weekday_zh)
    disc = ('<p data-zh="%s" data-en="%s">%s</p>'
            % (esc_attr(ITEM_NOTE_ZH), esc_attr(ITEM_NOTE_EN), esc_text(ITEM_NOTE_ZH)))
    tpl = tpl.replace("{{DISCLAIMER_HTML}}", disc)
    left = re.findall(r"\{\{[A-Z_]+\}\}", tpl)
    if left:
        log("ERROR: leftover placeholders: %s" % left)
        return None
    return tpl


def update_index_latest(date_str):
    p = os.path.join(BASE, "index.html")
    if not os.path.exists(p):
        return
    t = io.open(p, "r", encoding="utf-8").read()
    new_t = re.sub(r'(id="gotoNews"[^>]*href=")[^"]*(")',
                   r'\g<1>%s.html\g<2>' % date_str, t)
    if new_t != t:
        io.open(p, "w", encoding="utf-8", newline="\n").write(new_t)
        log("Updated index.html gotoNews -> %s.html" % date_str)


def update_dates_json(date_str):
    p = os.path.join(BASE, "dates.json")
    try:
        with io.open(p, "r", encoding="utf-8") as f:
            manifest = json.load(f)
    except Exception:
        manifest = {"updated": "", "dates": []}
    dates = manifest.get("dates", [])
    if not any(d.get("date") == date_str for d in dates):
        dates.insert(0, {"date": date_str, "file": "%s.html" % date_str})
    dates.sort(key=lambda d: d.get("date", ""), reverse=True)
    manifest["dates"] = dates
    manifest["updated"] = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S%z")
    with io.open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))
    log("Updated dates.json (%d entries)" % len(dates))


def clean_old_root(today):
    keep_before = today.date() - datetime.timedelta(days=1)
    removed = []
    for name in os.listdir(BASE):
        m = re.match(r"^%s(\d{4}-\d{2}-\d{2})\.(html)$" % re.escape(OUT_PREFIX), name)
        if not m:
            continue
        try:
            d = datetime.datetime.strptime(m.group(1), "%Y-%m-%d").date()
        except Exception:
            continue
        if d < keep_before:
            try:
                os.remove(os.path.join(BASE, name))
                removed.append(name)
            except Exception as e:
                log("WARN: cannot remove %s: %s" % (name, e))
    if removed:
        log("Cleaned old files: %s" % ", ".join(removed))


def main():
    force = "--force" in sys.argv
    smoke = "--smoke" in sys.argv   # only generate first 2 sections (local test)
    today = datetime.datetime.now()
    date_str = today.strftime("%Y-%m-%d")
    weekday_zh = WEEKDAYS_ZH[today.weekday()]
    out_path = os.path.join(BASE, "%s%s.html" % (OUT_PREFIX, date_str))

    if os.path.exists(out_path) and not force and not smoke:
        log("Today's file already exists: %s (use --force to regenerate)" % out_path)
        return 0

    cfg = load_config()
    if not cfg:
        return 2

    defs = SECTION_DEFS[:2] if smoke else SECTION_DEFS
    sections_json = []
    for zh, en, icon, img_slug in defs:
        block = generate_section(cfg, zh, en, img_slug)
        if block is None:
            log("WARN: section %s generation failed; emitting empty section." % zh)
            block = {"zh": zh, "en": en, "items": []}
        sections_json.append(block)

    if smoke:
        # smoke test: just validate one section's JSON + HTML fragment
        log("SMOKE OK: %d section(s) generated." % len(sections_json))
        total = sum(len(b.get("items", [])) for b in sections_json)
        log("SMOKE items: %d" % total)
        return 0

    top_titles = []
    for b in sections_json:
        for it in b.get("items", [])[:2]:
            top_titles.append((it.get("t_zh", ""), it.get("t_en", "")))
    ov_content = call_llm(cfg, build_overview_system(), build_overview_user(top_titles))
    ov = extract_json(ov_content) if ov_content else None
    if not isinstance(ov, dict):
        log("WARN: overview JSON bad; using empty summary/closing.")
        ov = {}
    summary_zh = ov.get("summary_zh", "")
    summary_en = ov.get("summary_en", "")
    closing_zh = ov.get("closing_zh", "")
    closing_en = ov.get("closing_en", "")

    total_items = sum(len(b.get("items", [])) for b in sections_json)
    log("Assembled %d sections, %d items." % (len(sections_json), total_items))

    sections_html = build_sections_html(sections_json)
    out = fill_template(sections_html, date_str, weekday_zh,
                        summary_zh, summary_en, closing_zh, closing_en)
    if not out:
        return 5

    with io.open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(out)
    log("Wrote %s (%d bytes)" % (out_path, os.path.getsize(out_path)))

    update_index_latest(date_str)
    update_dates_json(date_str)
    clean_old_root(today)
    log("DONE. (workflow will commit & push)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
