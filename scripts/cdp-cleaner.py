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
    ws.send(json.dumps({
      'id': req_id,
      'method': method,
      'params': params or {}
    }))
    while True:
      data = json.loads(ws.recv())
      if data.get('id') == req_id:
        return data

send('Runtime.enable')

expr = """
(async () => {
  const api = window.electronAPI;
  const rules = await api.invoke('get-cleaner-rules');
  const status = await api.invoke('get-cleaner-schedule-status');
  const logs = await api.invoke('get-cleaner-logs', 10);
  return { rulesCount: rules.length, scheduledCount: status.scheduledCount, logsCount: logs.length };
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
