import json, sys, os, html, argparse, datetime, re

TEMPLATE = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             'report_template.html'), encoding='utf-8').read()


def _parse_date(s):
    for fmt in ('%Y-%m-%d', '%Y/%m/%d', '%Y-%m', '%Y'):
        try:
            return datetime.datetime.strptime(s, fmt).date()
        except Exception:
            pass
    return None

def _freshness(publish, query):
    pd = _parse_date(publish) if publish else None
    qd = _parse_date(query) if query else None
    if not pd or not qd:
        return None
    days = (qd - pd).days
    if days < 0:
        days = 0
    if days <= 7:
        return {'fresh': 5, 'rot': 0}
    if days <= 15:
        return {'fresh': 4, 'rot': 1}
    if days <= 30:
        return {'fresh': 3, 'rot': 2}
    if days <= 60:
        return {'fresh': 2, 'rot': 3}
    if days <= 90:
        return {'fresh': 1, 'rot': 4}
    return {'fresh': 0, 'rot': 5}

# ---- duplicate detection: same company + date + position + location + recruitType ----
_PAREN = re.compile(r'[（(][^)）]*[)）]')
def _norm_company(s):
    return _PAREN.sub('', s or '').strip()
def _entry_key(e):
    return (
        _norm_company(e.get('company')),
        (e.get('queryDate') or '').strip(),
        (e.get('position') or '').strip(),
        (e.get('location') or '').strip(),
        (e.get('recruitType') or '社招').strip(),
    )

# ---- reusable render / data helpers (also used by the HTTP server) ----
def load_data(path):
    """Load the job-calendar data array, always returning a list."""
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            data = []
    else:
        data = []
    if not isinstance(data, list):
        data = []
    return data


def compute_freshness(data):
    """Recompute the `freshness` tomato-score for every position."""
    for d in data:
        for p in (d.get('localPositions') or []):
            fr = _freshness(p.get('publishDate'), d.get('queryDate'))
            if fr:
                p['freshness'] = fr
        for p in (d.get('otherCityPositions') or []):
            fr = _freshness(p.get('publishDate'), d.get('queryDate'))
            if fr:
                p['freshness'] = fr
    return data


def build_html(data):
    """Render the full HTML report from a data array."""
    return TEMPLATE.replace('___DATA___', json.dumps(data, ensure_ascii=False))


def render_report(data_path, html_path=None, write=False):
    """Load data, compute freshness, optionally persist HTML, return HTML string."""
    data = compute_freshness(load_data(data_path))
    out = build_html(data)
    if write and html_path:
        with open(html_path, 'w', encoding='utf-8') as f:
            f.write(out)
    return out


def delete_company(data_path, html_path, name):
    """Delete every record of a company (by normalized name) and re-render.

    Returns a result dict describing what happened. This is the single source
    of truth for deletion so the CLI, the HTTP API and (via the API) the UI
    all behave identically and persist to disk."""
    data = load_data(data_path)
    co = _norm_company(name)
    before = len(data)

    def _match(e):
        cn = _norm_company(e.get('company'))
        return cn == co or co in cn

    data = [e for e in data if not _match(e)]
    removed = before - len(data)
    with open(data_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    render_report(data_path, html_path, write=True)
    return {'deleted': removed, 'remaining': len(data), 'name': co, 'ok': True}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--entry', help='path to new entry json')
    ap.add_argument('--data', default='job_calendar_data.json')
    ap.add_argument('--html', default='job_calendar_report.html')
    ap.add_argument('--rerender', action='store_true', help='仅从 data 重渲染 HTML，不追加 entry')
    ap.add_argument('--delete', help='按归一化公司名删除其全部记录并重渲染（不追加 entry）')
    a = ap.parse_args()
    if a.delete:
        res = delete_company(a.data, a.html, a.delete)
        print('OK deleted=' + str(res['deleted']) + ' entries for ' + res['name'] +
              '; remaining=' + str(res['remaining']) + ' html=' + a.html)
        return
    if not a.rerender:
        if not a.entry:
            ap.error('--entry is required unless --rerender is set')
        data = load_data(a.data)
        with open(a.entry, 'r', encoding='utf-8') as f:
            entry = json.load(f)
        if not entry.get('queryDate'):
            entry['queryDate'] = datetime.date.today().isoformat()
        # --- dedup / merge ---
        # 规则：同一家公司 + 同一天，只保留「最后一次」搜索结果。
        #   - 5 元组完全一致（公司+日期+岗位+地点+社招校招）→ 视为重复，跳过、不追加；
        #   - 同公司+同日但条件不同 → 移除当天该家所有旧记录，仅保留本次最新结果。
        new_key = _entry_key(entry)
        new_co = _norm_company(entry.get('company'))
        new_date = (entry.get('queryDate') or '').strip()
        same_day = [e for e in data
                    if _norm_company(e.get('company')) == new_co
                    and (e.get('queryDate') or '').strip() == new_date]
        exact_dup = any(_entry_key(e) == new_key for e in same_day)
        if exact_dup:
            print('[SKIP] 已搜索过，无需重复搜索：' + new_co +
                  ' ' + (entry.get('position') or '') + ' ' + (entry.get('location') or '') +
                  ' ' + (entry.get('recruitType') or '社招') + ' @ ' + new_date)
            sys.exit(0)
        if same_day:
            # 不同条件同公司同日：丢弃当日旧记录，仅保留最新一次
            data = [e for e in data
                    if not (_norm_company(e.get('company')) == new_co
                            and (e.get('queryDate') or '').strip() == new_date)]
        data.append(entry)
        with open(a.data, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    render_report(a.data, a.html, write=True)
    print('OK entries=' + str(len(load_data(a.data))) + ' html=' + a.html)

if __name__ == '__main__':
    main()
