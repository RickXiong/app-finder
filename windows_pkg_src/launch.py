import os, sys, time, subprocess, webbrowser

BASE = os.path.dirname(os.path.abspath(__file__))
PORT = 9527

# Kill any existing process on port 9527
try:
    import subprocess as sp
    result = sp.run(
        'netstat -ano | findstr ":9527" | findstr "LISTENING"',
        shell=True, capture_output=True, text=True
    )
    for line in result.stdout.strip().splitlines():
        parts = line.split()
        if parts:
            pid = parts[-1]
            sp.run('taskkill /f /pid ' + pid, shell=True, capture_output=True)
            print('Stopped old process: PID ' + pid)
except Exception as e:
    print('Warning: could not kill old process:', e)

# Start server in background (no console window)
srv = subprocess.Popen(
    ['pythonw', os.path.join(BASE, 'run.py')],
    cwd=BASE
)
print('Server started (PID %d)' % srv.pid)

time.sleep(2)

# Open browser once
webbrowser.open('http://127.0.0.1:%d' % PORT)
print('Browser opened: http://127.0.0.1:%d' % PORT)
print('')
print('To stop the server, run Stop.bat')
print('')
print('This window will close in 60 seconds...')
time.sleep(60)
