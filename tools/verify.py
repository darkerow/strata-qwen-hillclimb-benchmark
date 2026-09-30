import hashlib, json, math, pathlib
r=pathlib.Path(__file__).resolve().parents[1]
for line in (r/'MANIFEST.sha256').read_text(encoding='utf-8').splitlines():
    expected,name=line.split('  ',1)
    assert hashlib.sha256((r/name).read_bytes()).hexdigest()==expected,name
m=json.loads((r/'evidence/metrics.json').read_text(encoding='utf-8'))
s=json.loads((r/'summary.json').read_text(encoding='utf-8'))
tokens=sum(x['usage']['completion_tokens'] for x in m)
seconds=sum(x['timings']['predicted_ms'] for x in m)/1000
assert tokens==s['completion_tokens']
assert math.isclose(round(tokens/seconds,2),s['generation_tps'])
assert len(m)==80
print(f'OK: manifest, {len(m)} responses, {tokens} output tokens, {tokens/seconds:.2f} tokens/s')
