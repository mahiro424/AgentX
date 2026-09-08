import contextlib
import io
import runpy
from pathlib import Path
from unittest.mock import patch

root = Path(__file__).resolve().parents[2]
original = Path.read_text
for before, after in [
    ('### IMPL-M2-PUBLIC-SEAMS', '### IMPL-M2-MISSING'),
    ('| M2-01 | matches |', '| M2-01 | missingState |'),
]:
    def changed(path, *args, **kwargs):
        value = original(path, *args, **kwargs)
        return value.replace(before, after) if path.name == 'AgentX_Desktop_PRD.md' else value
    code = 0
    output = io.StringIO()
    with patch.object(Path, 'read_text', changed), contextlib.redirect_stdout(output):
        try:
            runpy.run_path(str(root / 'scripts/check-docs.py'), run_name='__main__')
        except SystemExit as error:
            code = error.code
    assert code == 1, f'门禁未拒绝 M2 规格缺失: {before}'
    print(f'已拒绝规格变异：{before}')
