"""
Windows EXE entry point.
PyInstaller bundles this as AppFinder.exe
"""
import sys
import os
import time
import webbrowser
import threading

# When running as PyInstaller bundle, _MEIPASS is the temp extraction dir
if getattr(sys, 'frozen', False):
    BASE_DIR = sys._MEIPASS
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

os.chdir(BASE_DIR)

# Execute app.py to define the Flask `app` object in our namespace
_ns = {"__name__": "__init__", "__file__": os.path.join(BASE_DIR, "app.py")}
with open(os.path.join(BASE_DIR, "app.py"), encoding="utf-8") as _f:
    exec(_f.read(), _ns)

flask_app = _ns["app"]

PORT = 9527

def open_browser():
    time.sleep(2)
    webbrowser.open(f"http://127.0.0.1:{PORT}")

threading.Thread(target=open_browser, daemon=True).start()

print(f"\n  App Query Tool Started!")
print(f"  Open in browser: http://127.0.0.1:{PORT}")
print(f"  Close this window to exit.\n")

try:
    flask_app.run(host="127.0.0.1", port=PORT, debug=False)
except Exception as e:
    print(f"\n  ERROR: {e}")
    input("\n  Press Enter to exit...")
