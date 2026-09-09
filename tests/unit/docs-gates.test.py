import contextlib
import io
import runpy
from pathlib import Path
from unittest.mock import patch

root = Path(__file__).resolve().parents[2]
original = Path.read_text
prd = original(root / 'docs/prd/AgentX_Desktop_PRD.md', encoding='utf-8')
for slice_id, state in [
    ('M2-02', 'generatingText'), ('M2-02', 'validatingText'), ('M2-02', 'textPreview'), ('M2-02', 'revision'),
    ('M2-03', 'spreadsheet'), ('M2-03', 'revision'), ('M2-04', 'readingDocument'), ('M2-04', 'revision'),
]:
    assert f'| {slice_id} | {state} |' in prd, f'纵向交付缺少 {slice_id}/{state}'
runpy.run_path(str(root / 'scripts/check-docs.py'), run_name='__main__')
for before, after in [
    ('### IMPL-M2-PUBLIC-SEAMS', '### IMPL-M2-MISSING'),
    ('| M2-01 | matches |', '| M2-01 | missingState |'),
    ('| M2-02 | textPreview |', '| M2-02 | missingPreview |'),
    ('| M2-02 | revision |', '| M2-02 | missingRevision |'),
    ('| M2-03 | spreadsheet |', '| M2-04 | spreadsheet |'),
    ('| M2-04 | readingDocument |', '| M2-04 | missingReading |'),
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
