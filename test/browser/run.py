#!/usr/bin/env python3
"""Runs the browser test suite of the מוזיל app (Playwright + Chromium).

  python3 test/browser/run.py --data <app data dir> [--only qa,sec3]

<app data dir> is the folder the app reads its files from: a checkout of the gh-pages branch, or the output of
`bash tools/build_app_data.sh site`. The page under test is app/zul-li.html. Each test runs in a scratch folder laid out
the way the tests expect (the page and the data one level up); a test fails when it exits with an error or prints a FAIL
line, a Python traceback, page errors, or (sec) any payload hit."""
import argparse,os,re,shutil,subprocess,sys,tempfile,pathlib,time
HERE=pathlib.Path(__file__).resolve().parent;REPO=HERE.parent.parent
TESTS=['qa','qa4','flow','edit','rf4','pick','a11y','lk2','ln','reg','sec2','sec3','sec']
BAD=re.compile(r'^FAIL(?!S 0 )|Traceback|FAILS [1-9]|^(page )?errors?:? \[[^\]]|^errs \[[^\]]|pwned: [1-9]|DIALOG',re.M)
ap=argparse.ArgumentParser();ap.add_argument('--data',required=True);ap.add_argument('--only',default='');ap.add_argument('--keep',action='store_true')
a=ap.parse_args();data=pathlib.Path(a.data).resolve()
if not (data/'version.json').exists():sys.exit(f'{data} does not look like the app data folder (no version.json)')
work=pathlib.Path(tempfile.mkdtemp(prefix='mozil-test-'))
for p in data.iterdir():
  if p.name not in ('t','fuzz','zul-li.html'):(work/p.name).symlink_to(p)
dst=work/'zul-li.html'
if dst.is_symlink() or dst.exists():dst.unlink()  # never write through a link into the data folder
shutil.copy(REPO/'app'/'zul-li.html',dst)
(work/'t').mkdir()
for f in HERE.glob('*.py'):shutil.copy(f,work/'t'/f.name)
only=[x for x in a.only.split(',') if x] or TESTS
if 'sec' in only:
  print('building poisoned data for sec …',flush=True)
  subprocess.run([sys.executable,str(HERE/'mkfuzz.py'),str(data),str(work/'fuzz')],check=True)
fails=[]
for name in only:
  t0=time.time();r=subprocess.run([sys.executable,name+'.py'],cwd=work/'t',capture_output=True,text=True,timeout=1800)
  out=r.stdout+r.stderr;bad=r.returncode!=0 or bool(BAD.search(out)) or (name=='sec' and 'NO HITS' not in out)
  print(f"{'FAIL' if bad else 'ok  '} {name:6} {time.time()-t0:5.0f}s",flush=True)
  if bad:fails.append(name);m=BAD.search(out);print('     reason:',repr(m.group(0)) if m else f'exit {r.returncode}');print('\n'.join('     '+l for l in out.strip().splitlines()[-25:]))
if not a.keep:shutil.rmtree(work,ignore_errors=True)
print(f"\n{len(only)-len(fails)}/{len(only)} passed"+(f"; failed: {', '.join(fails)}" if fails else ''));sys.exit(1 if fails else 0)
