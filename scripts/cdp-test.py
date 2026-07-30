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
    msg = {'id': req_id, 'method': method, 'params': params or {}}
    ws.send(json.dumps(msg))
    while True:
        raw = ws.recv()
        data = json.loads(raw)
        if data.get('id') == req_id:
            return data

send('Runtime.enable')

expr = """
(async () => {
  if (!window.electronAPI) return { error: 'electronAPI not found' };
  const disks = await window.electronAPI.invoke('get-disk-info');
  const scan = await window.electronAPI.invoke('scan-directory', 'E:\\\\X9\\\\OPC项目\\\\AgentSC', 2);
  return { disks: disks.slice(0, 1), scan };
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
