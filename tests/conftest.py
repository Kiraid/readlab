import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

# The app's tests use their own database, never the one you read from. Set before app.backend is imported.
os.environ["DATABASE_URL"] = os.environ.get("READLAB_TEST_DATABASE_URL",
                                            "postgresql+psycopg://readlab:readlab@127.0.0.1:5433/readlab_test")
