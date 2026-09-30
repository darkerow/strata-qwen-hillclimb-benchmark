import json, time, pathlib, urllib.request, subprocess, sys, traceback

ROOT = pathlib.Path(__file__).resolve().parents[2] / 'outputs/strata-20261001'
GAME = ROOT / 'game'
GAME.mkdir(parents=True, exist_ok=True)
START = time.time()
DEADLINE = float(sys.argv[1])
EFFORT = sys.argv[2] if len(sys.argv)>2 else 'none'
API = 'http://127.0.0.1:18170/v1/chat/completions'
def save(name, obj):
    (ROOT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding='utf-8')
def spec(name, desc, props, required):
    return dict(type='function', function=dict(name=name, description=desc, parameters=dict(type='object', properties=props, required=required)))
S = {'type':'string'}
tools = [
    spec('write_file','Write a UTF-8 game file. Allowed: index.html, game.js, style.css, README.txt.',{'path':S,'content':S},['path','content']),
    spec('read_file','Read a game file.',{'path':S},['path']),
    spec('replace_text','Replace exactly one occurrence in a game file.',{'path':S,'old':S,'new':S},['path','old','new']),
    spec('syntax_check','Actually run node --check game.js.',{},[]),
    spec('browser_check','Request real browser inspection of current game. Modes inspect, drive, restart. Returns visible observations and JavaScript errors; does not repair code.',{'mode':{'type':'string','enum':['inspect','drive','restart']}},['mode']),
    spec('finish','Finish after browser testing. State implemented features and real limitations.',{'summary':S},['summary'])
]
prompt = '''Create a polished, playable 2D side-view hill climbing driving game inspired by Hill Climb Racing, with original drawn graphics. Write the actual files, not just code in chat.
Use plain JavaScript and HTML Canvas, no build step, no external network dependencies, no assets to download. Must run from a local HTTP server and preferably also by double-clicking index.html.
Required: a car with two visible wheels, suspension and convincing stable terrain contact; continuous rolling hills with progressively challenging slopes, jumps and air rotation; gas/brake using Right/Left or D/A, touch pedals; follow camera; fuel that drains and can be replenished; collectible coins; distance, best record and game-over when fuel ends or the car remains overturned; instant restart; pause; garage upgrades saved locally. At least one polished car and countryside level before adding optional content. Make controls and game states obvious, with an attractive original landscape, readable UI and sound toggle.
Physics must not explode or let the car fall through terrain. Test your own work with syntax_check and browser_check; repair issues using tools. First build a small playable version, then refine. Do not claim success without tests. All game implementation must be your own. You have a limited wall-clock budget; prioritize a finished enjoyable small prototype over breadth. Provide a short Russian README with controls. The page must display a small diagnostic DOM element with id="debug" containing distance, speed, fuel, coins, game state and car angle, updated during gameplay, so the browser tester can objectively inspect it. Keep it unobtrusive. No separate explanations or repeated plans; use tools now.'''
(ROOT/'prompt.txt').write_text(prompt,encoding='utf-8')
messages=[{'role':'system','content':'You are the sole game developer in an autonomous tool loop. Use tools, test and correct your code. The coordinator executes your browser checks but does not write your game. Never access outside the game directory. Finish only after testing the latest code.'},{'role':'user','content':prompt}]
metrics=[]; actions=[]; finished=False; error=None; check_id=0
first_turn=1
if len(sys.argv)>3 and sys.argv[3]=='resume':
    messages=json.loads((ROOT/'conversation.json').read_text(encoding='utf-8'))
    metrics=json.loads((ROOT/'metrics.json').read_text(encoding='utf-8'))
    actions=json.loads((ROOT/'actions.json').read_text(encoding='utf-8'))
    first_turn=len(metrics)+1
    check_id=sum(a['name']=='browser_check' for a in actions)
    START-=json.loads((ROOT/'result.json').read_text(encoding='utf-8')).get('seconds',0)
allowed={'index.html','game.js','style.css','README.txt'}
try:
    for turn in range(first_turn,81):
        if time.time() >= DEADLINE: break
        t=time.time()
        if metrics and (metrics[-1].get('usage') or {}).get('total_tokens',0)>50000:
            feedback=[a['result'] for a in actions if a['name']=='browser_check'][-2:]
            messages=messages[:2]+[{'role':'user','content':'Context handoff. Continue repairing the existing game. Current files: '+json.dumps({p.name:p.read_text(encoding='utf-8') for p in GAME.iterdir() if p.name in allowed})+' Latest test results: '+json.dumps(feedback)+' Test current code, write README.txt and finish.'}]
        body={'model':'strata','messages':messages,'tools':tools,'parallel_tool_calls':False,'stream':False,'temperature':0.7,'top_p':0.95,'reasoning_effort':EFFORT,'max_tokens':8192}
        req=urllib.request.Request(API,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=max(1,min(600,DEADLINE-time.time()))) as r: data=json.load(r)
        save(f'turn-{turn:03d}.json',data)
        metrics.append({'turn':turn,'seconds':time.time()-t,'usage':data.get('usage'),'timings':data.get('timings')})
        msg=data['choices'][0]['message']; messages.append(msg)
        print(json.dumps({'turn':turn,'seconds':round(time.time()-t,2),'usage':data.get('usage'),'tools':[c['function']['name'] for c in msg.get('tool_calls',[])],'answer':(msg.get('content') or '')[-700:]},ensure_ascii=False),flush=True)
        if not msg.get('tool_calls'):
            messages.append({'role':'user','content':'Continue using the tools to implement and verify the actual game, then call finish.'})
        for c in msg.get('tool_calls',[]):
            name=c['function']['name']; args={}
            try:
                args=json.loads(c['function']['arguments'])
                if name in ('read_file','write_file','replace_text'):
                    if args['path'] not in allowed: raise ValueError('Path not allowed')
                    p=GAME/args['path']
                    if name=='read_file': result={'content':p.read_text(encoding='utf-8')}
                    elif name=='write_file': p.write_text(args['content'],encoding='utf-8'); result={'written':str(p.name),'chars':len(args['content'])}
                    else:
                        text=p.read_text(encoding='utf-8')
                        if not args['old'] or text.count(args['old'])!=1: raise ValueError('old must match exactly once')
                        p.write_text(text.replace(args['old'],args['new']),encoding='utf-8'); result={'replaced':True}
                elif name=='syntax_check':
                    p=subprocess.run(['node','--check',str(GAME/'game.js')],capture_output=True,text=True,timeout=20)
                    result={'exit_code':p.returncode,'stdout':p.stdout,'stderr':p.stderr}
                elif name=='browser_check':
                    check_id+=1; save('browser-request.json',{'id':check_id,'mode':args['mode'],'turn':turn,'at':time.time()})
                    print('WAITING_BROWSER '+str(check_id),flush=True)
                    response=ROOT/f'browser-response-{check_id}.json'
                    while not response.exists() and time.time()<DEADLINE: time.sleep(1)
                    result=json.loads(response.read_text(encoding='utf-8')) if response.exists() else {'error':'Deadline reached'}
                elif name=='finish': finished=True; result=args
                else: result={'error':'Unknown tool'}
            except Exception as e: result={'error':str(e)}
            actions.append({'turn':turn,'name':name,'args':args,'result':result})
            messages.append({'role':'tool','tool_call_id':c['id'],'content':json.dumps(result,ensure_ascii=False)})
            save('actions.json',actions)
            if finished: break
        save('conversation.json',messages); save('metrics.json',metrics)
        if finished: break
except Exception as e:
    error=str(e); traceback.print_exc()
finally:
    save('result.json',{'finished':finished,'effort':EFFORT,'seconds':time.time()-START,'error':error,'metrics':metrics,'last_message':messages[-1]})
    save('conversation.json',messages)
    print('RUN_FINISHED',flush=True)
