import sys, traceback, os, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE)

# Redirect stdout/stderr to a log file so that when pythonw (no console)
# runs this script, errors / slow-query traces are still captured for debugging.
LOG_DIR = os.path.join(BASE, 'logs')
try:
    os.makedirs(LOG_DIR, exist_ok=True)
    # Rotate: keep only latest 3 log files
    logs = sorted(f for f in os.listdir(LOG_DIR) if f.startswith('server_') and f.endswith('.log'))
    for old in logs[:-2]:
        try: os.remove(os.path.join(LOG_DIR, old))
        except Exception: pass
    log_path = os.path.join(LOG_DIR, 'server_' + datetime.datetime.now().strftime('%Y%m%d_%H%M%S') + '.log')
    log_fp = open(log_path, 'w', encoding='utf-8', buffering=1)
    sys.stdout = log_fp
    sys.stderr = log_fp
except Exception:
    pass

try:
    exec(open('app.py', encoding='utf-8').read())
except SystemExit:
    pass
except BaseException as e:
    print('ERROR: ' + str(e))
    traceback.print_exc()
