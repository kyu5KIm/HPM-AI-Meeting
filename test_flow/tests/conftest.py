import sys
from pathlib import Path

# test_flow 모듈은 `from config import ...`처럼 test_flow 폴더를 기준으로 import한다.
APP_DIR = Path(__file__).resolve().parent.parent
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))
