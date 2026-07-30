import websocket
import json
import sys
import urllib.request

with urllib.request.urlopen('http://127.0.0.1:9222/json/list') as resp:
    targets = json.loads(resp.read())

renderer = next((t for t in targets if t.get('title') == 'AgentSC'), None)
if not renderer:
    print('Renderer target not found')
    sys.exit(1)

ws_url = renderer['webSocketDebuggerUrl']
ws = websocket.create_connection(ws_url)

counter = [0]
def send(method, params=None):
    counter[0] += 1
    req_id = counter[0]
    ws.send(json.dumps({'id': req_id, 'method': method, 'params': params or {}}))
    while True:
        data = json.loads(ws.recv())
        if data.get('id') == req_id:
            return data

send('Runtime.enable')

expr = """
(async () => {
  const api = window.electronAPI;
  const config = await api.invoke('get-watcher-config');
  const status = await api.invoke('get-watcher-status');
  const trend = await api.invoke('get-daily-trend', 7);
  const top = await api.invoke('get-top-created-paths');
  const rules = await api.invoke('get-exclusion-rules');
  return { config, status, trendDays: trend.length, topCount: top.length, rulesCount: rules.length };
})()
"""

result = send('Runtime.evaluate', {
    'expression': expr,
    'awaitPromise': True,
    'returnByValue': True,
})

if 'result' in result and 'value' in result['result']:
    print(json.dumps(result['result']['value'], indent=2, ensure_ascii=False))
else:
    print(json.dumps(result, indent=2, ensure_ascii=False))

ws.close()
