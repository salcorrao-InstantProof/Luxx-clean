"""LUXX v1.7.0 RC3 — MOBILE / iPHONE ACCEPTANCE  (audit part 2, section 34)

Every primary screen, modal and control is opened at both required viewports and audited
for the things that actually break a phone: horizontal scrolling, controls pushed out of
reach, unreadable text, tap targets that cannot be hit, badges covering the image, and a
modal whose close button has scrolled away.

Runs on Chromium, and additionally on WebKit when Playwright has it installed (WebKit is
the engine iOS Safari actually uses). A missing WebKit is reported, never silently
skipped as if it had passed.

Run:  python tests/mobile-acceptance.py
"""
import json, os, pathlib, re, subprocess, sys, tempfile
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
html = (ROOT / 'public/index.html').read_text()

VIEWPORTS = [
    {'name': 'iPhone 12/13/14 (390x844)', 'width': 390, 'height': 844},
    {'name': 'iPhone 14/15 Pro Max (430x932)', 'width': 430, 'height': 932},
]
MIN_TAP = 30          # CSS px; below this a control is not reliably tappable
MIN_FONT = 11         # CSS px; below this body text is not readable on a phone

report = {'pass': False, 'engines': [], 'viewports': [v['name'] for v in VIEWPORTS],
          'screens': [], 'findings': [], 'page_errors': [], 'console_errors': [],
          'webkit': 'not attempted'}

tmp = pathlib.Path(tempfile.mkdtemp(prefix='luxx-mobile-'))
FFMPEG = os.environ.get('LUXX_FFMPEG_PATH', '/usr/bin/ffmpeg')
fixture = tmp / 'fixture.png'
subprocess.run([FFMPEG, '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=240x320', '-frames:v', '1', str(fixture)],
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
PNG = fixture.read_bytes()

state = {}
assets = []

def domain_call(op, payload):
    proc = subprocess.run(['node', str(ROOT / 'tests/domain-bridge.mjs')],
                          input=json.dumps({'state': state, 'assets': assets, 'op': op, 'payload': payload}),
                          capture_output=True, text=True, cwd=str(ROOT))
    if proc.returncode != 0:
        raise RuntimeError('domain bridge crashed: ' + proc.stderr[-1500:])
    out = json.loads(proc.stdout)
    state.clear(); state.update(out['state'])
    return out

def variant(vid, asset_id, vtype, **extra):
    v = {'variant_id': vid, 'asset_id': asset_id, 'variant_type': vtype, 'rendered': True,
         'privacy_safe_export': True, 'metadata_stripped': True,
         'thumbnail_key': 'thumb/%s/%s.jpg' % (asset_id, vid),
         'recipe': {'mode': 'AUTO_BEST', 'aspect': 'ORIGINAL', 'processing_version': 'ORIENTATION_VERIFIED_V3'},
         'orientation_verified': True, 'evidence_label': 'TECHNICAL HEURISTIC'}
    v.update(extra)
    return v

assets.extend([
    {'asset_id': 'IMG-M1', 'media_type': 'IMAGE', 'name': 'mobile-one.png', 'type': 'image/png', 'size': 100,
     'parts': 1, 'status': 'READY_FOR_REVIEW', 'authorization_status': 'AUTHORIZED', 'availability': 'AVAILABLE',
     'historical_usage_status': 'PROSPECTIVE', 'platform_eligibility': [], 'notes': '',
     'master_sha256': 'aaa111', 'thumbnail_key': 'thumb/IMG-M1/thumb.jpg', 'uploaded_at': '2026-09-05T10:00:00Z',
     'visual_score': {'score': 78.4}, 'variants': [variant('IMG-M1-SAFE', 'IMG-M1', 'PRIVACY_SAFE_EXPORT')]},
    {'asset_id': 'IMG-M2', 'media_type': 'IMAGE', 'name': 'mobile-two.png', 'type': 'image/png', 'size': 120,
     'parts': 1, 'status': 'READY_FOR_REVIEW', 'authorization_status': 'AUTHORIZED', 'availability': 'AVAILABLE',
     'historical_usage_status': 'PROSPECTIVE', 'platform_eligibility': [], 'notes': '',
     'master_sha256': 'bbb222', 'thumbnail_key': 'thumb/IMG-M2/thumb.jpg', 'uploaded_at': '2026-09-05T10:30:00Z',
     'visual_score': {'score': 71.2}, 'variants': [variant('IMG-M2-SAFE', 'IMG-M2', 'PRIVACY_SAFE_EXPORT')]},
    {'asset_id': 'VID-M1', 'media_type': 'VIDEO', 'name': 'mobile-video.mp4', 'type': 'video/mp4', 'size': 1000,
     'parts': 1, 'status': 'READY_FOR_REVIEW', 'authorization_status': 'AUTHORIZED', 'availability': 'AVAILABLE',
     'historical_usage_status': 'PROSPECTIVE', 'platform_eligibility': ['Pornhub', 'OnlyFans Paid'], 'notes': '',
     'master_sha256': 'ccc333', 'thumbnail_key': 'thumb/VID-M1/thumb.jpg', 'uploaded_at': '2026-09-05T11:00:00Z',
     'analysis': {'duration_seconds': 902},
     'variants': [
        variant('FULL-MASTER', 'VID-M1', 'FULL_MASTER', duration_seconds=902, final_runtime=902,
                start_seconds=0, start_timestamp='0', end_timestamp='902',
                thumbnail_frame_timestamp_or_reference='0.5s', title_direction='T', description_direction='D',
                cta='Open the full drop.', tracking_route_id='PH_VIDEO_DESC_TO_OF_FREE_01', platform='Pornhub'),
        variant('TEASER-1', 'VID-M1', 'TEASER', duration_seconds=20, final_runtime=20,
                start_seconds=100, start_timestamp='100', end_timestamp='120',
                thumbnail_frame_timestamp_or_reference='0.5s', title_direction='T', description_direction='D',
                cta='Full scene on OnlyFans Free.', tracking_route_id='PH_VIDEO_DESC_TO_OF_FREE_01', platform='Pornhub')]}
])

def handler(route, request):
    u = urlparse(request.url); p = u.path
    if p in ('/', '/index.html'):
        return route.fulfill(body=html, headers={'content-type': 'text/html; charset=utf-8'})
    if p == '/api/session':
        return route.fulfill(json={'authenticated': True, 'configured': True})
    if p in ('/api/login', '/api/logout'):
        return route.fulfill(json={'ok': True})
    if p == '/api/health':
        return route.fulfill(json={'version': '1.7.0-rc3', 'parent': {'name': 'LUXX'}, 'features': {}})
    if p == '/api/state':
        if not state:
            domain_call('BASELINE_COVERAGE', {})
        return route.fulfill(json={'state': state})
    if p == '/api/assets':
        return route.fulfill(json={'assets': assets, 'total': len(assets), 'next_cursor': None})
    if p == '/api/assets-index':
        return route.fulfill(json={'signature': 'mobile'})
    if p == '/api/action':
        body = json.loads(request.post_data or '{}')
        out = domain_call(body.get('op'), body.get('payload') or {})
        if not out['ok']:
            return route.fulfill(status=400, json={'error': out['error']})
        return route.fulfill(json={'ok': True, 'result': out['result'], 'state': state})
    if p == '/api/media-chunk':
        return route.fulfill(body=PNG, headers={'content-type': 'image/png'})
    if p == '/api/download-manifest':
        return route.fulfill(json={'parts': [{'url': '/api/media-chunk?key=x'}], 'type': 'image/png', 'name': 'f.png'})
    if p == '/api/hls':
        return route.fulfill(body='#EXTM3U\n#EXT-X-ENDLIST\n', headers={'content-type': 'application/vnd.apple.mpegurl'})
    if p == '/api/settings':
        state.setdefault('settings', {}).update(json.loads(request.post_data or '{}'))
        return route.fulfill(json={'ok': True, 'settings': state['settings']})
    if p in ('/api/asset-update', '/api/asset-batch-update', '/api/variant-update', '/api/kick-media-job'):
        return route.fulfill(json={'ok': True})
    if p == '/api/image-edit':
        return route.fulfill(json={'ok': True, 'variant': variant('E1', 'IMG-M1', 'MANUAL_EDIT')})
    if p == '/api/export-data':
        return route.fulfill(body=json.dumps(state), headers={'content-type': 'application/json',
                                                              'content-disposition': 'attachment; filename="x.json"'})
    return route.fulfill(status=404, body='mock missing ' + p)


def audit_layout(page, screen, vp, findings):
    """The checks that actually decide whether a phone can be used."""
    m = page.evaluate("""() => {
        const de = document.documentElement, b = document.body;
        const w = de.clientWidth;
        // Any element whose box extends past the viewport is a horizontal-scroll source,
        // even when an ancestor clips it: on a phone it is still content the creator
        // cannot see or reach.
        const wide = [];
        for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const st = getComputedStyle(el);
            if (st.display === 'none' || st.visibility === 'hidden' || st.position === 'fixed') continue;
            if (r.right > w + 1 || r.left < -1) {
                wide.push([(el.id ? '#' + el.id : el.className || el.tagName).toString().slice(0, 40),
                           Math.round(r.left), Math.round(r.right)]);
            }
        }
        return { scrollW: Math.max(de.scrollWidth, b.scrollWidth), clientW: w, wide: wide.slice(0, 6) };
    }""")
    if m['scrollW'] > m['clientW'] + 1:
        findings.append(f"{vp['name']} · {screen}: horizontal scrolling ({m['scrollW']}px in {m['clientW']}px)")
    for label, left, right in m['wide']:
        findings.append(f"{vp['name']} · {screen}: element {label} extends beyond the viewport ({left}..{right} of {m['clientW']})")

    # Every visible control must be inside the viewport and big enough to hit.
    bad = page.evaluate("""(minTap) => {
        const out = [];
        const w = document.documentElement.clientWidth;
        for (const el of document.querySelectorAll('button, a, select, input, textarea')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            const label = (el.id ? '#' + el.id : (el.textContent || el.tagName)).trim().slice(0, 40);
            if (r.right > w + 1 || r.left < -1) out.push(['offscreen', label, Math.round(r.left) + '..' + Math.round(r.right)]);
            else if (r.height < minTap && el.tagName === 'BUTTON') out.push(['tiny', label, Math.round(r.height) + 'px']);
        }
        return out;
    }""", MIN_TAP)
    for kind, label, detail in bad:
        findings.append(f"{vp['name']} · {screen}: {kind} control {label} ({detail})")

    # Body text must be readable.
    small = page.evaluate("""(minFont) => {
        const out = [];
        for (const el of document.querySelectorAll('.tiny, .line, .pickWhy, .jobLabel, p, li')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || !el.textContent.trim()) continue;
            const size = parseFloat(getComputedStyle(el).fontSize);
            if (size < minFont) out.push([el.className || el.tagName, size]);
        }
        return out.slice(0, 5);
    }""", MIN_FONT)
    for cls, size in small:
        findings.append(f"{vp['name']} · {screen}: text too small in .{cls} ({size}px)")

    # Overlay badges must not materially cover the image they sit on.
    over = page.evaluate("""() => {
        const out = [];
        for (const b of document.querySelectorAll('.optimizedBadge, .recommendedBadge, .cropChip')) {
            const hero = b.closest('.mediaHero');
            if (!hero) continue;
            const br = b.getBoundingClientRect(), hr = hero.getBoundingClientRect();
            if (!hr.width || !hr.height) continue;
            const frac = (br.width * br.height) / (hr.width * hr.height);
            if (frac > 0.12) out.push([b.className, Math.round(frac * 100)]);
            if (br.height > 24) out.push([b.className + ' (tall)', Math.round(br.height)]);
        }
        return out;
    }""")
    for cls, val in over:
        findings.append(f"{vp['name']} · {screen}: badge {cls} covers/oversized ({val})")
    report['screens'].append(f"{vp['name']} · {screen}")


def audit_modal(page, screen, vp, findings):
    """A modal must be closable and its primary action reachable without a trapped scroll."""
    if not page.locator('#modal .modalBack').count():
        findings.append(f"{vp['name']} · {screen}: expected a modal, none opened")
        return
    close = page.locator('#modal .close')
    if close.count() == 0:
        findings.append(f"{vp['name']} · {screen}: modal has no close control")
    else:
        box = close.first.bounding_box()
        if not box:
            findings.append(f"{vp['name']} · {screen}: modal close control is not rendered")
        elif box['y'] < -1 or box['y'] > vp['height'] - 8 or box['x'] + box['width'] > vp['width'] + 1:
            findings.append(f"{vp['name']} · {screen}: modal close is out of reach at {box}")
    overflow = page.evaluate("""() => {
        const m = document.querySelector('#modal .modal');
        if (!m) return null;
        const r = m.getBoundingClientRect();
        return { right: r.right, w: document.documentElement.clientWidth,
                 scrollable: m.scrollHeight > m.clientHeight + 1 || document.body.scrollHeight > window.innerHeight };
    }""")
    if overflow and overflow['right'] > overflow['w'] + 1:
        findings.append(f"{vp['name']} · {screen}: modal overflows the viewport width")
    audit_layout(page, screen, vp, findings)


def close_modal(page):
    page.evaluate("()=>{const m=document.getElementById('modal');if(m)m.innerHTML=''}")
    page.wait_for_timeout(60)


def run_engine(p, engine_name, launcher):
    findings = []
    browser = launcher()
    for vp in VIEWPORTS:
        # Each viewport starts from a clean ledger, otherwise the second run inherits the
        # locked baseline from the first and the capture control is legitimately disabled.
        state.clear()
        ctx = browser.new_context(viewport={'width': vp['width'], 'height': vp['height']},
                                  device_scale_factor=3, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        page.route('https://luxx.test/**', handler)
        page.on('pageerror', lambda e: report['page_errors'].append(f'{engine_name}/{vp["name"]}: {e}'))
        page.on('console', lambda m: report['console_errors'].append(f'{engine_name}/{vp["name"]}: {m.text}')
                if m.type == 'error' else None)
        page.on('dialog', lambda d: d.accept())

        page.goto('https://luxx.test/', wait_until='networkidle')
        page.locator('#shell').wait_for(state='visible')
        page.evaluate("()=>{for(let i=1;i<5000;i++)clearInterval(i)}")

        # --- TODAY, before setup: HOLD text and recovery buttons must be readable ------
        audit_layout(page, 'TODAY (holds)', vp, findings)
        body = page.locator('#view').inner_text()
        if 'CAM AVAILABILITY NOT FINALIZED' not in body:
            findings.append(f"{vp['name']} · TODAY: the cam setup notice is not visible")
        if 'PRODUCE is OFF' not in body:
            findings.append(f"{vp['name']} · TODAY: the PRODUCE state is not visible")
        hold_cards = page.locator('.jobCard').filter(has_text='HOLD')
        if hold_cards.count():
            txt = hold_cards.first.inner_text()
            if not re.search(r'HOLD — [A-Z]', txt):
                findings.append(f"{vp['name']} · TODAY: a HOLD card does not state a specific reason")
            if 'FIX SETUP' not in txt and 'FIX LIBRARY' not in txt and 'OPEN SETUP' not in txt:
                findings.append(f"{vp['name']} · TODAY: a HOLD card offers no recovery destination")

        # --- SETUP: baseline import, cam availability -----------------------------------
        page.locator('#setupBtn').click()
        page.locator('#modal .modalBack').wait_for()
        audit_modal(page, 'SETUP', vp, findings)
        for needed in ['Import baseline', 'Cam availability']:
            if needed not in page.locator('#modal').inner_text():
                findings.append(f"{vp['name']} · SETUP: {needed} is not present")
        close_modal(page)

        # --- LIBRARY: cards, badges, details, video preview ------------------------------
        page.locator('button[data-view="library"]').click(); page.wait_for_timeout(400)
        audit_layout(page, 'LIBRARY', vp, findings)
        page.locator('.mediaCard').filter(has_text='mobile-one.png').first.get_by_role('button', name='DETAILS', exact=True).first.click()
        page.locator('#modal .modalBack').wait_for()
        audit_modal(page, 'LIBRARY · Details', vp, findings)
        close_modal(page)

        page.locator('.mediaCard').filter(has_text='mobile-video.mp4').first.get_by_role('button', name='VIEW', exact=True).first.click()
        page.locator('#modal .modalBack').wait_for()
        audit_modal(page, 'LIBRARY · video preview', vp, findings)
        modal_txt = page.locator('#modal').inner_text()
        if 'FULL MASTER' not in modal_txt:
            findings.append(f"{vp['name']} · video preview: the derivative kind is not identified")
        if page.locator('#vposter, #vposterPending').count() == 0:
            findings.append(f"{vp['name']} · video preview: no poster area is rendered")
        play = page.locator('#vplayBtn')
        if play.count() == 0:
            findings.append(f"{vp['name']} · video preview: no PLAY control")
        else:
            pb, db = play.bounding_box(), page.get_by_role('button', name=re.compile('DOWNLOAD')).first.bounding_box()
            if pb and db and db['y'] < pb['y'] - 1:
                findings.append(f"{vp['name']} · video preview: DOWNLOAD is placed above PLAY")
        close_modal(page)

        page.get_by_role('button', name='REVIEW EXISTING', exact=True).first.click()
        page.locator('#modal .modalBack').wait_for()
        audit_modal(page, 'LIBRARY · historical review', vp, findings)
        close_modal(page)

        page.get_by_role('button', name='ROUTES', exact=True).first.click(); page.wait_for_timeout(300)
        audit_layout(page, 'LIBRARY · tracking', vp, findings)
        page.get_by_role('button', name='MEDIA', exact=True).first.click(); page.wait_for_timeout(300)

        # --- TODAY: CTA selection, READY TO APPROVE, MARK POSTED -------------------------
        page.locator('button[data-view="today"]').click(); page.wait_for_timeout(300)
        page.locator('#setupBtn').click()
        page.locator('#be').fill('mobile evidence'); page.locator('#bi').fill('mobile inventory')
        for _ in range(6):
            try:
                page.locator('#captureBaselineBtn').click(timeout=4000)
                break
            except Exception:
                page.wait_for_timeout(400)
        page.wait_for_function("!document.querySelector('#lockBaselineBtn')?.disabled")
        for _ in range(6):
            try:
                page.locator('#lockBaselineBtn').click(timeout=4000)
                break
            except Exception:
                page.wait_for_timeout(400)
        page.wait_for_timeout(900)
        close_modal(page)
        page.locator('button[data-view="today"]').click(); page.wait_for_timeout(700)

        use = page.get_by_role('button', name='USE THIS', exact=True)
        if use.count():
            use.first.click()
            page.wait_for_selector('#approveBtn', timeout=20000)
            audit_layout(page, 'TODAY · READY TO APPROVE', vp, findings)
            opts = page.locator('.ctaOption')
            if opts.count() < 2:
                findings.append(f"{vp['name']} · READY TO APPROVE: the alternate captions are not shown")
            if page.locator('.ctaSelected').count() != 1:
                findings.append(f"{vp['name']} · READY TO APPROVE: the selected caption is not marked exactly once")
            if page.locator('[data-cta-copy]').count() != opts.count():
                findings.append(f"{vp['name']} · READY TO APPROVE: not every caption has COPY")
            for i in range(opts.count()):
                b = opts.nth(i).bounding_box()
                if b and b['x'] + b['width'] > vp['width'] + 1:
                    findings.append(f"{vp['name']} · READY TO APPROVE: caption option {i} overflows the viewport")
            page.locator('#approveBtn').click(); page.wait_for_timeout(900)
            mp = page.locator('#view').get_by_role('button', name='MARK POSTED', exact=True)
            if mp.count():
                mp.first.click()
                page.locator('#modal .modalBack').wait_for()
                audit_modal(page, 'TODAY · MARK POSTED', vp, findings)
                for field in ['#postRef', '#effort', '#mpStyle', '#mpSeg', '#mpSent']:
                    if page.locator(field).count() == 0:
                        findings.append(f"{vp['name']} · MARK POSTED: {field} is missing")
                page.locator('#postRef').fill('mobile-ref'); page.locator('#effort').fill('5')
                page.locator('#mpSent').fill('20')
                page.locator('#modal').get_by_role('button', name='MARK POSTED', exact=True).click()
                page.wait_for_timeout(900)
        else:
            findings.append(f"{vp['name']} · TODAY: no actionable job to approve")

        # --- RESULTS: measure and correct ------------------------------------------------
        close_modal(page)
        page.locator('button[data-view="results"]').click(); page.wait_for_timeout(500)
        audit_layout(page, 'RESULTS', vp, findings)
        meas = page.get_by_role('button', name='MEASURE', exact=True)
        if meas.count():
            meas.first.click()
            page.locator('#modal .modalBack').wait_for()
            audit_modal(page, 'RESULTS · ENTER RESULT', vp, findings)
            page.locator('#m-views').fill('100')
            page.locator('#modal').get_by_role('button', name='SAVE', exact=True).click()
            page.wait_for_timeout(900)
            corr = page.get_by_role('button', name='CORRECT', exact=True)
            if corr.count() == 0:
                findings.append(f"{vp['name']} · RESULTS: CORRECT is not reachable")
            else:
                corr.first.click()
                page.locator('#modal .modalBack').wait_for()
                audit_modal(page, 'RESULTS · CORRECT', vp, findings)
                close_modal(page)
        else:
            findings.append(f"{vp['name']} · RESULTS: no measurement was reachable")
        ctx.close()
    browser.close()
    report['engines'].append(engine_name)
    return findings


try:
    with sync_playwright() as p:
        exe = os.environ.get('LUXX_CHROMIUM_PATH')
        ck = {'headless': True, 'args': ['--no-sandbox']}
        if exe:
            ck['executable_path'] = exe
        report['findings'] += run_engine(p, 'chromium', lambda: p.chromium.launch(**ck))
        # WebKit is the engine iOS Safari uses. Absence is reported, never treated as a pass.
        require_webkit = os.environ.get('LUXX_REQUIRE_WEBKIT') == '1'
        try:
            wk = p.webkit.launch(headless=True)
            report['webkit_executable'] = p.webkit.executable_path
            wk.close()
            report['findings'] += run_engine(p, 'webkit', lambda: p.webkit.launch(headless=True))
            report['webkit'] = 'ran'
        except Exception as e:
            report['webkit'] = 'NOT RUN — Playwright WebKit is not installed in this environment: %s' % str(e)[:200]
            # In CI the WebKit pass is mandatory. Chromium must never stand in for it.
            if require_webkit:
                report['webkit'] = 'FAILED — WebKit was required but could not launch: %s' % str(e)[:300]
                report['webkit_required_and_missing'] = True
    report['pass'] = (not report['findings']) and (not report['page_errors']) and (not report['console_errors'])
    # Explicit per-engine, per-viewport reporting so a partial run can never read as a pass.
    report['viewport_results'] = {
        eng: {vp['name']: ('PASS' if any(s.startswith(vp['name']) for s in report['screens'])
                           and not any(f.startswith(vp['name']) for f in report['findings']) else 'NOT RUN/FAIL')
              for vp in VIEWPORTS}
        for eng in report['engines']}
    if os.environ.get('LUXX_REQUIRE_WEBKIT') == '1':
        if 'webkit' not in report['engines'] or report.get('webkit') != 'ran':
            report['pass'] = False
            report.setdefault('webkit_required_and_missing', True)
        else:
            for vp in VIEWPORTS:
                if not any(s.startswith(vp['name']) for s in report['screens']):
                    report['pass'] = False
                    report['webkit_viewport_gap'] = vp['name']
except Exception as e:
    report['error'] = repr(e)

(ROOT / 'tests/MOBILE_ACCEPTANCE_RESULTS.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
if not report['pass']:
    sys.exit(1)
