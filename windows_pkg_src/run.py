import sys, traceback, os, datetime

BASE = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE)

# 日志行为：
#  - 默认：静默（stdout/stderr 丢到 NUL，不生成 logs/ 文件夹）
#  - 调试：设环境变量 APPFINDER_LOG=1 后启动，才会写到 logs/server_YYYYMMDD_HHMMSS.log
#    用法（Git Bash / PowerShell）:
#      $env:APPFINDER_LOG="1"; .\Start.bat
#    （cmd）:
#      set APPFINDER_LOG=1 && Start.bat
if os.environ.get('APPFINDER_LOG') == '1':
    LOG_DIR = os.path.join(BASE, 'logs')
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        # 最多保留 3 份历史 log
        logs = sorted(f for f in os.listdir(LOG_DIR) if f.startswith('server_') and f.endswith('.log'))
        for old in logs[:-2]:
            try: os.remove(os.path.join(LOG_DIR, old))
            except Exception: pass
        log_path = os.path.join(LOG_DIR, 'server_' + datetime.datetime.now().strftime('%Y%m%d_%H%M%S') + '.log')
        sys.stdout = open(log_path, 'w', encoding='utf-8', buffering=1)
        sys.stderr = sys.stdout
    except Exception:
        pass
else:
    # 静默：stdout/stderr → NUL，不生成任何文件
    try:
        devnull = open(os.devnull, 'w', encoding='utf-8')
        sys.stdout = devnull
        sys.stderr = devnull
    except Exception:
        pass

try:
    exec(open('app.py', encoding='utf-8').read())
except SystemExit:
    pass
except BaseException as e:
    # 只有调试模式会被看到（默认 NUL 下 print 到黑洞）
    print('ERROR: ' + str(e))
    traceback.print_exc()
