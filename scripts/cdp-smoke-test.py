import websocket
import json
import sys
import urllib.request

with urllib.request.urlopen('http://127.0.0.1:9222/json/list') as resp:
    targets = json.loads(resp.read())

renderer = next((t for t in targets if t.get('title') == 'AgentSC'), None)
if not renderer:
    print('Renderer target not found')
    print('Available titles:', [t.get('title') for t in targets])
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
  const api = window.electronAPI;
  const today = new Date().toISOString().slice(0, 10);
  const [
    disks,
    watcherStatus,
    dailyStats,
    recentEvents,
    report,
    cleanerRules,
    storage,
    insights,
  ] = await Promise.all([
    api.invoke('get-disk-info'),
    api.invoke('get-watcher-status'),
    api.invoke('get-daily-stats'),
    api.invoke('get-recent-events', 5),
    api.invoke('generate-report', today, today),
    api.invoke('get-cleaner-rules'),
    api.invoke('get-storage-stats'),
    api.invoke('get-ai-insights'),
  ]);
  return {
    diskCount: disks.length,
    watcherActive: watcherStatus.active,
    processTrackerMode: watcherStatus.processTracker?.mode,
    todayCreated: dailyStats.created_count,
    recentEventsCount: recentEvents.length,
    reportHasStats: !!report.stats,
    reportDailyLength: report.daily.length,
    cleanerRulesCount: cleanerRules.length,
    storageEvents: storage.events,
    insightsSource: insights.source,
    insightsHasSummary: !!insights.summary,
  };
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
