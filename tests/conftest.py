import os
import sys
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).parent))

# The app's tests use their own database (readlab_test on the same server), never the one you read from.
# Set before app.backend (which reads DATABASE_URL once, on import) is imported.
if not os.environ.get("READLAB_TEST_DATABASE_URL"):
    from pipeline.llm.core import load_env

    load_env()
    base = os.environ.get("DATABASE_URL") or \
        f"postgresql+psycopg://readlab:{quote(os.environ.get('POSTGRES_PASSWORD', ''), safe='')}@127.0.0.1:5433/readlab"
    os.environ["READLAB_TEST_DATABASE_URL"] = base.rsplit("/", 1)[0] + "/readlab_test"
os.environ["DATABASE_URL"] = os.environ["READLAB_TEST_DATABASE_URL"]
